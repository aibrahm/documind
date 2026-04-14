import { supabaseAdmin } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import { getOpenAI } from "@/lib/clients";
import { UTILITY_MODEL } from "@/lib/models";
import { createLogger } from "@/lib/logger";

const log = createLogger("style-extraction");

export interface StyleProfile {
  openings: string[];
  reporting_verbs: string[];
  transition_phrases: string[];
  section_heading_patterns: string[];
  closing_formulas: string[];
  banned_phrases: string[];
  few_shot_excerpts: string[];
  structural_notes: string;
  tone_description: string;
}

export async function extractStyleProfile(
  documentIds: string[],
  language: string,
): Promise<StyleProfile> {
  const chunks: string[] = [];

  for (const docId of documentIds) {
    const { data } = await supabaseAdmin
      .from("chunks")
      .select("content")
      .eq("document_id", docId)
      .order("chunk_index", { ascending: true })
      .limit(20);

    if (data) {
      for (const c of data) {
        chunks.push(c.content);
      }
    }
  }

  if (chunks.length === 0) {
    throw new Error("No chunks found for the given document IDs");
  }

  const sampleText = chunks.slice(0, 30).join("\n\n---\n\n").slice(0, 12000);

  const openai = getOpenAI();
  const res = await openai.chat.completions.create({
    model: UTILITY_MODEL,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a writing style analyst. Given sample text from government documents written by a specific author, extract their distinctive writing patterns. Return valid JSON only.

Output schema:
{
  "openings": ["array of 3-5 characteristic opening patterns the author uses to start memos/sections, e.g. 'وردت صورة الخطاب الموجه...'"],
  "reporting_verbs": ["array of 5-10 verbs the author frequently uses, e.g. 'يرى', 'يعتبر', 'تجدر الإشارة'"],
  "transition_phrases": ["array of 5-8 transition phrases, e.g. 'وفيما يلي', 'ذلك لأن', 'لذا فإن'"],
  "section_heading_patterns": ["descriptions of how the author structures section headings"],
  "closing_formulas": ["array of 2-3 closing patterns"],
  "banned_phrases": ["phrases the author NEVER uses that are typical of AI/generic writing"],
  "few_shot_excerpts": ["3-5 representative paragraphs that capture the voice — EXACT quotes from the text"],
  "structural_notes": "one paragraph describing the document structure pattern",
  "tone_description": "one paragraph describing the tone and register"
}

Focus on VOICE and STRUCTURE, not content/topics. The author may write about different subjects but their style remains consistent.`,
      },
      {
        role: "user",
        content: `Language: ${language}\n\nDocument samples:\n\n${sampleText}`,
      },
    ],
  });

  const raw = res.choices[0].message.content ?? "{}";
  const profile: StyleProfile = JSON.parse(raw);

  log.info("Style profile extracted", {
    documentIds: documentIds.length,
    language,
    openings: profile.openings?.length ?? 0,
    verbs: profile.reporting_verbs?.length ?? 0,
    excerpts: profile.few_shot_excerpts?.length ?? 0,
  });

  return profile;
}

export async function saveStyleProfile(
  profile: StyleProfile,
  documentIds: string[],
  language: string,
  documentType: string = "*",
): Promise<string> {
  // Deactivate previous profiles for same user/language/type
  await supabaseAdmin
    .from("style_profiles")
    .update({ is_active: false })
    .eq("user_id", "default")
    .eq("language", language)
    .eq("document_type", documentType)
    .eq("is_active", true);

  const { data, error } = await supabaseAdmin
    .from("style_profiles")
    .insert({
      user_id: "default",
      document_type: documentType,
      language,
      profile_json: profile as unknown as Database["public"]["Tables"]["style_profiles"]["Insert"]["profile_json"],
      source_document_ids: documentIds,
      is_active: true,
      version: 1,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to save style profile: ${error.message}`);
  return data.id;
}

export async function getActiveStyleProfile(
  language: string,
): Promise<StyleProfile | null> {
  const { data } = await supabaseAdmin
    .from("style_profiles")
    .select("profile_json")
    .eq("user_id", "default")
    .eq("language", language)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!data) return null;
  return data.profile_json as unknown as StyleProfile;
}
