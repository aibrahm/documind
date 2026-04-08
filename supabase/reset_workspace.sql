-- Reset workspace/application data while keeping schema and seeded system config.
-- Intended for a fresh local/dev restart before ship.
-- Keeps:
--   - doctrines
--   - workspace_profile
--   - migrations/schema

BEGIN;

TRUNCATE TABLE
  graph_edges,
  memory_items,
  artifacts,
  conversation_entities,
  conversation_documents,
  messages,
  feedback,
  knowledge,
  conversation_memory,
  negotiation_documents,
  negotiations,
  project_entities,
  project_companies,
  project_documents,
  chunks,
  document_entities,
  document_references,
  document_artifacts,
  documents,
  conversations,
  projects,
  entities,
  audit_log
RESTART IDENTITY CASCADE;

COMMIT;
