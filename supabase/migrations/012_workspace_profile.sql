create table if not exists public.workspace_profile (
  id text primary key default 'default',
  full_name text not null,
  title text not null,
  organization text not null,
  organization_short text,
  email text,
  phone text,
  signature text not null,
  preferred_language text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_profile_singleton check (id = 'default')
);

insert into public.workspace_profile (
  id,
  full_name,
  title,
  organization,
  organization_short,
  signature,
  preferred_language
)
values (
  'default',
  'Mohamed Ibrahim',
  'Vice Chairman',
  'Golden Triangle Economic Zone Authority',
  'GTEZ',
  E'Mohamed Ibrahim\nVice Chairman\nGolden Triangle Economic Zone Authority\nArab Republic of Egypt',
  'en'
)
on conflict (id) do nothing;
