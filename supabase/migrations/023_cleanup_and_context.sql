-- Cleanup: drop zombie tables from the chat era + unused concepts
-- Add: projects.context_md for living project notes

-- Drop legacy chat tables
drop table if exists conversation_entities cascade;
drop table if exists conversation_documents cascade;
drop table if exists conversation_memory cascade;
drop table if exists conversations cascade;

-- Drop unused negotiations concept
drop table if exists negotiation_documents cascade;
drop table if exists negotiations cascade;

-- Add project context_md
alter table projects add column if not exists context_md text;

-- Add a `reference` flag to documents (for "General" bucket):
-- - reference=true  → belongs to the general reference library
-- - reference=false AND in project_documents → belongs to that project
-- - reference=false AND NOT in project_documents → Unassigned (needs triage)
alter table documents add column if not exists is_reference boolean not null default false;

-- Similarity-suggested document references
-- Extends the existing document_references table if needed.
-- If reference_type='similar' + resolved=false, it's a pending suggestion.
-- Add similarity column if missing.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name='document_references' and column_name='similarity'
  ) then
    alter table document_references add column similarity real;
  end if;
end $$;
