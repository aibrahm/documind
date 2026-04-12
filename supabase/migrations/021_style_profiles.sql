-- Style profiles: stores extracted writing voice from reference documents.
-- The MCP tool `learn_style` populates this; `get_style_profile` reads it.

create table if not exists style_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'default',
  document_type text not null default '*',
  language text not null default 'ar',
  profile_json jsonb not null,
  source_document_ids uuid[] not null default '{}',
  is_active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_style_profiles_active
  on style_profiles (user_id, language, is_active)
  where is_active = true;
