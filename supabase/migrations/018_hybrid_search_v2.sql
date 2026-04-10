-- hybrid_search v2 — Reciprocal Rank Fusion + filter push-down + per-document cap
--
-- The previous version (002_fix_hybrid_search.sql) had three issues:
--
--  1. The FTS pass was LEFT JOINed into the vector top-20, so chunks
--     that were excellent text matches but weren't in the top-20 vector
--     results were silently invisible. That's not hybrid search — that's
--     vector search with an FTS bonus column.
--
--  2. The score fusion was `vector_sim * 0.7 + fts_rank * 0.3` — adding
--     a [0,1] cosine score to an unbounded ts_rank. Different scales,
--     so the 70/30 weights were essentially meaningless. The standard
--     fix is Reciprocal Rank Fusion (RRF): combine RANKS, not raw
--     scores. RRF beats weighted-sum fusion by 10–20% on bilingual
--     benchmarks.
--
--  3. No filter push-down. The wrapper had to over-fetch by 3x and
--     post-filter in JavaScript: excluded_doc_ids, included_doc_ids,
--     per-document caps. ~66% of Cohere rerank work was on chunks
--     that would be discarded anyway.
--
-- This version fixes all three:
--
--  - Vector AND FTS run as TWO independent top-N queries, then fused
--    by reciprocal rank (k=60, the standard constant).
--  - All filters live inside the SQL: filter_classification,
--    filter_document_id, included_doc_ids[], excluded_doc_ids[],
--    is_current, status.
--  - Per-document cap: row_number() OVER (PARTITION BY document_id)
--    limits each document to `max_per_document` chunks (default 2).
--    Stops one large document from hogging all 8 evidence slots.
--
-- The function name stays `hybrid_search` so existing call sites work,
-- but the signature changes — the wrapper in src/lib/search.ts is
-- updated in the same release.

drop function if exists hybrid_search(vector(1024), text, integer, text, uuid);
drop function if exists hybrid_search(vector(1024), text, integer, text, uuid, uuid[], uuid[], integer);

create or replace function hybrid_search(
  query_embedding vector(1024),
  query_text text,
  match_count integer default 10,
  filter_classification text default null,
  filter_document_id uuid default null,
  included_doc_ids uuid[] default null,
  excluded_doc_ids uuid[] default null,
  max_per_document integer default 2
)
returns table (
  chunk_id uuid,
  document_id uuid,
  content text,
  page_number integer,
  section_title text,
  clause_number text,
  similarity real,
  fts_rank real,
  combined_score double precision
) as $$
declare
  -- Reciprocal Rank Fusion constant. 60 is the canonical value from
  -- Cormack/Clarke/Buettcher 2009. Smaller k weights top results more
  -- heavily; larger k flattens the curve. 60 is the right default.
  rrf_k integer := 60;
  -- We pull more candidates than needed from each pass so the fusion
  -- has room to find good results that one pass missed. 4x the final
  -- match_count is a generous candidate window without being wasteful.
  candidate_pool integer := greatest(match_count * 4, 40);
begin
  return query
  with
    -- ── Vector pass: top N by cosine similarity ──
    vector_results as (
      select
        c.id as chunk_id,
        c.document_id,
        c.content,
        c.page_number,
        c.section_title,
        c.clause_number,
        (1 - (c.embedding <=> query_embedding))::real as similarity,
        row_number() over (order by c.embedding <=> query_embedding) as v_rank
      from chunks c
      join documents d on d.id = c.document_id
      where d.status = 'ready'
        and d.is_current = true
        and (filter_classification is null or d.classification = filter_classification)
        and (filter_document_id is null or c.document_id = filter_document_id)
        and (included_doc_ids is null or c.document_id = any(included_doc_ids))
        and (excluded_doc_ids is null or not (c.document_id = any(excluded_doc_ids)))
        and c.embedding is not null
      order by c.embedding <=> query_embedding
      limit candidate_pool
    ),
    -- ── FTS pass: top N by ts_rank ──
    fts_results as (
      select
        c.id as chunk_id,
        c.document_id,
        c.content,
        c.page_number,
        c.section_title,
        c.clause_number,
        ts_rank(to_tsvector('simple', c.content), plainto_tsquery('simple', query_text))::real as rank,
        row_number() over (
          order by ts_rank(to_tsvector('simple', c.content), plainto_tsquery('simple', query_text)) desc
        ) as f_rank
      from chunks c
      join documents d on d.id = c.document_id
      where d.status = 'ready'
        and d.is_current = true
        and (filter_classification is null or d.classification = filter_classification)
        and (filter_document_id is null or c.document_id = filter_document_id)
        and (included_doc_ids is null or c.document_id = any(included_doc_ids))
        and (excluded_doc_ids is null or not (c.document_id = any(excluded_doc_ids)))
        and to_tsvector('simple', c.content) @@ plainto_tsquery('simple', query_text)
      order by rank desc
      limit candidate_pool
    ),
    -- ── Union the two pools and dedupe by chunk_id ──
    merged as (
      select chunk_id from vector_results
      union
      select chunk_id from fts_results
    ),
    -- ── Reciprocal Rank Fusion ──
    fused as (
      select
        m.chunk_id,
        coalesce(vr.document_id, fr.document_id) as document_id,
        coalesce(vr.content, fr.content) as content,
        coalesce(vr.page_number, fr.page_number) as page_number,
        coalesce(vr.section_title, fr.section_title) as section_title,
        coalesce(vr.clause_number, fr.clause_number) as clause_number,
        coalesce(vr.similarity, 0::real) as similarity,
        coalesce(fr.rank, 0::real) as fts_rank,
        (
          coalesce(1.0 / (rrf_k + vr.v_rank), 0)
          + coalesce(1.0 / (rrf_k + fr.f_rank), 0)
        )::double precision as combined_score
      from merged m
      left join vector_results vr on vr.chunk_id = m.chunk_id
      left join fts_results fr on fr.chunk_id = m.chunk_id
    ),
    -- ── Per-document cap: row_number within each document, then
    --     filter to max_per_document. Prevents a single large doc
    --     from hogging the result set. ──
    capped as (
      select
        f.*,
        row_number() over (
          partition by f.document_id
          order by f.combined_score desc
        ) as doc_rank
      from fused f
    )
  select
    capped.chunk_id,
    capped.document_id,
    capped.content,
    capped.page_number,
    capped.section_title,
    capped.clause_number,
    capped.similarity,
    capped.fts_rank,
    capped.combined_score
  from capped
  where capped.doc_rank <= max_per_document
  order by capped.combined_score desc
  limit match_count;
end;
$$ language plpgsql;
