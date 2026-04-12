import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/lib/clients";
import { DEEP_ANALYSIS_MODEL } from "@/lib/models";
import { webSearch } from "@/lib/web-search";
import { runFinancialModel } from "@/lib/tools/financial-model";
import { runFetchUrl } from "@/lib/tools/fetch-url";
import { runExtractKeyTerms as runExtractWorkspaceFacts } from "@/lib/tools/extract-key-terms";
import { runCreateReport } from "@/lib/tools/create-report";
import { runCreatePresentation } from "@/lib/tools/create-presentation";

/**
 * Claude streaming with autonomous web_search tool use.
 *
 * The model can call `web_search` whenever it needs fresh external context
 * (current pricing, recent comparable deals, news on relevant companies, etc).
 * The system runs Tavily, returns results, and the model continues — possibly
 * calling the tool again. After the model produces final text without tool
 * calls, that text is streamed to the user.
 *
 * Earlier turns (tool_use → tool_result rounds) are NOT streamed — only the
 * final answer reaches the UI. We do emit lightweight status events so the
 * client can show "Searching the web for X..." while a tool round is running.
 */

export interface AdditionalWebSource {
  id: string;
  type: "web";
  title: string;
  url: string;
}

interface RunOpts {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  temperature?: number;
  maxTokens?: number;
  // Called whenever a chunk of final text is produced
  onText: (delta: string) => void;
  // Called once per tool round so the UI can display status.
  // toolName lets the UI distinguish web_search vs fetch_url etc.
  onToolStart?: (query: string, toolName?: string) => void;
  onToolEnd?: (query: string, resultCount: number, toolName?: string) => void;
  // Called once at the end with the full text
  onComplete?: (fullText: string, additionalWebSources: AdditionalWebSource[]) => void;
  // Hard limit on tool rounds to prevent infinite loops
  maxToolRounds?: number;
}

const WEB_SEARCH_TOOL: Anthropic.Tool = {
  name: "web_search",
  description:
    "Search the public web for fresh external information. Use this autonomously whenever you need current data that the indexed corpus doesn't contain — for example: current commodity prices, recent comparable deals (KIZAD, JAFZA, Tangier MED, Suez SCZone), news about a relevant company, recent regulatory changes, latest IFC project benchmarks, or any factual question requiring information beyond the user's documents. Do not ask the user for permission — just call this tool when you need fresh data.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description:
          "A focused search query in English or Arabic. Be specific. Examples: 'KIZAD East Port Said land lease pricing per square meter 2024', 'El Sewedy Electric financial performance 2024', 'Egyptian special economic zone law amendments 2024'",
      },
      reason: {
        type: "string",
        description: "One-line reason why you need this search (helps the user trust the result).",
      },
    },
    required: ["query"],
  },
};

const FINANCIAL_MODEL_TOOL: Anthropic.Tool = {
  name: "financial_model",
  description:
    "Run financial calculations with guaranteed correctness. Use this whenever the user's question involves NPV, IRR, payback period, or sensitivity analysis. DO NOT do arithmetic in your head — always call this tool for any non-trivial calculation involving cashflows, discount rates, or return metrics. Much more reliable than mental math.",
  input_schema: {
    type: "object" as const,
    properties: {
      operation: {
        type: "string",
        enum: ["npv", "irr", "payback", "sensitivity"],
        description:
          "Which calculation to run. npv = net present value (needs discount_rate). irr = internal rate of return. payback = simple payback period in years. sensitivity = NPV sweep across a range of discount rates.",
      },
      cashflows: {
        type: "array",
        description:
          "Array of cash flows. Year 0 = today. Positive amounts = inflows to the authority. Negative = outflows. Use ONE consistent currency across all entries (convert first if needed).",
        items: {
          type: "object",
          properties: {
            year: { type: "number", description: "0 = today, 1 = one year from now, etc." },
            amount: { type: "number", description: "In the chosen currency. Negative = outflow." },
          },
          required: ["year", "amount"],
        },
      },
      discount_rate: {
        type: "number",
        description: "For NPV operation. Decimal form (0.12 = 12%). Default 0.12 if not provided.",
      },
      currency: {
        type: "string",
        description: "Optional ISO-like currency code (e.g. 'EGP', 'USD'). Echoed back in the result for clarity. All cashflows must already be in this currency.",
      },
      sensitivity: {
        type: "object",
        description: "For sensitivity operation only.",
        properties: {
          variable: { type: "string", enum: ["discount_rate"] },
          min: { type: "number", description: "Start of sweep range (decimal)" },
          max: { type: "number", description: "End of sweep range (decimal)" },
          steps: { type: "number", description: "Number of discrete points in the sweep" },
        },
      },
    },
    required: ["operation", "cashflows"],
  },
};

