// src/mcp-server.ts
//
// MCP (Model Context Protocol) server for GTEZ Intelligence.
// Exposes the document intelligence backend as tools that Claude
// Desktop / Code can call directly. Runs as a stdio process —
// Claude spawns it, sends JSON-RPC over stdin, reads from stdout.

// MUST be the first import — loads .env.local before supabase.ts
// evaluates its module-scope requireEnv() calls.
import "./mcp-env";

import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";

import { Packer } from "docx";
import { supabaseAdmin } from "./lib/supabase";
import type { Database } from "./lib/database.types";
import { hybridSearch } from "./lib/search";
import { processDocumentContent } from "./lib/document-processing";
import { validateUploadBuffer } from "./lib/upload-validation";
import { formatContextCardForPrompt } from "./lib/context-card";
import {
  buildReportDocument,
  type ReportContent,
} from "./lib/tools/report-layout";
import { buildPresentationBuffer } from "./lib/tools/presentation-layout";
import {
  STYLE_PROMPT,
  BRAND,
  AR_LABELS,
  EN_LABELS,
  FONTS,
  COLORS,
} from "./lib/tools/style-prompt";
import {
  normalizeLanguage as normalizeReportLang,
  normalizeSections,
  normalizeStringArray,
  slugify as reportSlugify,
} from "./lib/tools/create-report";
import {
  normalizeLanguage as normalizeDeckLang,
  normalizeSlides,
  slugify as deckSlugify,
} from "./lib/tools/create-presentation";
import {
  extractStyleProfile,
  saveStyleProfile,
  getActiveStyleProfile,
} from "./lib/style-extraction";
import { extractKnowledgeGraph } from "./lib/knowledge-graph";

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const db = supabaseAdmin;

const BUCKET = "documents";
const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 days

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

async function getProjectDocIds(projectId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("project_documents")
    .select("document_id")
    .eq("project_id", projectId);
  return (data ?? []).map((r) => r.document_id);
}

function jsonResult(obj: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }],
  };
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

// ─────────────────────────────────────────────────────────────────
// Server
// ─────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "documind",
  version: "0.1.0",
});

// ─────────────────────────────────────────────────────────────────
// Tool 1: search_documents
// ─────────────────────────────────────────────────────────────────

server.tool(
  "search_documents",
  "Search the GTEZ document corpus using hybrid semantic + full-text search with Cohere reranking. Returns relevant chunks with source metadata. Use this whenever you need evidence from the user's uploaded documents.",
  {
    query: z.string().describe("Search query in Arabic or English"),
    project_id: z
      .string()
      .optional()
      .describe("Restrict results to documents in this project"),
    limit: z
      .number()
      .optional()
      .describe("Max results to return (default 8)"),
    classification: z
      .enum(["PRIVATE", "PUBLIC"])
      .optional()
      .describe("Filter by document classification"),
  },
  async ({ query, project_id, limit, classification }) => {
    const docIds = project_id
      ? await getProjectDocIds(project_id)
      : undefined;

    const results = await hybridSearch({
      query,
      matchCount: limit ?? 8,
      classification: classification ?? null,
      documentIds: docIds ?? null,
    });

    return jsonResult({
      count: results.length,
      results: results.map((r) => ({
        content: r.content,
        document_title: r.document?.title ?? null,
        document_type: r.document?.type ?? null,
        page_number: r.pageNumber,
        section_title: r.sectionTitle,
        score: r.score,
        document_id: r.documentId,
      })),
    });
  },
);

// ─────────────────────────────────────────────────────────────────
// Tool 2: get_document
// ─────────────────────────────────────────────────────────────────

server.tool(
  "get_document",
  "Fetch full metadata, context card, entities, and references for a specific document. Use this to understand what a document contains before drafting or analyzing.",
  {
    document_id: z.string().describe("UUID of the document"),
  },
  async ({ document_id }) => {
    const { data: doc, error } = await supabaseAdmin
      .from("documents")
      .select("*")
      .eq("id", document_id)
      .single();

    if (error || !doc) {
      return textResult(`Document not found: ${document_id}`);
    }

    const { data: docEntities } = await supabaseAdmin
      .from("document_entities")
      .select("entity_id, role, entities(id, name, name_en, type)")
      .eq("document_id", document_id);

    const { data: refs } = await supabaseAdmin
      .from("document_references")
      .select("*")
      .or(`source_id.eq.${document_id},target_id.eq.${document_id}`);

    let contextCardText = "";
    if (doc.context_card) {
      try {
        contextCardText = formatContextCardForPrompt(
          doc.context_card as unknown as Parameters<typeof formatContextCardForPrompt>[0],
          doc.title,
        );
      } catch {
        /* context card format mismatch — skip */
      }
    }

    return jsonResult({
      id: doc.id,
      title: doc.title,
      type: doc.type,
      classification: doc.classification,
      language: doc.language,
      page_count: doc.page_count,
      status: doc.status,
      created_at: doc.created_at,
      context_card_summary: contextCardText || null,
      context_card_raw: doc.context_card,
      entities: (docEntities ?? []).map((e) => ({
        ...(e.entities as Record<string, unknown>),
        role: e.role,
      })),
      references: refs ?? [],
    });
  },
);

// ─────────────────────────────────────────────────────────────────
// Tool 3: list_documents
// ─────────────────────────────────────────────────────────────────

