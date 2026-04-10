-- Full-text search index on messages.content for the in-chat
-- conversation search.
--
-- The sidebar conversation search used to be a client-side
-- string.includes() filter against conversation TITLES — useless if
-- the user remembers what was discussed but not what they named the
-- thread. The new /api/conversations/search endpoint hits message
-- content directly via to_tsvector('simple', content) and returns
-- ranked snippets.
--
-- 'simple' tokenizer (no stemming, no stopword removal) is the right
-- choice for a bilingual Arabic/English corpus — Postgres has no
-- native Arabic configuration, and the English stemmer mangles
-- Arabic transliterations. The 'simple' config tokenizes on word
-- boundaries which works for both scripts.
--
-- The index is a generated tsvector + GIN, which gives O(1) lookup
-- for term presence and supports ts_rank for snippet relevance
-- ordering.

create index if not exists messages_content_fts_idx
  on public.messages
  using gin (to_tsvector('simple', content));

-- Helper RPC for search. Joins messages → conversations and
-- returns one row per matching conversation with the highest-ranked
-- matching message snippet. The caller can render this directly in
-- the sidebar without a second round-trip.

drop function if exists search_conversations(text, integer);

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
      m.id as message_id,
      m.conversation_id,
      m.role,
      m.content,
      ts_rank(
        to_tsvector('simple', m.content),
        plainto_tsquery('simple', query_text)
      ) as r
    from messages m
    where to_tsvector('simple', m.content) @@ plainto_tsquery('simple', query_text)
  ),
  -- One row per conversation: the highest-ranked matching message.
  best_per_convo as (
    select distinct on (conversation_id)
      conversation_id,
      message_id,
      role,
      content,
      r
    from ranked_messages
    order by conversation_id, r desc, message_id
  )
  select
    c.id as conversation_id,
    c.title as conversation_title,
    c.project_id,
    bpc.message_id as matched_message_id,
    bpc.role as matched_message_role,
    -- Generate a 200-char snippet around the match. ts_headline
    -- inserts <b>...</b> markers around the matched terms; we ask
    -- for a short snippet so the sidebar can show inline context.
    ts_headline(
      'simple',
      bpc.content,
      plainto_tsquery('simple', query_text),
      'StartSel=«, StopSel=», MaxWords=30, MinWords=15, MaxFragments=1, FragmentDelimiter=" ... "'
    ) as snippet,
    bpc.r as rank,
    c.last_message_at
  from best_per_convo bpc
  join conversations c on c.id = bpc.conversation_id
  order by bpc.r desc, c.last_message_at desc nulls last
  limit match_count;
end;
$$ language plpgsql;