const FETCH_URL_TOOL: Anthropic.Tool = {
  name: "fetch_url",
  description:
    "Fetch the full text content of a specific URL — supports both HTML pages AND PDF files (extracted via pdf-parse). Use this after web_search when a search result looks promising but Tavily's snippet is too short to answer the question. DON'T use this for general research — prefer web_search first. Use fetch_url only when you've already found a specific URL and need its full content. Examples: an Elsewedy investor-relations page; an official decree PDF linked from a news article.",
  input_schema: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description:
          "A full http(s):// URL. Webpages and PDF files are both supported.",
      },
    },
    required: ["url"],
  },
};

const EXTRACT_WORKSPACE_FACTS_TOOL: Anthropic.Tool = {
  name: "extract_workspace_facts",
  description:
    "Read a project's linked documents (or a specific list of documents) and extract structured commercial facts: land area, tenor, royalty, revenue share, equity split, milestones, governing law, dispute resolution, and related economic terms. Use this whenever the user wants a structured snapshot of what the source documents actually say. DO NOT extract these facts by hand — call this tool.",
  input_schema: {
    type: "object" as const,
    properties: {
      project: {
        type: "string",
        description:
          "Project slug or UUID. If provided, the tool reads ALL currently-linked documents for the project.",
      },
      document_ids: {
        type: "array",
        items: { type: "string" },
        description:
          "Explicit list of document UUIDs. Use this when the user pinned specific documents instead of working from a project.",
      },
      focus: {
        type: "string",
        description:
          "Optional natural-language hint to narrow the extraction (e.g. 'focus on financial terms' or 'milestones and timelines only').",
      },
    },
  },
};

const CREATE_REPORT_TOOL: Anthropic.Tool = {
  name: "create_report",
  description:
    "Generate a formal DOCX (Microsoft Word) report using the operator's executive template — branded header/footer, GTEZ styling, automatic RTL layout for Arabic, operator signature block. Use this whenever the user asks for a written document (memo, brief, briefing note, decision memo, analysis report, official letter, board paper). Always call this tool — never produce a DOCX via markdown tables or file names in your text. The tool returns a signed download URL you should include in your response so the user can open the file. Prefer this over long inline prose when the output is meant to be saved or shared.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: {
        type: "string",
        description:
          "Document title as it should appear on the cover. Keep it specific, e.g. 'Elsewedy Scenario 2 — Negotiation Brief' not 'Report'.",
      },
      subtitle: {
        type: "string",
        description:
          "Optional subtitle describing the document type: 'Decision Memo', 'Analysis Report', 'Term Sheet Markup', etc.",
      },
      language: {
        type: "string",
        enum: ["ar", "en", "mixed"],
        description:
          "Primary language. Drives RTL layout, font selection, and digit system. Use 'ar' when the user's conversation was in Arabic; 'en' for English; 'mixed' when both appear substantially.",
      },
      executive_summary: {
        type: "string",
        description:
          "A 3–5 sentence paragraph that stands alone. A reader who only reads this should know the decision, the rationale, and the ask. Lead with the answer, not the background.",
      },
      sections: {
        type: "array",
        description:
          "Ordered body sections. Each has a heading (H2), body paragraphs, and optional tables rendered after the prose. Typical structure: Context → Analysis → Key Numbers → Risks. Keep section count tight (3–6). Do NOT put recommendations inside sections — use the `recommendations` field instead. Use tables for comparisons, financial breakdowns, timelines, or any data that reads better as rows and columns than as prose.",
        items: {
          type: "object",
          properties: {
            heading: { type: "string", description: "Short section heading" },
            paragraphs: {
              type: "array",
              items: { type: "string" },
              description:
                "Ordered paragraphs of body text for this section. Prose preferred over bullets — use actual sentences. May be empty if the section is purely a table.",
            },
            tables: {
              type: "array",
              description:
                "Optional tables rendered after the paragraphs. Use for comparisons, financial figures, schedules, anything that reads better as a grid. Each table has headers + rows of the same length. Keep tables compact (≤ 6 columns, ≤ 12 rows) so they fit the page.",
              items: {
                type: "object",
                properties: {
                  caption: {
                    type: "string",
                    description:
                      "Optional short caption above the table (e.g. 'Table 1: Revenue projections — 2026 to 2030').",
                  },
                  headers: {
                    type: "array",
                    items: { type: "string" },
                    description: "Column headers — one string per column.",
                  },
                  rows: {
                    type: "array",
                    description:
                      "Data rows. Each row is an array of cell values (strings). Must have the same length as `headers`. Cells are plain strings — include units and currency inline (e.g. '2.3 B EGP', '14%').",
                    items: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                },
                required: ["headers", "rows"],
              },
            },
          },
          required: ["heading", "paragraphs"],
        },
      },
      recommendations: {
        type: "array",
        items: { type: "string" },
        description:
          "Numbered list of concrete recommendations. Each item should be actionable and specific. Empty array if not applicable.",
      },
      next_steps: {
        type: "array",
        items: { type: "string" },
        description:
          "Concrete next actions with owners and dates where possible (e.g. 'Finance team to draft revised term sheet by April 20'). Empty array if not applicable.",
      },
    },
    required: ["title", "language", "executive_summary", "sections"],
  },
};