server.tool(
  "list_documents",
  "List documents in the corpus. Can filter by project, classification, or type. Returns summaries, not full content — use search_documents or get_document for content.",
  {
    project_id: z.string().optional().describe("Filter by project"),
    classification: z.enum(["PRIVATE", "PUBLIC"]).optional(),
    type: z.string().optional().describe("Filter by document type"),
    limit: z.number().optional().describe("Max results (default 50)"),
  },
  async ({ project_id, classification, type, limit }) => {
    let query = supabaseAdmin
      .from("documents")
      .select(
        "id, title, type, classification, language, page_count, status, created_at",
      )
      .eq("is_current", true)
      .order("created_at", { ascending: false })
      .limit(limit ?? 50);

    if (classification) query = query.eq("classification", classification);
    if (type) query = query.eq("type", type);

    if (project_id) {
      const docIds = await getProjectDocIds(project_id);
      if (docIds.length === 0) return jsonResult({ count: 0, documents: [] });
      query = query.in("id", docIds);
    }

    const { data, error } = await query;
    if (error) return textResult(`Query failed: ${error.message}`);

    return jsonResult({ count: data?.length ?? 0, documents: data ?? [] });
  },
);

// ─────────────────────────────────────────────────────────────────
// Tool 4: get_style_profile
// ─────────────────────────────────────────────────────────────────

server.tool(
  "get_style_profile",
  "Get the GTEZ formal writing style profile. Returns the full style instructions, brand constants, Arabic section labels, font preferences (Sultan for Arabic), and structural conventions. Inject this into your context before drafting any document.",
  {
    language: z
      .enum(["ar", "en", "mixed"])
      .optional()
      .describe("Target language for the document (default: ar)"),
  },
  async ({ language }) => {
    const lang = language ?? "ar";
    const labels = lang === "en" ? EN_LABELS : AR_LABELS;

    // Check DB for a learned profile first
    let learnedSection = "";
    try {
      const profile = await getActiveStyleProfile(lang);
      if (profile) {
        learnedSection = [
          "",
          "=== LEARNED VOICE PROFILE (from reference documents) ===",
          "",
          `Openings: ${(profile.openings ?? []).join(" | ")}`,
          `Reporting verbs: ${(profile.reporting_verbs ?? []).join("، ")}`,
          `Transitions: ${(profile.transition_phrases ?? []).join("، ")}`,
          `Closings: ${(profile.closing_formulas ?? []).join(" | ")}`,
          `Banned phrases: ${(profile.banned_phrases ?? []).join("، ")}`,
          `Tone: ${profile.tone_description ?? ""}`,
          `Structure: ${profile.structural_notes ?? ""}`,
          "",
          "=== FEW-SHOT EXAMPLES (real excerpts from reference documents) ===",
          ...(profile.few_shot_excerpts ?? []).map(
            (ex, i) => `\n[Example ${i + 1}]\n${ex}`,
          ),
        ].join("\n");
      }
    } catch {
      /* DB not ready or table doesn't exist yet — fall back to hardcoded */
    }

    return textResult(
      [
        "=== GTEZ STYLE PROFILE ===",
        "",
        STYLE_PROMPT,
        "",
        "=== BRAND ===",
        `Organization (AR): ${BRAND.longNameAr}`,
        `Organization (EN): ${BRAND.longNameEn}`,
        `Short name: ${BRAND.shortName}`,
        `Country (AR): ${BRAND.countryAr}`,
        `Country (EN): ${BRAND.countryEn}`,
        "",
        "=== FONTS ===",
        `Arabic: ${FONTS.arabic}`,
        `Heading: ${FONTS.heading}`,
        `Body: ${FONTS.body}`,
        "",
        "=== SECTION LABELS ===",
        `Subject: ${labels.subjectLine}`,
        `Reference: ${labels.referenceLine}`,
        `Date: ${labels.dateLine}`,
        `Summary: ${labels.summary}`,
        `Recommendations: ${labels.recommendations}`,
        `Next Steps: ${labels.nextSteps}`,
        "",
        "=== COLORS (hex, no #) ===",
        `Ink: ${COLORS.ink}`,
        `Subtle: ${COLORS.subtle}`,
        `Border: ${COLORS.border}`,
        learnedSection,
      ].join("\n"),
    );
  },
);

// ─────────────────────────────────────────────────────────────────
// Tool 5: get_project_context
// ─────────────────────────────────────────────────────────────────

