-- Message feedback
--
-- Two-button feedback on every assistant message — "This helped" vs
-- "This was wrong" — so we can measure the single metric that actually
-- matters for this product: how many answers the Vice Chairman trusted
-- enough to act on.
--
-- Why a new table instead of extending the existing `feedback` table:
-- the existing `feedback` table is keyed on `conversation_id` and stores
-- a numeric rating + free-text comment + corrections JSON. That is a
-- very different (and unused) model from what we want here. We want
-- one row per message marking it helpful or wrong, no stars, no forms,
-- just the verdict. Keeping the two separate avoids overloading a
-- schema that was designed for something else.
--
-- Schema is intentionally tiny. Any time we think we need more fields,
-- we should first ask whether the extra data would actually be used.

create table if not exists public.message_feedback (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.messages(id) on delete cascade,
  verdict      text not null check (verdict in ('helpful', 'wrong')),
  note         text,
  created_at   timestamptz not null default now()
);

-- One row per (message_id, verdict). If the VC clicks thumb-up then
-- thumb-down on the same message, we keep both rows so we can see the
-- flip in telemetry. But we do prevent double-recording the same
-- verdict on the same message (duplicate clicks).
create unique index if not exists message_feedback_unique_verdict
  on public.message_feedback (message_id, verdict);

create index if not exists message_feedback_message_id_idx
  on public.message_feedback (message_id);

create index if not exists message_feedback_created_at_idx
  on public.message_feedback (created_at desc);

-- RLS follows the existing single-tenant convention in 003_rls_policies.sql.
-- When we move to multi-tenant we'll rewrite all of these together.
alter table public.message_feedback enable row level security;

create policy "message_feedback_select_all"
  on public.message_feedback
  for select
  using (true);

create policy "message_feedback_insert_all"
  on public.message_feedback
  for insert
  with check (true);

create policy "message_feedback_delete_all"
  on public.message_feedback
  for delete
  using (true);
