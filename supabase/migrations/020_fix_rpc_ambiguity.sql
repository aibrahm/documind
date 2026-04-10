-- Fix column ambiguity in migrations 018 + 019.
--
-- Both hybrid_search v2 and search_conversations declared RETURNS TABLE
-- with column names that collided with column names used inside the
-- query body (chunk_id, conversation_id). PL/pgSQL can't disambiguate
-- a bare reference between the output row's column and a CTE row's
-- column when they share a name, so every call threw:
--
--     column reference "chunk_id" is ambiguous
--
-- Fix: rename the CTE-internal columns to not collide with the
-- output signature. The output column names stay the same (so the
-- wrapper and the generated Supabase types don't need to change).

drop function if exists hybrid_search(vector(1024), text, integer, text, uuid, uuid[], uuid[], integer);
drop function if exists search_conversations(text, integer);

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
  rrf_k integer := 60;
  candidate_pool integer := greatest(match_count * 4, 40);
begin
  return query
  with
    vector_results as (
      select
        c.id as cid,
        c.document_id as doc_id,
        c.content as body,
        c.page_number as pg,
        c.section_title as sect,
        c.clause_number as cls,
        (1 - (c.embedding <=> query_embedding))::real as sim,
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
    fts_results as (
      select
        c.id as cid,
        c.document_id as doc_id,
        c.content as body,
        c.page_number as pg,
        c.section_title as sect,
        c.clause_number as cls,
        ts_rank(to_tsvector('simple', c.content), plainto_tsquery('simple', query_text))::real as rnk,
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
      order by rnk desc
      limit candidate_pool
    ),
    merged as (
      select cid from vector_results
      union
      select cid from fts_results
    ),
    fused as (
      select
        m.cid,
        coalesce(vr.doc_id, fr.doc_id) as doc_id,
        coalesce(vr.body, fr.body) as body,
        coalesce(vr.pg, fr.pg) as pg,
        coalesce(vr.sect, fr.sect) as sect,
        coalesce(vr.cls, fr.cls) as cls,
        coalesce(vr.sim, 0::real) as sim,
        coalesce(fr.rnk, 0::real) as rnk,
        (
          coalesce(1.0 / (rrf_k + vr.v_rank), 0)
          + coalesce(1.0 / (rrf_k + fr.f_rank), 0)
        )::double precision as score
      from merged m
      left join vector_results vr on vr.cid = m.cid
      left join fts_results fr on fr.cid = m.cid
    ),
    capped as (
      select
        f.*,
        row_number() over (
          partition by f.doc_id
          order by f.score desc
        ) as doc_rank
      from fused f
    )
  select
    capped.cid as chunk_id,
    capped.doc_id as document_id,
    capped.body as content,
    capped.pg as page_number,
    capped.sect as section_title,
    capped.cls as clause_number,
    capped.sim as similarity,
    capped.rnk as fts_rank,
    capped.score as combined_score
  from capped
  where capped.doc_rank <= max_per_document
  order by capped.score desc
  limit match_count;
end;
$$ language plpgsql;

-- Same fix for search_conversations.
create or replace function search_conversations(
  query_text text,
  match_count integer default 20
)
returns table (
  conversation_id uuid,
  conversation_title text,
  project_id uuid,
  matched_message_id uuid,
  matched_message_role text,
  snippet text,
  rank real,
  last_message_at timestamptz
) as $$
begin
  return query
  with ranked_messages as (
    select
      m.id as mid,
      m.conversation_id as cid,
      m.role as mrole,
      m.content as body,
      ts_rank(
        to_tsvector('simple', m.content),
        plainto_tsquery('simple', query_text)
      ) as r
    from messages m
    where to_tsvector('simple', m.content) @@ plainto_tsquery('simple', query_text)
  ),
  best_per_convo as (
    select distinct on (cid)
      cid,
      mid,
      mrole,
      body,
      r
    from ranked_messages
    order by cid, r desc, mid
  )
  select
    c.id as conversation_id,
    c.title as conversation_title,
    c.project_id,
    bpc.mid as matched_message_id,
    bpc.mrole as matched_message_role,
    ts_headline(
      'simple',
      bpc.body,
      plainto_tsquery('simple', query_text),
      'StartSel=«, StopSel=», MaxWords=30, MinWords=15, MaxFragments=1, FragmentDelimiter=" ... "'
    ) as snippet,
    bpc.r as rank,
    c.last_message_at
  from best_per_convo bpc
  join conversations c on c.id = bpc.cid
  order by bpc.r desc, c.last_message_at desc nulls last
  limit match_count;
end;
$$ language plpgsql;