server.tool(
  "get_project_context",
  "Get full context for a project — summary, linked documents with context cards, entities, and next actions. Use this to understand a deal, initiative, or matter before working on it.",
  {
    project_id: z.string().describe("UUID of the project"),
  },
  async ({ project_id }) => {
    const { data: project, error } = await supabaseAdmin
      .from("projects")
      .select("*")
      .eq("id", project_id)
      .single();

    if (error || !project) {
      return textResult(`Project not found: ${project_id}`);
    }

    const docIds = await getProjectDocIds(project_id);
    let documents: Array<Record<string, unknown>> = [];
    if (docIds.length > 0) {
      const { data } = await supabaseAdmin
        .from("documents")
        .select(
          "id, title, type, classification, language, status, context_card, created_at",
        )
        .in("id", docIds)
        .eq("is_current", true);
      documents = (data ?? []).map((d) => ({
        id: d.id,
        title: d.title,
        type: d.type,
        classification: d.classification,
        language: d.language,
        status: d.status,
        context_card: d.context_card,
      }));
    }

    const { data: companies } = await supabaseAdmin
      .from("project_companies")
      .select("entity_id, role, entities(id, name, name_en, type)")
      .eq("project_id", project_id);

    return jsonResult({
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description,
        status: project.status,
        kind: project.kind,
        stage: project.stage,
        objective: project.objective,
        context_summary: project.context_summary,
        brief: project.brief,
        next_actions: project.next_actions,
        start_date: project.start_date,
        target_close: project.target_close,
      },
      documents,
      entities: (companies ?? []).map((c) => ({
        ...(c.entities as Record<string, unknown>),
        role: c.role,
      })),
    });
  },
);

// ─────────────────────────────────────────────────────────────────
// Tool 5b: list_projects
// ─────────────────────────────────────────────────────────────────

server.tool(
  "list_projects",
  "List all projects in the workspace with status, document count, and summary. Use this to find the right project before calling get_project_context.",
  {
    status: z
      .enum(["active", "archived", "paused"])
      .optional()
      .describe("Filter by status (default: all non-archived)"),
    kind: z.string().optional().describe("Filter by project kind"),
  },
  async ({ status, kind }) => {
    let query = supabaseAdmin
      .from("projects")
      .select(
        "id, name, slug, description, status, kind, stage, objective, context_summary, start_date, target_close, updated_at",
      )
      .order("updated_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    } else {
      query = query.neq("status", "archived");
    }
    if (kind) query = query.eq("kind", kind);

    const { data: projects, error } = await query;
    if (error) return textResult(`Query failed: ${error.message}`);

    // Get document counts per project
    const projectIds = (projects ?? []).map((p) => p.id);
    const docCounts: Record<string, number> = {};
    if (projectIds.length > 0) {
      const { data: links } = await supabaseAdmin
        .from("project_documents")
        .select("project_id")
        .in("project_id", projectIds);
      for (const link of links ?? []) {
        docCounts[link.project_id] = (docCounts[link.project_id] ?? 0) + 1;
      }
    }

    return jsonResult({
      count: projects?.length ?? 0,
      projects: (projects ?? []).map((p) => ({
        ...p,
        document_count: docCounts[p.id] ?? 0,
      })),
    });
  },
);

// ─────────────────────────────────────────────────────────────────
// Tool 5c: create_project
// ─────────────────────────────────────────────────────────────────

server.tool(
  "create_project",
  "Create a new project to organize documents and track work. Use when the user mentions starting a new initiative, deal, or matter that will have documents attached.",
  {
    name: z.string().describe("Project name (required)"),
    description: z
      .string()
      .optional()
      .describe("Short description of what this project covers"),
    kind: z
      .string()
      .optional()
      .describe(
        "Type of project — e.g. 'investment', 'legal', 'partnership', 'regulatory'",
      ),
    stage: z
      .string()
      .optional()
      .describe("Current stage — e.g. 'discovery', 'negotiation', 'closed'"),
    objective: z
      .string()
      .optional()
      .describe("What this project is trying to achieve"),
  },
  async ({ name, description, kind, stage, objective }) => {
    // Generate a URL-safe slug from the name
    const slug = name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\u0600-\u06ff]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);

    const insertRow: Database["public"]["Tables"]["projects"]["Insert"] = {
      name: name.trim(),
      slug: `${slug}-${Math.random().toString(36).slice(2, 6)}`,
      status: "active",
    };
    if (description) insertRow.description = description.trim();
    if (kind) insertRow.kind = kind;
    if (stage) insertRow.stage = stage;
    if (objective) insertRow.objective = objective.trim();

    const { data, error } = await supabaseAdmin
      .from("projects")
      .insert(insertRow)
      .select("id, name, slug")
      .single();

    if (error) return textResult(`Failed to create project: ${error.message}`);

    return jsonResult({
      ok: true,
      project_id: data.id,
      name: data.name,
      slug: data.slug,
    });
  },
);

// ─────────────────────────────────────────────────────────────────
// Tool 5d: link_document_to_project
// ─────────────────────────────────────────────────────────────────

server.tool(
  "link_document_to_project",
  "Attach a document to a project. Use after ingesting a document or when the user says a specific existing document belongs to a project.",
  {
    document_id: z.string(),
    project_id: z.string(),
  },
  async ({ document_id, project_id }) => {
    const { error } = await supabaseAdmin
      .from("project_documents")
      .upsert({ document_id, project_id });

    if (error) return textResult(`Failed to link: ${error.message}`);
    return jsonResult({ ok: true, document_id, project_id });
  },
);

// ─────────────────────────────────────────────────────────────────
// Tool 6: generate_report
// ─────────────────────────────────────────────────────────────────

