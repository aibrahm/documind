-- Drop the dead classification columns.
--
-- `knowledge_scope` and `access_level` were part of the old three-way
-- document classification model that conflated three unrelated
-- concepts (confidentiality, working vs reference material, and
-- scope). Migration 015 collapsed everything into a single binary
-- `classification` column (PRIVATE | PUBLIC) and every code path that
-- read these columns has been removed in the same release.
--
-- This migration finishes the cleanup by dropping the columns from
-- the schema. After this, the data model is:
--
--   documents.classification  = 'PRIVATE' | 'PUBLIC'
--   (role is derived from project_documents linkage — no column)
--
-- If you ever need these fields back, the git history and
-- src/lib/document-knowledge.ts legacy deprecated re-exports tell
-- the full story.

alter table public.documents
  drop column if exists knowledge_scope;

alter table public.documents
  drop column if exists access_level;
