import { getCohere } from "@/lib/clients";
import { withRetry } from "@/lib/retry";

const EMBEDDING_MODEL = "embed-multilingual-v3.0";
// Cohere max batch size is 96, but we use a smaller window so a transient
// failure retries a smaller amount of work. Large documents (thousands of
// chunks) will still fit inside the per-request latency budget because
// retries only kick in on failure.
const BATCH_SIZE = 32;

export type EmbeddingInputType = "search_document" | "search_query";

/**
 * Generate embeddings for an array of texts using Cohere embed-multilingual-v3.
 * Returns 1024-dimensional vectors optimized for Arabic + English.
 *
 * Each batch is wrapped in exponential-backoff retries so a single flaky
 * network call doesn't leave the document half-embedded (previously a
 * 50+ chunk doc would silently lose batches, mark itself `ready`, and
 * then produce worse retrieval quality that the user couldn't diagnose —
 * see CONCERNS.md B1/B2). On final failure we throw so the outer caller
 * can mark the document status as `error` rather than shipping a half-
 * indexed row.
 *
 * @param texts - Array of text strings to embed
 * @param inputType - "search_document" for indexing, "search_query" for queries
 */
export async function generateEmbeddings(
  texts: string[],
  inputType: EmbeddingInputType = "search_document"
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    const batchEmbeddings = await withRetry(
      async () => {
        const response = await getCohere().embed({
          texts: batch,
          model: EMBEDDING_MODEL,
          inputType,
          embeddingTypes: ["float"],
        });
        const embeddings = response.embeddings;
        if (!embeddings || !("float" in embeddings) || !embeddings.float) {
          throw new Error("Cohere returned no float embeddings for batch");
        }
        return embeddings.float;
      },
      {
        maxAttempts: 4,
        initialDelayMs: 250,
        label: `cohere embed batch[${i}..${i + batch.length}]`,
      },
    );

    allEmbeddings.push(...batchEmbeddings);
  }

  return allEmbeddings;
}

/**
 * Generate a single embedding for a query string.
 */
export async function embedQuery(query: string): Promise<number[]> {
  const [embedding] = await generateEmbeddings([query], "search_query");
  return embedding;
}