server.tool(
  "generate_report",
  "Generate a formal DOCX report with GTEZ letterhead, formal Arabic ordinal numbering, tables, and monochrome government styling. Returns a signed download URL. Call get_style_profile first to learn the writing conventions, then call this tool with the structured content.",
  {
    title: z.string().describe("Document title for the cover page"),
    subtitle: z.string().optional().describe("Optional subtitle"),
    language: z
      .enum(["ar", "en", "mixed"])
      .describe(
        "Primary language — drives RTL layout, font selection, section labels",
      ),
    executive_summary: z
      .string()
      .describe(
        "3-5 sentence standalone summary. A reader who only reads this should know the decision and the ask.",
      ),
    sections: z
      .array(
        z.object({
          heading: z.string(),
          paragraphs: z.array(z.string()),
          tables: z
            .array(
              z.object({
                caption: z.string().optional(),
                headers: z.array(z.string()),
                rows: z.array(z.array(z.string())),
              }),
            )
            .optional(),
        }),
      )
      .describe("Ordered body sections with optional tables"),
    recommendations: z
      .array(z.string())
      .optional()
      .describe("Actionable recommendations — renderer adds formal ordinals"),
    next_steps: z
      .array(z.string())
      .optional()
      .describe("Concrete next actions with owners and dates"),
  },
  async (input) => {
    const language = normalizeReportLang(input.language);
    const sections = normalizeSections(input.sections);
    const recommendations = normalizeStringArray(input.recommendations ?? []);
    const next_steps = normalizeStringArray(input.next_steps ?? []);

    if (sections.length === 0) {
      return textResult("Error: sections array must contain at least one section with a heading and paragraphs.");
    }

    const content: ReportContent = {
      title: input.title.trim(),
      subtitle: input.subtitle?.trim() || null,
      language,
      executive_summary: input.executive_summary.trim(),
      sections,
      recommendations,
      next_steps,
    };

    const doc = buildReportDocument(content);
    const buffer = await Packer.toBuffer(doc);

    const slug = reportSlugify(content.title);
    const storagePath = `generated/${Date.now()}_${slug}_${randomUUID().slice(0, 8)}.docx`;

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: false,
      });

    if (uploadErr) {
      return textResult(`Upload failed: ${uploadErr.message}`);
    }

    const { data: signed } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL, {
        download: `${slug || "report"}.docx`,
      });

    return jsonResult({
      ok: true,
      format: "docx",
      title: content.title,
      download_url: signed?.signedUrl ?? null,
      size_bytes: buffer.length,
      sections: sections.length,
      language,
    });
  },
);

// ─────────────────────────────────────────────────────────────────
// Tool 7: generate_presentation
// ─────────────────────────────────────────────────────────────────

server.tool(
  "generate_presentation",
  "Generate a formal PPTX presentation with GTEZ slide master, native editable charts, tables, and monochrome government styling. Returns a signed download URL. Supports slide layouts: content, two_column, numbers, table, chart, section_header, conclusion. Call get_style_profile first for writing conventions.",
  {
    title: z.string().describe("Deck title on the cover slide"),
    subtitle: z.string().optional(),
    language: z
      .enum(["ar", "en", "mixed"])
      .describe("Primary language — drives RTL and font selection"),
    slides: z
      .array(
        z.object({
          layout: z.enum([
            "title",
            "section_header",
            "content",
            "two_column",
            "numbers",
            "conclusion",
            "table",
            "chart",
          ]),
          title: z.string().optional(),
          subtitle: z.string().optional(),
          bullets: z.array(z.string()).optional(),
          body: z.string().optional(),
          left: z.string().optional(),
          right: z.string().optional(),
          data: z
            .array(z.object({ label: z.string(), value: z.string() }))
            .optional()
            .describe("For 'numbers' layout: up to 4 big KPIs"),
          table: z
            .object({
              caption: z.string().optional(),
              headers: z.array(z.string()),
              rows: z.array(z.array(z.string())),
            })
            .optional(),
          chart: z
            .object({
              type: z.enum(["bar", "column", "line", "pie"]),
              categories: z.array(z.string()),
              series: z.array(
                z.object({
                  name: z.string(),
                  values: z.array(z.number()),
                }),
              ),
              caption: z.string().optional(),
            })
            .optional(),
        }),
      )
      .describe(
        "Ordered slides. Do NOT include the cover slide — it is added automatically from the title.",
      ),
  },
  async (input) => {
    const language = normalizeDeckLang(input.language);
    const slides = normalizeSlides(input.slides);

    if (slides.length === 0) {
      return textResult("Error: slides array must contain at least one slide.");
    }
    if (slides.length > 20) {
      return textResult("Error: max 20 slides. Shorten the deck.");
    }

    const content = {
      title: input.title.trim(),
      subtitle: input.subtitle?.trim() || null,
      language,
      slides,
    };

    const buffer = await buildPresentationBuffer(content);

    const slug = deckSlugify(content.title);
    const storagePath = `generated/${Date.now()}_${slug}_${randomUUID().slice(0, 8)}.pptx`;

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        upsert: false,
      });

    if (uploadErr) {
      return textResult(`Upload failed: ${uploadErr.message}`);
    }

    const { data: signed } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL, {
        download: `${slug || "presentation"}.pptx`,
      });

    return jsonResult({
      ok: true,
      format: "pptx",
      title: content.title,
      download_url: signed?.signedUrl ?? null,
      size_bytes: buffer.length,
      slides: slides.length,
      language,
    });
  },
);

// ─────────────────────────────────────────────────────────────────
// Tool 8: ingest_document
// ─────────────────────────────────────────────────────────────────