const CREATE_PRESENTATION_TOOL: Anthropic.Tool = {
  name: "create_presentation",
  description:
    "Generate a formal PPTX (Microsoft PowerPoint) presentation using the operator's executive template — GTEZ slide master, consistent branding, automatic RTL for Arabic, operator signature on the title slide. Use this whenever the user asks for slides, a deck, a briefing pack, board slides, or something to present in a meeting. Always call this tool — never describe slide contents in markdown inline. Keep decks tight: 6–10 slides unless the user explicitly asks for more. Returns a signed download URL to include in your response.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: { type: "string", description: "Deck title on the cover slide" },
      subtitle: {
        type: "string",
        description: "Optional subtitle / deck description",
      },
      language: {
        type: "string",
        enum: ["ar", "en", "mixed"],
        description: "Primary language. Drives RTL layout and font selection.",
      },
      slides: {
        type: "array",
        description:
          "Ordered list of slides. Do NOT include the cover/title slide — the tool adds it automatically from the top-level title. Typical structure: context → findings → analysis → recommendations → next_steps. 4–9 slides ideal; hard cap 20.",
        items: {
          type: "object",
          properties: {
            layout: {
              type: "string",
              enum: [
                "title",
                "section_header",
                "content",
                "two_column",
                "numbers",
                "conclusion",
                "table",
                "chart",
              ],
              description:
                "Which slide layout to use. 'content' = title + bullets or paragraph. 'two_column' = side-by-side comparison (use left/right fields). 'numbers' = big-figure dashboard with up to 4 metrics (use data field). 'section_header' = divider slide between chapters. 'conclusion' = next-steps slide with eyebrow label. 'title' = extra title slide (rare, only if deck has multiple chapters). 'table' = title + tabular data (use the `table` field). 'chart' = title + native editable chart, bar/column/line/pie (use the `chart` field).",
            },
            title: {
              type: "string",
              description: "Slide title / headline",
            },
            subtitle: {
              type: "string",
              description:
                "Optional subtitle (only used by 'title' and 'section_header' layouts)",
            },
            bullets: {
              type: "array",
              items: { type: "string" },
              description:
                "Bullet points for 'content' and 'conclusion' layouts. 3–6 bullets per slide max. Short sentences. No nested bullets.",
            },
            body: {
              type: "string",
              description:
                "Paragraph body for 'content' layout when bullets are not the right form.",
            },
            left: {
              type: "string",
              description:
                "Left column body for 'two_column' layout. Use for one side of a comparison.",
            },
            right: {
              type: "string",
              description:
                "Right column body for 'two_column' layout.",
            },
            data: {
              type: "array",
              description:
                "Up to 4 key metrics for 'numbers' layout. Each item has a big-display value and a smaller caption label.",
              items: {
                type: "object",
                properties: {
                  label: {
                    type: "string",
                    description: "Metric caption (e.g. 'NPV at 12%')",
                  },
                  value: {
                    type: "string",
                    description:
                      "Big-display value as a string (so you control formatting). Include units: '2.3 B EGP', '85%', '14 yrs'.",
                  },
                },
                required: ["label", "value"],
              },
            },
            table: {
              type: "object",
              description:
                "Tabular data for 'table' layout. Keep it compact (≤ 6 columns, ≤ 10 rows) so it fits the slide. Include units in the cells ('2.3 B EGP', '14%').",
              properties: {
                caption: {
                  type: "string",
                  description: "Optional caption rendered below the table in muted type.",
                },
                headers: {
                  type: "array",
                  items: { type: "string" },
                  description: "Column headers — one string per column.",
                },
                rows: {
                  type: "array",
                  description:
                    "Data rows. Each row is an array of strings with the same length as headers.",
                  items: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
              },
              required: ["headers", "rows"],
            },
            chart: {
              type: "object",
              description:
                "Chart data for 'chart' layout. Renders a native editable PowerPoint chart (not an image). Use when the point of the slide is the shape of the numbers (trend, comparison, composition). For raw tables of figures use the 'table' layout instead. For a handful of big KPIs use 'numbers'.",
              properties: {
                type: {
                  type: "string",
                  enum: ["bar", "column", "line", "pie"],
                  description:
                    "'bar' = horizontal bars (good for category comparison with long labels). 'column' = vertical bars (good for time-series of a few points). 'line' = trend over time with multiple points. 'pie' = composition/share (single series, 3–6 slices max).",
                },
                categories: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "X-axis category labels (or slice labels for pie). Example: ['2026', '2027', '2028', '2029', '2030'].",
                },
                series: {
                  type: "array",
                  description:
                    "One or more data series. For pie charts, use exactly ONE series — its values map to the categories as slice sizes.",
                  items: {
                    type: "object",
                    properties: {
                      name: {
                        type: "string",
                        description:
                          "Series name shown in the legend (e.g. 'Revenue', 'EBITDA').",
                      },
                      values: {
                        type: "array",
                        items: { type: "number" },
                        description:
                          "Numeric values, one per category, in the same order as `categories`.",
                      },
                    },
                    required: ["name", "values"],
                  },
                },
                caption: {
                  type: "string",
                  description:
                    "Optional caption below the chart (e.g. 'Source: internal model, base case').",
                },
              },
              required: ["type", "categories", "series"],
            },
          },
          required: ["layout"],
        },
      },
    },
    required: ["title", "language", "slides"],
  },
};

