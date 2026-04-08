import { supabaseAdmin } from "@/lib/supabase";
import type { Json } from "@/lib/database.types";
import type { ExtractionArtifact } from "@/lib/extraction-schema";

const EXTRACTION_ARTIFACT_VERSION = 1;
const LEGACY_BUCKET = "documents";
const EXTRACTION_KIND = "extraction";

export function getLegacyExtractionArtifactPath(documentId: string): string {
  return `artifacts/${documentId}/extraction-v${EXTRACTION_ARTIFACT_VERSION}.pdf`;
}

function resolveLegacyExtractionArtifactPath(
  documentId: string,
  metadata: Record<string, unknown> | null | undefined,
): string {
  const artifacts =
    metadata && typeof metadata.artifacts === "object" && metadata.artifacts
      ? (metadata.artifacts as Record<string, unknown>)
      : null;
  const storedPath =
    artifacts && typeof artifacts.extractionPath === "string"
      ? artifacts.extractionPath
      : null;
  return storedPath || getLegacyExtractionArtifactPath(documentId);
}

export async function writeExtractionArtifact(
  documentId: string,
  artifact: ExtractionArtifact,
): Promise<{ error: string | null }> {
  const { error } = await supabaseAdmin.from("document_artifacts").upsert(
    {
      document_id: documentId,
      kind: EXTRACTION_KIND,
      version: artifact.version,
      payload: artifact as unknown as Json,
    },
    { onConflict: "document_id,kind" },
  );

  return { error: error ? error.message : null };
}

async function readLegacyExtractionArtifact(
  documentId: string,
  metadata: Record<string, unknown> | null | undefined,
): Promise<ExtractionArtifact | null> {
  const path = resolveLegacyExtractionArtifactPath(documentId, metadata);
  const { data, error } = await supabaseAdmin.storage
    .from(LEGACY_BUCKET)
    .download(path);
  if (error || !data) {
    return null;
  }

  try {
    const text = await data.text();
    return JSON.parse(text) as ExtractionArtifact;
  } catch (err) {
    console.error("Failed to parse legacy extraction artifact JSON:", err);
    return null;
  }
}

export async function readExtractionArtifact(
  documentId: string,
  metadata: Record<string, unknown> | null | undefined,
): Promise<ExtractionArtifact | null> {
  const { data, error } = await supabaseAdmin
    .from("document_artifacts")
    .select("payload")
    .eq("document_id", documentId)
    .eq("kind", EXTRACTION_KIND)
    .maybeSingle();

  if (error) {
    console.error("Failed to read extraction artifact:", error);
  }

  const payload =
    data?.payload &&
    typeof data.payload === "object" &&
    !Array.isArray(data.payload)
      ? (data.payload as unknown as ExtractionArtifact)
      : null;

  if (payload) return payload;

  return readLegacyExtractionArtifact(documentId, metadata);
}

export async function deleteExtractionArtifact(
  documentId: string,
  metadata: Record<string, unknown> | null | undefined,
) {
  await supabaseAdmin
    .from("document_artifacts")
    .delete()
    .eq("document_id", documentId)
    .eq("kind", EXTRACTION_KIND);

  const legacyPath = resolveLegacyExtractionArtifactPath(documentId, metadata);
  await supabaseAdmin.storage.from(LEGACY_BUCKET).remove([legacyPath]);
}