server.tool(
  "ingest_document",
  "Upload and process a document from the local filesystem. Runs the full pipeline: Azure OCR → chunking → Cohere embedding → entity extraction → context card generation. Takes 30-120 seconds for large PDFs. Returns the document ID when complete.",
  {
    file_path: z
      .string()
      .describe("Absolute path to the file on the local machine"),
    title: z
      .string()
      .optional()
      .describe("Override title (otherwise auto-detected from content)"),
    classification: z
      .enum(["PRIVATE", "PUBLIC"])
      .optional()
      .describe("Document classification (default: PRIVATE)"),
    project_id: z
      .string()
      .optional()
      .describe("Link the document to this project after processing"),
  },
  async ({ file_path, title, classification, project_id }) => {
    // Read file from disk
    let fileBuffer: Buffer;
    try {
      fileBuffer = readFileSync(file_path);
    } catch (err) {
      return textResult(
        `Cannot read file: ${(err as Error).message}`,
      );
    }

    const fileName = file_path.split("/").pop() ?? "document";

    // Validate
    const validation = validateUploadBuffer(fileBuffer, fileName);
    if (!validation.ok) {
      return textResult(`Validation failed: ${validation.error}`);
    }

    // Upload raw file to Supabase Storage
    const storagePath = `uploads/${Date.now()}_${randomUUID().slice(0, 8)}_${fileName}`;
    const { error: uploadErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, fileBuffer, { upsert: false });

    if (uploadErr) {
      return textResult(`Storage upload failed: ${uploadErr.message}`);
    }

    // Create document row
    const docId = randomUUID();
    const { error: insertErr } = await supabaseAdmin
      .from("documents")
      .insert({
        id: docId,
        title: title ?? fileName,
        type: "unknown",
        classification: classification ?? "PRIVATE",
        language: "unknown",
        file_url: storagePath,
        file_size: fileBuffer.length,
        status: "processing",
        is_current: true,
        version_number: 1,
      });

    if (insertErr) {
      return textResult(`Failed to create document record: ${insertErr.message}`);
    }

    // Run the full processing pipeline
    try {
      const result = await processDocumentContent({
        docId,
        fileBuffer,
        fileName,
        classificationOverride: classification ?? null,
        titleOverride: title ?? null,
        versionOf: null,
      });

      // Link to project if requested
      if (project_id) {
        await supabaseAdmin
          .from("project_documents")
          .upsert({ project_id, document_id: docId });
      }

      return jsonResult({
        ok: true,
        document_id: docId,
        title: result.title,
        warning: result.warningText,
        project_linked: !!project_id,
      });
    } catch (err) {
      // Update status to error
      await supabaseAdmin
        .from("documents")
        .update({
          status: "error",
          processing_error: (err as Error).message,
        })
        .eq("id", docId);

      return textResult(
        `Processing failed: ${(err as Error).message}. Document ID ${docId} saved with status 'error'.`,
      );
    }
  },
);

// ─────────────────────────────────────────────────────────────────
// Tool 9: learn_style (Phase 2)
// ─────────────────────────────────────────────────────────────────

server.tool(
  "learn_style",
  "Extract a writing style profile from reference documents. Analyzes openings, reporting verbs, transitions, closing formulas, banned phrases, and captures few-shot excerpts. The profile is saved and automatically used by get_style_profile for all future drafting.",
  {
    document_ids: z
      .array(z.string())
      .describe("UUIDs of reference documents to learn the style from"),
    language: z
      .enum(["ar", "en"])
      .describe("Language of the reference documents"),
    document_type: z
      .string()
      .optional()
      .describe("Type of document this profile applies to (default: all)"),
  },
  async ({ document_ids, language, document_type }) => {
    if (document_ids.length === 0) {
      return textResult("Error: provide at least one document ID.");
    }

    const profile = await extractStyleProfile(document_ids, language);
    const profileId = await saveStyleProfile(
      profile,
      document_ids,
      language,
      document_type ?? "*",
    );

    return jsonResult({
      ok: true,
      profile_id: profileId,
      language,
      document_type: document_type ?? "*",
      openings_extracted: profile.openings?.length ?? 0,
      verbs_extracted: profile.reporting_verbs?.length ?? 0,
      excerpts_captured: profile.few_shot_excerpts?.length ?? 0,
      tone: profile.tone_description,
    });
  },
);

// ─────────────────────────────────────────────────────────────────
// Tool 10: get_entity_graph (Phase 3)
// ─────────────────────────────────────────────────────────────────

