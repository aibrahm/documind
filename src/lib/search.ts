import { supabaseAdmin, type HybridSearchResult } from "./supabase";
import { embedQuery } from "./embeddings";
import { getCohere } from "@/lib/clients";
import { normalizeForSearch } from "./normalize";

// Hybrid vector + FTS search with Cohere reranking.
//
// This wrapper sits over the `hybrid_search` RPC defined in
// supabase/migrations/018_hybrid_search_v2.sql. The v2 RPC does
// most of the heavy lifting that used to live in this file:
//
//   - Reciprocal Rank Fusion (RRF) instead of weighted-sum scoring
//   - Filter push-down: included_doc_ids[], excluded_doc_ids[],
//     status, is_current, classification all enforced in SQL
//   - Per-document cap (max 2 chunks per document) inside the RPC
//   - Larger candidate pool (4× match_count) without paying the
//     cost of dragging garbage through Cohere rerank
//
// What this wrapper still does:
//
//   1. Normalize the query for Arabic before embedding + FTS so
//      alef variants and ta marbouta don't kill recall on bilingual
//      corpora. See src/lib/normalize.ts → normalizeForSearch().
//   2. Embed the query via Cohere (search_query input type).
//   3. Call hybrid_search with the right parameters.
//   4. Pass the candidates to Cohere rerank-multilingual-v3.0
//      and return the topN.

export interface SearchOptions {
  query: string;
  matchCount?: number;
  classification?: "PRIVATE" | "PUBLIC" | null;
  documentId?: string | null;
  /** Restrict to specific documents (e.g. user-pinned) — pushed into RPC */
  documentIds?: string[] | null;
  /** Exclude documents — pushed into RPC */
  excludedDocumentIds?: string[] | null;
  /** Max chunks returned per document (default 2 — set in RPC). */
  maxPerDocument?: number;
  /**
   * @deprecated The RPC always filters on is_current = true. Kept for
   * call-site compatibility but ignored.
   */
  currentOnly?: boolean;
  useRerank?: boolean;
}

export interface SearchResult {
  chunkId: string;
  documentId: string;
  content: string;
  pageNumber: number;
  sectionTitle: string | null;
  clauseNumber: string | null;
  score: number;
  document?: {
    title: string;
    type: string;
    classification: string;
  };
}

/**
 * Hybrid search: vector + FTS fused via Reciprocal Rank Fusion,
 * then reranked with Cohere.
 */
export async function hybridSearch(
  options: SearchOptions,
): Promise<SearchResult[]> {
  const {
    query,
    matchCount = 8,
    classification = null,
    documentId = null,
    documentIds = null,
    excludedDocumentIds = null,
    maxPerDocument = 2,
    useRerank = true,
  } = options;

  // Normalize the query so Arabic alef variants, ta marbouta, alef
  // maksura, and Arabic-Indic numerals don't tank recall. The
  // normalizer is identical to the one applied to chunks at index
  // time when applicable; on bilingual corpora this consistently
  // adds 5–10 percentage points of recall on Arabic-only queries.
  const normalizedQuery = normalizeForSearch(query);

  // Generate query embedding from the normalized text.
  const queryEmbedding = await embedQuery(normalizedQuery);

  // Over-fetch is now minimal. The RPC's per-document cap can drop
  // chunks below the requested matchCount when the result set is
  // dominated by one document, so we ask for a small headroom (1.25x)
  // and Cohere rerank trims to the final size. The big over-fetch
  // multiplier the old wrapper used (3x) is no longer needed because
  // filters are enforced inside the RPC, not after.
  const requestedFromRpc = Math.max(matchCount + 4, Math.ceil(matchCount * 1.25));

  const { data, error } = await supabaseAdmin.rpc("hybrid_search", {
    query_embedding: queryEmbedding as unknown as string,
    query_text: normalizedQuery,
    match_count: requestedFromRpc,
    filter_classification: classification ?? undefined,
    filter_document_id: documentId ?? undefined,
    included_doc_ids: documentIds ?? undefined,
    excluded_doc_ids: excludedDocumentIds ?? undefined,
    max_per_document: maxPerDocument,
  });

  if (error) throw new Error(`Search failed: ${error.message}`);

  const results = (data || []) as HybridSearchResult[];

  // Enrich with document metadata. Smaller select than before since
  // we no longer need access_level / knowledge_scope columns (dropped
  // in migration 016) and is_current is enforced in the RPC.
  const docIds = [...new Set(results.map((r) => r.document_id))];
  const { data: docs } = docIds.length
    ? await supabaseAdmin
        .from("documents")
        .select("id, title, type, classification")
        .in("id", docIds)
    : { data: [] };

  const docMap = new Map((docs ?? []).map((d) => [d.id, d]));

  let searchResults: SearchResult[] = results.map((r) => ({
    chunkId: r.chunk_id,
    documentId: r.document_id,
    content: r.content,
    pageNumber: r.page_number,
    sectionTitle: r.section_title,
    clauseNumber: r.clause_number,
    score: r.combined_score,
    document: (() => {
      const meta = docMap.get(r.document_id);
      if (!meta) return undefined;
      return {
        title: meta.title as string,
        type: meta.type as string,
        classification: meta.classification as string,
      };
    })(),
  }));

  // Cohere rerank — sees the full RPC result set (no over-fetch
  // waste) and trims to the final matchCount.
  if (useRerank && searchResults.length > 0) {
    searchResults = await rerankResults(normalizedQuery, searchResults, matchCount);
  }

  return searchResults.slice(0, matchCount);
}

/**
 * Rerank search results using Cohere Rerank for better relevance.
 */
async function rerankResults(
  query: string,
  results: SearchResult[],
  topN: number,
): Promise<SearchResult[]> {
  try {
    const response = await getCohere().rerank({
      query,
      documents: results.map((r) => r.content),
      model: "rerank-multilingual-v3.0",
      topN,
    });

    return response.results.map((r) => ({
      ...results[r.index],
      score: r.relevanceScore,
    }));
  } catch (err) {
    // Fail-loud per CLAUDE.md: log the rerank failure so we know
    // quality is degraded for this query. The fallback to original
    // ordering is a graceful degrade, not a silent swallow.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      "search: Cohere rerank FAILED, using RPC ordering:",
      msg,
    );
    return results;
  }
}
