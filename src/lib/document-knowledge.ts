// src/lib/document-knowledge.ts
//
// Document classification helpers. Post migration 015 this collapses to a
// single binary concept: is this document confidential (PRIVATE) or safe
// to quote/cite (PUBLIC).
//
// Historical context: this module used to surface three fields —
// `access_level`, `knowledge_scope`, and `classification` — which between
// them encoded a confusing three-way categorization (private / public /
// doctrine) plus orthogonal scope labels (project / shared_reference /
// institutional_doctrine / thread_local). All of that collapsed into two
// simple ideas:
//
//   1. Classification: PRIVATE or PUBLIC. One binary column.
//   2. Role: derived from whether the document is linked to any project
//      via project_documents — not stored as a column at all.
//
// Anything that used to look like "institutional doctrine" is now PUBLIC
// reference material sitting in the library without a project link.
// The old columns (access_level, knowledge_scope) are still in the
// schema for backward-compat reads, but nothing writes to them any
// more and the helpers below no longer branch on them.

export type Classification = "PRIVATE" | "PUBLIC";

interface DocumentLike {
  classification?: string | null;
}

/**
 * Normalize any legacy classification value into the binary set.
 * DOCTRINE (now extinct) maps to PUBLIC because every historical
 * DOCTRINE row was published reference material.
 */
export function normalizeClassification(
  value: string | null | undefined,
): Classification {
  if (value === "PUBLIC") return "PUBLIC";
  if (value === "DOCTRINE") return "PUBLIC"; // legacy rows
  return "PRIVATE";
}

export function isPrivateDocument(doc: DocumentLike): boolean {
  return normalizeClassification(doc.classification) === "PRIVATE";
}

/**
 * Human-readable one-word label used in UI chips and the document
 * inventory line the model sees in its system prompt. Kept short so it
 * doesn't dominate the line visually.
 */
export function formatClassificationLabel(doc: DocumentLike): string {
  return normalizeClassification(doc.classification) === "PRIVATE"
    ? "CONFIDENTIAL"
    : "OPEN";
}

/** @deprecated Use formatClassificationLabel directly. Kept because
 *  chat-turn.ts still imports this name from the document-inventory
 *  formatter helper. Can be removed in the next rename pass. */
export function formatKnowledgeLabel(doc: DocumentLike): string {
  return formatClassificationLabel(doc);
}