server.tool(
  "get_entity_graph",
  "Traverse the entity relationship graph from a starting entity. Returns connected entities, relationship types, and source documents. Use this to understand who is connected to whom and how.",
  {
    entity_name: z.string().describe("Name of the entity to start from"),
    depth: z
      .number()
      .optional()
      .describe("How many hops to traverse (default 1, max 3)"),
  },
  async ({ entity_name, depth }) => {
    const maxDepth = Math.min(depth ?? 1, 3);

    const { data: entities } = await supabaseAdmin
      .from("entities")
      .select("id, name, name_en, type")
      .or(
        `name.ilike.%${entity_name}%,name_en.ilike.%${entity_name}%`,
      )
      .limit(1);

    if (!entities || entities.length === 0) {
      return textResult(`No entity found matching "${entity_name}"`);
    }

    const rootEntity = entities[0];
    const visited = new Set<string>([rootEntity.id]);
    const connections: Array<Record<string, unknown>> = [];
    let frontier = [rootEntity.id];

    for (let d = 0; d < maxDepth; d++) {
      if (frontier.length === 0) break;

      const { data: rels } = await db
        .from("entity_relationships")
        .select(
          "id, entity_a_id, entity_b_id, relation_type, direction, confidence, source_document_id",
        )
        .or(
          frontier
            .flatMap((id) => [`entity_a_id.eq.${id}`, `entity_b_id.eq.${id}`])
            .join(","),
        );

      const nextFrontier: string[] = [];
      for (const rel of rels ?? []) {
        const otherId =
          frontier.includes(rel.entity_a_id)
            ? rel.entity_b_id
            : rel.entity_a_id;

        connections.push({
          from: rel.entity_a_id,
          to: rel.entity_b_id,
          relation: rel.relation_type,
          direction: rel.direction,
          confidence: rel.confidence,
          source_document_id: rel.source_document_id,
        });

        if (!visited.has(otherId)) {
          visited.add(otherId);
          nextFrontier.push(otherId);
        }
      }
      frontier = nextFrontier;
    }

    const allIds = Array.from(visited);
    const { data: allEntities } = await supabaseAdmin
      .from("entities")
      .select("id, name, name_en, type")
      .in("id", allIds);

    return jsonResult({
      root: rootEntity,
      entities: allEntities ?? [],
      connections,
      depth: maxDepth,
    });
  },
);

// ─────────────────────────────────────────────────────────────────
// Tool 11: get_obligations (Phase 3)
// ─────────────────────────────────────────────────────────────────

server.tool(
  "get_obligations",
  "Query obligations (deadlines, commitments, action items) extracted from documents. Filter by party, status, deadline, or project.",
  {
    party: z
      .string()
      .optional()
      .describe("Filter by responsible or counterparty name"),
    status: z
      .enum(["pending", "completed", "overdue", "cancelled"])
      .optional(),
    due_before: z
      .string()
      .optional()
      .describe("ISO date — return obligations due before this date"),
    project_id: z.string().optional().describe("Filter by project"),
  },
  async ({ party, status, due_before, project_id }) => {
    let query = db
      .from("obligations")
      .select(
        "id, action, deadline, status, note, created_at, updated_at, responsible_entity_id, counterparty_entity_id, source_document_id, project_id",
      )
      .order("deadline", { ascending: true, nullsFirst: false });

    if (status) query = query.eq("status", status);
    if (due_before) query = query.lte("deadline", due_before);
    if (project_id) query = query.eq("project_id", project_id);

    const { data: obligations, error } = await query.limit(50);
    if (error) return textResult(`Query failed: ${error.message}`);

    let results = obligations ?? [];

    if (party) {
      const { data: matchingEntities } = await supabaseAdmin
        .from("entities")
        .select("id")
        .or(`name.ilike.%${party}%,name_en.ilike.%${party}%`);

      const entityIds = new Set(
        (matchingEntities ?? []).map((e) => e.id),
      );
      results = results.filter(
        (o: Record<string, unknown>) =>
          (o.responsible_entity_id &&
            entityIds.has(o.responsible_entity_id as string)) ||
          (o.counterparty_entity_id &&
            entityIds.has(o.counterparty_entity_id as string)),
      );
    }

    // Enrich with entity names
    const entityIds = new Set<string>();
    for (const o of results as Record<string, string>[]) {
      if (o.responsible_entity_id) entityIds.add(o.responsible_entity_id);
      if (o.counterparty_entity_id) entityIds.add(o.counterparty_entity_id);
    }

    const entityMap: Record<string, string> = {};
    if (entityIds.size > 0) {
      const { data } = await supabaseAdmin
        .from("entities")
        .select("id, name, name_en")
        .in("id", Array.from(entityIds));
      for (const e of data ?? []) {
        entityMap[e.id] = e.name_en ?? e.name;
      }
    }

    return jsonResult({
      count: results.length,
      obligations: results.map((o: Record<string, unknown>) => ({
        id: o.id,
        action: o.action,
        deadline: o.deadline,
        status: o.status,
        note: o.note,
        responsible: o.responsible_entity_id
          ? entityMap[o.responsible_entity_id as string] ?? o.responsible_entity_id
          : null,
        counterparty: o.counterparty_entity_id
          ? entityMap[o.counterparty_entity_id as string] ?? o.counterparty_entity_id
          : null,
        source_document_id: o.source_document_id,
        project_id: o.project_id,
      })),
    });
  },
);

// ─────────────────────────────────────────────────────────────────
// Tool 12: get_document_lineage (Phase 3)
// ─────────────────────────────────────────────────────────────────

server.tool(
  "get_document_lineage",
  "Get the full chain of a document's history — versions, references, and related documents.",
  {
    document_id: z.string().describe("UUID of the document"),
  },
  async ({ document_id }) => {
    const { data: doc } = await supabaseAdmin
      .from("documents")
      .select("id, title, type, version_of, supersedes, version_number, created_at")
      .eq("id", document_id)
      .single();

    if (!doc) return textResult(`Document not found: ${document_id}`);

    // Get all versions of this document chain
    const rootId = doc.version_of ?? doc.id;
    const { data: versions } = await supabaseAdmin
      .from("documents")
      .select("id, title, version_number, is_current, created_at")
      .or(`id.eq.${rootId},version_of.eq.${rootId}`)
      .order("version_number", { ascending: true });

    // Get references
    const { data: refs } = await supabaseAdmin
      .from("document_references")
      .select("id, source_id, target_id, reference_type, reference_text, resolved")
      .or(`source_id.eq.${document_id},target_id.eq.${document_id}`);

    return jsonResult({
      document: doc,
      versions: versions ?? [],
      references: refs ?? [],
    });
  },
);

