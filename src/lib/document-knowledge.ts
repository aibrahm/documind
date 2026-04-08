export type AccessLevel = "private" | "public";
export type KnowledgeScope =
  | "project"
  | "shared_reference"
  | "institutional_doctrine"
  | "thread_local";

type LegacyClassification = "PRIVATE" | "PUBLIC" | "DOCTRINE";

interface LegacyDocumentSemantics {
  classification?: string | null;
  access_level?: string | null;
  knowledge_scope?: string | null;
}

export function normalizeAccessLevel(
  value: string | null | undefined,
  fallbackClassification?: string | null,
): AccessLevel {
  if (value === "private" || value === "public") return value;
  const classification = normalizeLegacyClassification(fallbackClassification);
  return classification === "PRIVATE" ? "private" : "public";
}

export function normalizeKnowledgeScope(
  value: string | null | undefined,
  fallbackClassification?: string | null,
): KnowledgeScope {
  if (
    value === "project" ||
    value === "shared_reference" ||
    value === "institutional_doctrine" ||
    value === "thread_local"
  ) {
    return value;
  }
  const classification = normalizeLegacyClassification(fallbackClassification);
  if (classification === "DOCTRINE") return "institutional_doctrine";
  if (classification === "PUBLIC") return "shared_reference";
  return "project";
}

export function isPrivateDocument(doc: LegacyDocumentSemantics): boolean {
  return normalizeAccessLevel(doc.access_level, doc.classification) === "private";
}

export function isInstitutionalDocument(doc: LegacyDocumentSemantics): boolean {
  return (
    normalizeKnowledgeScope(doc.knowledge_scope, doc.classification) ===
    "institutional_doctrine"
  );
}

export function formatKnowledgeLabel(doc: LegacyDocumentSemantics): string {
  const accessLevel = normalizeAccessLevel(doc.access_level, doc.classification);
  const knowledgeScope = normalizeKnowledgeScope(
    doc.knowledge_scope,
    doc.classification,
  );
  const accessLabel = accessLevel === "private" ? "PRIVATE" : "PUBLIC";
  const scopeLabel =
    knowledgeScope === "institutional_doctrine"
      ? "DOCTRINE"
      : knowledgeScope === "shared_reference"
        ? "SHARED"
        : knowledgeScope === "thread_local"
          ? "THREAD"
          : "PROJECT";
  return `${accessLabel} · ${scopeLabel}`;
}

function normalizeLegacyClassification(
  classification: string | null | undefined,
): LegacyClassification {
  if (
    classification === "PRIVATE" ||
    classification === "PUBLIC" ||
    classification === "DOCTRINE"
  ) {
    return classification;
  }
  return "PRIVATE";
}