export async function runClaudeWithTools(opts: RunOpts): Promise<string> {
  const {
    systemPrompt,
    messages,
    temperature = 0.3,
    maxTokens = 8192,
    onText,
    onToolStart,
    onToolEnd,
    onComplete,
    maxToolRounds = 4,
  } = opts;

  const anthropic = getAnthropic();
  // Working message list — we append assistant tool_use blocks and user
  // tool_result blocks as we go. Anthropic accepts both string and block-array
  // content forms; we use block arrays once tools are involved.
  type Block =
    | { type: "text"; text: string }
    | {
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
      }
    | { type: "tool_result"; tool_use_id: string; content: string };

  const workingMessages: Array<{ role: "user" | "assistant"; content: string | Block[] }> = [
    ...messages,
  ];

  const additionalWebSources: AdditionalWebSource[] = [];
  let fullFinalText = "";
  let round = 0;

  while (round < maxToolRounds) {
    round++;

    // Stream a single round
    const stream = anthropic.messages.stream({
      model: DEEP_ANALYSIS_MODEL,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      tools: [
        WEB_SEARCH_TOOL,
        FINANCIAL_MODEL_TOOL,
        FETCH_URL_TOOL,
        EXTRACT_WORKSPACE_FACTS_TOOL,
        CREATE_REPORT_TOOL,
        CREATE_PRESENTATION_TOOL,
      ],
      messages: workingMessages as Anthropic.MessageParam[],
    });

    // Collect tool_use blocks AND text from this round.
    //
    // KEY UX FIX: emit `onToolStart` the INSTANT Claude starts
    // streaming a tool_use block — NOT after the full JSON input has
    // been accumulated and parsed. Without this the UI goes completely
    // silent for 10-30 seconds while Claude streams the (invisible)
    // JSON payload, and the user thinks the chat is frozen.
    const TOOL_LABELS: Record<string, string> = {
      web_search: "Searching the web",
      financial_model: "Running calculations",
      create_report: "Generating report",
      create_presentation: "Building presentation",
      extract_workspace_facts: "Analyzing documents",
      fetch_url: "Fetching page",
    };

    const assistantBlocks: Block[] = [];
    let currentTextBlock: { type: "text"; text: string } | null = null;
    let currentToolUse: {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
      _inputJson: string;
    } | null = null;

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "text") {
          currentTextBlock = { type: "text", text: "" };
        } else if (event.content_block.type === "tool_use") {
          currentToolUse = {
            type: "tool_use",
            id: event.content_block.id,
            name: event.content_block.name,
            input: {},
            _inputJson: "",
          };
          // ▸ IMMEDIATE feedback — the user sees "Generating report"
          //   the moment Claude starts the tool_use block, before any
          //   JSON has been streamed. This closes the biggest perceived
          //   "hang" gap.
          onToolStart?.(
            TOOL_LABELS[event.content_block.name] || event.content_block.name,
            event.content_block.name,
          );
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta" && currentTextBlock) {
          currentTextBlock.text += event.delta.text;
          onText(event.delta.text);
          fullFinalText += event.delta.text;
        } else if (event.delta.type === "input_json_delta" && currentToolUse) {
          currentToolUse._inputJson += event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        if (currentTextBlock) {
          assistantBlocks.push(currentTextBlock);
          currentTextBlock = null;
        } else if (currentToolUse) {
          try {
            const parsed = JSON.parse(currentToolUse._inputJson || "{}");
            currentToolUse.input = parsed;
          } catch {
            currentToolUse.input = { _raw: currentToolUse._inputJson };
          }
          const { _inputJson, ...toolBlock } = currentToolUse;
          void _inputJson;
          assistantBlocks.push(toolBlock);
          currentToolUse = null;
        }
      }
    }

    // Append assistant turn to working messages
    workingMessages.push({ role: "assistant", content: assistantBlocks });

    // If there are no tool_use blocks, this round was the final answer — stop.
    const toolUses = assistantBlocks.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
    if (toolUses.length === 0) break;

    // Run each tool in parallel and build tool_result blocks.
    //
    // onToolStart already fired during the streaming phase (see above)
    // so dispatch only calls onToolEnd with the detailed result label.
    // This way the user sees "Generating report" instantly, then
    // "Drafting report: <title>" when it completes. No silent gaps.
    const toolResults: Block[] = await Promise.all(
      toolUses.map(async (tu): Promise<Block> => {
        // ── web_search ──
        if (tu.name === "web_search") {
          const query = (tu.input.query as string) || "";
          try {
            const results = await webSearch(query, 5);
            for (const r of results) {
              const id = `WEB-${additionalWebSources.length + 1}`;
              additionalWebSources.push({
                id,
                type: "web",
                title: r.title,
                url: r.url,
              });
            }
            onToolEnd?.(query, results.length, "web_search");
            const resultText =
              results.length > 0
                ? results
                    .map(
                      (r, i) =>
                        `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`,
                    )
                    .join("\n\n")
                : "No results found.";
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: resultText,
            };
          } catch (err) {
            onToolEnd?.(query, 0, "web_search");
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: `Search failed: ${(err as Error).message}`,
            };
          }
        }

        // ── financial_model ──
        if (tu.name === "financial_model") {
          try {
            const resultText = await runFinancialModel(tu.input);
            onToolEnd?.("Calculations complete", 1, "financial_model");
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: resultText,
            };
          } catch (err) {
            onToolEnd?.("Calculation failed", 0, "financial_model");
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: `Calculation failed: ${(err as Error).message}`,
            };
          }
        }

        // ── fetch_url ──
        if (tu.name === "fetch_url") {
          const url = (tu.input.url as string) || "";
          try {
            const resultText = await runFetchUrl(tu.input);
            const parsed = JSON.parse(resultText) as { ok?: boolean };
            onToolEnd?.(`Read: ${url}`, parsed.ok ? 1 : 0, "fetch_url");
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: resultText,
            };
          } catch (err) {
            onToolEnd?.(`Fetch failed: ${url}`, 0, "fetch_url");
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: `Fetch failed: ${(err as Error).message}`,
            };
          }
        }

        // ── extract_workspace_facts ──
        if (tu.name === "extract_workspace_facts") {
          const label =
            (typeof tu.input.project === "string"
              ? `project: ${tu.input.project}`
              : null) ||
            (Array.isArray(tu.input.document_ids)
              ? `${(tu.input.document_ids as string[]).length} docs`
              : "documents");
          try {
            const resultText = await runExtractWorkspaceFacts(tu.input);
            const parsed = JSON.parse(resultText) as {
              document_count?: number;
              error?: string;
            };
            onToolEnd?.(
              `Facts extracted (${label})`,
              parsed.document_count ?? 0,
              "extract_workspace_facts",
            );
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: resultText,
            };
          } catch (err) {
            onToolEnd?.(
              `Extraction failed (${label})`,
              0,
              "extract_workspace_facts",
            );
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: `Extraction failed: ${(err as Error).message}`,
            };
          }
        }

        // ── create_report ──
        if (tu.name === "create_report") {
          const title =
            (typeof tu.input.title === "string" ? tu.input.title : "") ||
            "report";
          try {
            const resultText = await runCreateReport(tu.input);
            const parsed = JSON.parse(resultText) as { ok?: boolean };
            onToolEnd?.(
              `Report ready: ${title}`,
              parsed.ok ? 1 : 0,
              "create_report",
            );
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: resultText,
            };
          } catch (err) {
            onToolEnd?.(`Report failed: ${title}`, 0, "create_report");
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: JSON.stringify({
                ok: false,
                error: `Report generation failed: ${(err as Error).message}`,
              }),
            };
          }
        }

        // ── create_presentation ──
        if (tu.name === "create_presentation") {
          const title =
            (typeof tu.input.title === "string" ? tu.input.title : "") ||
            "presentation";
          try {
            const resultText = await runCreatePresentation(tu.input);
            const parsed = JSON.parse(resultText) as { ok?: boolean };
            onToolEnd?.(
              `Deck ready: ${title}`,
              parsed.ok ? 1 : 0,
              "create_presentation",
            );
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: resultText,
            };
          } catch (err) {
            onToolEnd?.(
              `Deck failed: ${title}`,
              0,
              "create_presentation",
            );
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: JSON.stringify({
                ok: false,
                error: `Presentation generation failed: ${(err as Error).message}`,
              }),
            };
          }
        }

        // ── unknown tool name (shouldn't happen) ──
        return {
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content: `Unknown tool: ${tu.name}`,
        };
      }),
    );

    // Append the user turn that contains the tool results
    workingMessages.push({ role: "user", content: toolResults });
    // Loop continues — Claude will see the tool results and continue reasoning
  }

  // If we hit the round limit without the model producing a final text-only
  // response, force one final call WITHOUT tools so the model has to write the
  // analysis using everything it gathered. This prevents the "I'll search
  // first" → endless tool calls → no final answer failure mode.
  const lastAssistant = workingMessages[workingMessages.length - 1];
  const lastWasTextOnly =
    lastAssistant?.role === "assistant" &&
    Array.isArray(lastAssistant.content) &&
    lastAssistant.content.every((b) => (b as Block).type === "text");
  if (!lastWasTextOnly) {
    // Add a system nudge as a final user message
    workingMessages.push({
      role: "user",
      content:
        "You've gathered enough information. Now produce the final analysis using everything you've learned. Do not call any more tools — write the complete answer directly. Respond in the user's original language. If a tool returned a download URL, include it prominently so the user can access the file.",
    });

    const finalStream = anthropic.messages.stream({
      model: DEEP_ANALYSIS_MODEL,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      // No tools — model must produce text
      messages: workingMessages as Anthropic.MessageParam[],
    });

    for await (const event of finalStream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        onText(event.delta.text);
        fullFinalText += event.delta.text;
      }
    }
  }

  onComplete?.(fullFinalText, additionalWebSources);
  return fullFinalText;
}