// ─────────────────────────────────────────────────────────────────
// Tool 13: get_fact_history (Phase 3)
// ─────────────────────────────────────────────────────────────────

server.tool(
  "get_fact_history",
  "Track how a specific fact or claim has changed across documents over time. Shows the evolution of numbers, terms, or conditions.",
  {
    claim_key: z
      .string()
      .optional()
      .describe("Exact claim key to look up (e.g. 'usufruct_period')"),
    search: z
      .string()
      .optional()
      .describe("Search term to find matching facts by label"),
    entity_name: z
      .string()
      .optional()
      .describe("Find facts from documents mentioning this entity"),
  },
  async ({ claim_key, search, entity_name }) => {
    if (claim_key) {
      const { data } = await db
        .from("fact_versions")
        .select("*")
        .eq("claim_key", claim_key)
        .order("document_date", { ascending: true });

      return jsonResult({
        claim_key,
        history: data ?? [],
        changes: (data ?? []).filter((f: Record<string, unknown>) => f.previous_value !== null).length,
      });
    }

    let query = db
      .from("fact_versions")
      .select("*")
      .order("extracted_at", { ascending: false })
      .limit(50);

    if (search) {
      query = query.ilike("claim_label", `%${search}%`);
    }

    if (entity_name) {
      // Find documents that mention this entity
      const { data: entities } = await supabaseAdmin
        .from("entities")
        .select("id")
        .or(`name.ilike.%${entity_name}%,name_en.ilike.%${entity_name}%`)
        .limit(5);

      if (entities && entities.length > 0) {
        const { data: docLinks } = await supabaseAdmin
          .from("document_entities")
          .select("document_id")
          .in("entity_id", entities.map((e) => e.id));

        if (docLinks && docLinks.length > 0) {
          query = query.in(
            "source_document_id",
            docLinks.map((d) => d.document_id),
          );
        }
      }
    }

    const { data } = await query;
    return jsonResult({ facts: data ?? [] });
  },
);

// ─────────────────────────────────────────────────────────────────
// Tool 14: compare_documents (Phase 3)
// ─────────────────────────────────────────────────────────────────

server.tool(
  "compare_documents",
  "Compare two documents — shared entities, differing terms, obligations in one but not the other. Useful for tracking what changed between offer versions or memos.",
  {
    document_id_a: z.string().describe("First document UUID"),
    document_id_b: z.string().describe("Second document UUID"),
  },
  async ({ document_id_a, document_id_b }) => {
    // Fetch entities for both
    const [entA, entB] = await Promise.all([
      supabaseAdmin
        .from("document_entities")
        .select("entity_id, role, entities(name, name_en, type)")
        .eq("document_id", document_id_a),
      supabaseAdmin
        .from("document_entities")
        .select("entity_id, role, entities(name, name_en, type)")
        .eq("document_id", document_id_b),
    ]);

    const idsA = new Set((entA.data ?? []).map((e) => e.entity_id));
    const idsB = new Set((entB.data ?? []).map((e) => e.entity_id));
    const shared = [...idsA].filter((id) => idsB.has(id));
    const onlyA = [...idsA].filter((id) => !idsB.has(id));
    const onlyB = [...idsB].filter((id) => !idsA.has(id));

    // Fetch obligations for both
    const [oblA, oblB] = await Promise.all([
      db
        .from("obligations")
        .select("id, action, deadline, status")
        .eq("source_document_id", document_id_a),
      db
        .from("obligations")
        .select("id, action, deadline, status")
        .eq("source_document_id", document_id_b),
    ]);

    // Fetch facts for both
    const [factsA, factsB] = await Promise.all([
      db
        .from("fact_versions")
        .select("claim_key, claim_label, value")
        .eq("source_document_id", document_id_a),
      db
        .from("fact_versions")
        .select("claim_key, claim_label, value")
        .eq("source_document_id", document_id_b),
    ]);

    type FactRow = { claim_key: string; claim_label: string; value: string };
    const factMapA = new Map<string, FactRow>(
      (factsA.data ?? []).map((f: FactRow) => [f.claim_key, f]),
    );
    const factMapB = new Map<string, FactRow>(
      (factsB.data ?? []).map((f: FactRow) => [f.claim_key, f]),
    );

    const allKeys = new Set([...factMapA.keys(), ...factMapB.keys()]);
    const factDiffs = [...allKeys]
      .map((key) => {
        const a = factMapA.get(key);
        const b = factMapB.get(key);
        if (a && b && a.value === b.value) return null;
        return {
          claim_key: key,
          label: a?.claim_label ?? b?.claim_label ?? key,
          value_a: a?.value ?? null,
          value_b: b?.value ?? null,
        };
      })
      .filter(Boolean);

    const entityNameMap: Record<string, string> = {};
    const allEntityIds = [...idsA, ...idsB];
    if (allEntityIds.length > 0) {
      const { data } = await supabaseAdmin
        .from("entities")
        .select("id, name, name_en")
        .in("id", allEntityIds);
      for (const e of data ?? []) {
        entityNameMap[e.id] = e.name_en ?? e.name;
      }
    }

    return jsonResult({
      entities: {
        shared: shared.map((id) => entityNameMap[id] ?? id),
        only_in_a: onlyA.map((id) => entityNameMap[id] ?? id),
        only_in_b: onlyB.map((id) => entityNameMap[id] ?? id),
      },
      obligations: {
        in_a: oblA.data ?? [],
        in_b: oblB.data ?? [],
      },
      fact_differences: factDiffs,
    });
  },
);

