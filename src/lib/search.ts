import { supabaseAdmin, type HybridSearchResult } from "./supabase";
import { embedQuery } from "./embeddings";
import { getCohere } from "@/lib/clients";

// Hybrid vector + FTS search with Cohere reranking.
//
// Post-DOCTRINE cleanup: the previous API exposed `knowledgeScopes` and
// `accessLevels` filters built on top of the dead `knowledge_scope`
// column and the overlapping `access_level` column. Both concepts
// collapsed into the single binary `classification` field in the same
// release. The old filter params are gone — if you need to restrict to
// library-pool docs (not linked to any project), pass the ids through
// `excludedDocumentIds` explicitly. The caller (chat-turn.ts) is the
// only code that cares about that distinction and it already computes
// the exclusion set there.

export interface SearchOptions {
  query: string;
  matchCount?: number;
  classification?: "PRIVATE" | "PUBLIC" | null;
  documentId?: string | null;
  /** Restrict to specific documents (e.g. user-pinned) */
  documentIds?: string[] | null;
  /** Explicitly exclude documents after search + enrichment */
  excludedDocumentIds?: string[] | null;
  /** When true (default), only return chunks from documents marked is_current=true */
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
 * Hybrid search: vector similarity + FTS, merged and reranked.
 */
export async function hybridSearch(options: SearchOptions): Promise<SearchResult[]> {
  const {
    query,
    matchCount = 10,
    classification = null,
    documentId = null,
    documentIds = null,
    excludedDocumentIds = null,
    currentOnly = true,
    useRerank = true,
  } = options;

  // Generate query embedding
  const queryEmbedding = await embedQuery(query);

  // Over-fetch when we'll be post-filtering by is_current or document set
  // so we don't lose slots after the filter.
  const willPostFilter = currentOnly || (documentIds && documentIds.length > 0);
  const overFetchMultiplier = useRerank ? 3 : willPostFilter ? 2 : 1;

  // Call the hybrid_search database function
  const { data, error } = await supabaseAdmin.rpc("hybrid_search", {
    query_embedding: queryEmbedding as unknown as string,
    query_text: query,
    match_count: matchCount * overFetchMultiplier,
    filter_classification: classification ?? undefined,
    filter_document_id: documentId ?? undefined,
  });

  if (error) throw new Error(`Search failed: ${error.message}`);

  const results = (data || []) as HybridSearchResult[];

  // Enrich with document metadata (and is_current flag)
  const docIds = [...new Set(results.map((r) => r.document_id))];
  const { data: docs } = await supabaseAdmin
    .from("documents")
    .select("id, title, type, classification, is_current")
    .in("id", docIds);

  const docMap = new Map(docs?.map((d) => [d.id, d]) || []);

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

  // Filter out chunks from non-current document versions (avoids old/superseded
  // versions polluting results when the user has multiple versions of the same doc).
  if (currentOnly) {
    searchResults = searchResults.filter((r) => {
      const meta = docMap.get(r.documentId);
      return meta?.is_current !== false;
    });
  }

  // Restrict to a specific document set (user-pinned via @ mention)
  if (documentIds && documentIds.length > 0) {
    const allowed = new Set(documentIds);
    searchResults = searchResults.filter((r) => allowed.has(r.documentId));
  }

  if (excludedDocumentIds && excludedDocumentIds.length > 0) {
    const excluded = new Set(excludedDocumentIds);
    searchResults = searchResults.filter((r) => !excluded.has(r.documentId));
  }

  // Rerank with Cohere for better quality
  if (useRerank && searchResults.length > 0) {
    searchResults = await rerankResults(query, searchResults, matchCount);
  }

  return searchResults.slice(0, matchCount);
}

/**
 * Rerank search results using Cohere Rerank for better relevance.
 */
async function rerankResults(
  query: string,
  results: SearchResult[],
  topN: number
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
    // Fail-loud per CLAUDE.md: log the rerank failure so we know quality is
    // degraded for this query. The fallback to original ordering is OK as a
    // graceful degrade, but the silent swallow was hiding outages.
    const msg = err instanceof Error ? err.message : String(err);
    console.error("search: Cohere rerank FAILED, using original ordering:", msg);
    return results;
  }
}
