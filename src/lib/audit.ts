import { supabaseAdmin } from "./supabase";
import type { Json } from "./database.types";

export type AuditAction =
  | "query"
  | "document_access"
  | "upload"
  | "model_call"
  | "login"
  | "classification"
  | "extraction"
  | "project.create"
  | "project.update"
  | "project.archive";

/**
 * Log an action to the audit trail.
 */
export async function logAudit(
  action: AuditAction,
  details: Record<string, unknown>,
  scores?: Record<string, number>
): Promise<void> {
  await supabaseAdmin.from("audit_log").insert({
    action,
    details: details as unknown as Json,
    scores: (scores || null) as unknown as Json,
  });
}