// ─────────────────────────────────────────────────────────────────
// Tool 15: update_obligation (Phase 3)
// ─────────────────────────────────────────────────────────────────

server.tool(
  "update_obligation",
  "Update the status of an obligation — mark it complete, cancelled, or add a note. Claude can use this when the user confirms an action was taken.",
  {
    obligation_id: z.string().describe("UUID of the obligation"),
    status: z
      .enum(["pending", "completed", "overdue", "cancelled"])
      .optional(),
    note: z.string().optional().describe("Add a note about the update"),
  },
  async ({ obligation_id, status, note }) => {
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (status) updates.status = status;
    if (note) updates.note = note;

    const { data, error } = await db
      .from("obligations")
      .update(updates)
      .eq("id", obligation_id)
      .select("id, action, status, note")
      .single();

    if (error) return textResult(`Update failed: ${error.message}`);
    return jsonResult({ ok: true, obligation: data });
  },
);

// ─────────────────────────────────────────────────────────────────
// Tool 16: add_note (Phase 3)
// ─────────────────────────────────────────────────────────────────

server.tool(
  "add_note",
  "Save a note or decision to the project memory. Claude can use this to persist important context that should survive across conversations — decisions made, instructions from the user, things to remember.",
  {
    content: z.string().describe("The note content"),
    project_id: z.string().optional().describe("Link to a project"),
    type: z
      .enum(["decision", "instruction", "fact", "risk", "question"])
      .optional()
      .describe("Type of note (default: fact)"),
  },
  async ({ content, project_id, type }) => {
    const { data, error } = await supabaseAdmin
      .from("conversation_memory")
      .insert({
        kind: type ?? "fact",
        text: content,
        importance: 1.0,
        project_id: project_id ?? null,
      })
      .select("id")
      .single();

    if (error) return textResult(`Failed to save note: ${error.message}`);
    return jsonResult({
      ok: true,
      note_id: data.id,
      type: type ?? "fact",
      project_linked: !!project_id,
    });
  },
);

// ─────────────────────────────────────────────────────────────────
// Start — supports both stdio (local) and HTTP (deployed)
// ─────────────────────────────────────────────────────────────────
//
// MODE SELECTION:
//   MCP_TRANSPORT=http  → HTTP server on MCP_PORT (default 3100)
//   (default)           → stdio (for Claude Desktop local)
//
// AUTHENTICATION (HTTP mode only):
//   Set MCP_AUTH_TOKEN in env. Every request must include
//   Authorization: Bearer <token>. Without this env var, the server
//   runs without auth (NOT recommended for production).

async function startStdio() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("DocuMind MCP server running (stdio)");
}

async function startHttp() {
  // Railway injects PORT; fall back to MCP_PORT or 3100
  const port = parseInt(process.env.PORT ?? process.env.MCP_PORT ?? "3100", 10);
  const authToken = process.env.MCP_AUTH_TOKEN ?? null;

  if (!authToken) {
    console.error(
      "WARNING: MCP_AUTH_TOKEN is not set. The server is running WITHOUT authentication.",
    );
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  await server.connect(transport);

  const httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      // CORS for Claude clients
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Health check — before auth so Railway's healthcheck works
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", tools: 16 }));
        return;
      }

      // Auth check — everything after this requires a token
      if (authToken) {
        const auth = req.headers.authorization;
        if (!auth || auth !== `Bearer ${authToken}`) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }
      }

      // MCP endpoint
      if (req.url === "/mcp" || req.url === "/") {
        // Read body
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        const body = Buffer.concat(chunks).toString("utf8");

        // StreamableHTTPServerTransport expects the parsed body
        try {
          const parsed = body ? JSON.parse(body) : undefined;
          await transport.handleRequest(req, res, parsed);
        } catch (err) {
          if (!res.headersSent) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: `Invalid request: ${(err as Error).message}`,
              }),
            );
          }
        }
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    },
  );

  httpServer.listen(port, () => {
    console.error(
      `DocuMind MCP server running (HTTP) on port ${port}`,
    );
    console.error(`  Endpoint: http://localhost:${port}/mcp`);
    console.error(`  Health:   http://localhost:${port}/health`);
    console.error(`  Auth:     ${authToken ? "enabled" : "DISABLED"}`);
  });
}

async function main() {
  const mode = process.env.MCP_TRANSPORT ?? "stdio";
  if (mode === "http") {
    await startHttp();
  } else {
    await startStdio();
  }
}

main().catch((err) => {
  console.error("MCP server failed to start:", err);
  process.exit(1);
});
