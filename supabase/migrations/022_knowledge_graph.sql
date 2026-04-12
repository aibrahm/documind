-- Knowledge graph tables: entity relationships, obligations, and fact versioning.
-- Populated automatically during document ingestion by knowledge-graph.ts.

-- Entity-to-entity connections extracted from documents
create table if not exists entity_relationships (
  id uuid primary key default gen_random_uuid(),
  entity_a_id uuid not null references entities(id) on delete cascade,
  entity_b_id uuid not null references entities(id) on delete cascade,
  relation_type text not null,
  direction text not null default 'a_to_b',
  source_document_id uuid references documents(id) on delete set null,
  source_chunk_id uuid references chunks(id) on delete set null,
  confidence text not null default 'high',
  extracted_at timestamptz not null default now()
);

create index idx_entity_rel_a on entity_relationships (entity_a_id);
create index idx_entity_rel_b on entity_relationships (entity_b_id);
create index idx_entity_rel_doc on entity_relationships (source_document_id);

-- Obligations: deadlines, commitments, action items
create table if not exists obligations (
  id uuid primary key default gen_random_uuid(),
  responsible_entity_id uuid references entities(id) on delete set null,
  counterparty_entity_id uuid references entities(id) on delete set null,
  action text not null,
  deadline date,
  status text not null default 'pending',
  note text,
  source_document_id uuid references documents(id) on delete set null,
  source_chunk_id uuid references chunks(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_obligations_status on obligations (status);
create index idx_obligations_deadline on obligations (deadline) where deadline is not null;
create index idx_obligations_project on obligations (project_id) where project_id is not null;
create index idx_obligations_responsible on obligations (responsible_entity_id);

-- Fact versions: tracks how a specific claim evolves across documents
create table if not exists fact_versions (
  id uuid primary key default gen_random_uuid(),
  claim_key text not null,
  claim_label text not null,
  value text not null,
  previous_value text,
  source_document_id uuid references documents(id) on delete set null,
  source_chunk_id uuid references chunks(id) on delete set null,
  document_date date,
  extracted_at timestamptz not null default now()
);

create index idx_fact_versions_key on fact_versions (claim_key, document_date desc);
create index idx_fact_versions_doc on fact_versions (source_document_id);
