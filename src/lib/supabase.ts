import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Add it to .env.local or your deployment environment.`,
    );
  }
  return value;
}

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

// Client-side Supabase client (browser)
export function createBrowserClient() {
  return createClient<Database>(supabaseUrl, supabaseAnonKey);
}

// Admin client — lazy singleton. Fail loud per CLAUDE.md: if the service
// role key is missing we throw at first use rather than silently falling
// back to a placeholder that produces cryptic downstream errors.
let _admin: ReturnType<typeof createClient<Database>> | null = null;
export const supabaseAdmin = (() => {
  if (!_admin) {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY is not set. Server-side Supabase access " +
          "requires the service role key. Add it to .env.local or your " +
          "deployment environment.",
      );
    }
    _admin = createClient<Database>(supabaseUrl, serviceRoleKey);
  }
  return _admin;
})();

// ============================================================
// Type definitions matching the database schema
// ============================================================

export interface Document {
  id: string;
  title: string;
  type: string;
  // Post-migration 015/016: classification is binary. PRIVATE means
  // confidential (encrypt at rest, don't cite in outbound drafts),
  // PUBLIC means safe to quote. Legacy DOCTRINE rows were migrated
  // to PUBLIC in 015 and the whole concept is gone from the schema.
  // Role (working vs reference) is derived from project_documents
  // linkage — not stored as a column.
  classification: "PRIVATE" | "PUBLIC";
  summary_status: "none" | "queued" | "ready" | "error";
  language: string;
  file_url: string;
  file_size: number | null;
  page_count: number | null;
  metadata: Record<string, unknown>;
  entities: string[];
  encrypted_content: string | null;
  context_card: Record<string, unknown> | null;
  version_of: string | null;
  supersedes: string | null;
  version_number: number;
  is_current: boolean;
  status: "pending" | "processing" | "ready" | "error";
  processing_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Chunk {
  id: string;
  document_id: string;
  content: string;
  embedding: number[] | null;
  page_number: number;
  section_title: string | null;
  clause_number: string | null;
  chunk_index: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Entity {
  id: string;
  name: string;
  name_en: string | null;
  type: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface DocumentReference {
  id: string;
  source_id: string;
  target_id: string | null;
  reference_text: string;
  reference_type: string;
  resolved: boolean;
  created_at: string;
}

export interface DocumentArtifact {
  id: string;
  document_id: string;
  kind: string;
  version: number;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Doctrine {
  id: string;
  name: string;
  title: string;
  content_ar: string;
  content_en: string;
  version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  details: Record<string, unknown>;
  scores: Record<string, number> | null;
  created_at: string;
}

export interface HybridSearchResult {
  chunk_id: string;
  document_id: string;
  content: string;
  page_number: number;
  section_title: string | null;
  clause_number: string | null;
  similarity: number;
  fts_rank: number;
  combined_score: number;
}
