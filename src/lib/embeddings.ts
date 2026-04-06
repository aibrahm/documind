import { getCohere } from "@/lib/clients";

const EMBEDDING_MODEL = "embed-multilingual-v3.0";
const BATCH_SIZE = 96; // Cohere max batch size

export type EmbeddingInputType = "search_document" | "search_query";

/**
 * Generate embeddings for an array of texts using Cohere embed-multilingual-v3.
 * Returns 1024-dimensional vectors optimized for Arabic + English.
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

  // Process in batches
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    const response = await getCohere().embed({
      texts: batch,
      model: EMBEDDING_MODEL,
      inputType,
      embeddingTypes: ["float"],
    });

    const embeddings = response.embeddings;
    if (embeddings && "float" in embeddings && embeddings.float) {
      allEmbeddings.push(...embeddings.float);
    }
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
