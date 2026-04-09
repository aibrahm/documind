-- Kill DOCTRINE as a classification value.
--
-- Up to this point, documents.classification has been a three-way field
-- (PRIVATE | PUBLIC | DOCTRINE) that conflated two different questions:
--
--   1. Is this document confidential? (access — who can I discuss it with)
--   2. What role does it play?        (working material vs background reference)
--
-- DOCTRINE tried to answer (2) in a column that otherwise answers (1),
-- and it collided with the analytical "doctrines" (master/legal/investment/
-- governance) that the router picks from in src/lib/doctrine.ts — one
-- word, two unrelated concepts. The three-way mental model was also
-- confusing the human uploading the documents.
--
-- New rule: classification is binary. PRIVATE or PUBLIC. That's it.
--
-- All existing DOCTRINE rows represent institutional reference material
-- (laws, regulations, decrees) which are by definition published/public,
-- so migrating them to PUBLIC is semantically correct.
--
-- Downstream code (document-knowledge.ts, chat-turn.ts retrieval, the
-- document list UI) collapses the DOCTRINE path in the same release.

update public.documents
   set classification = 'PUBLIC'
 where classification = 'DOCTRINE';

-- We intentionally keep the `classification` column as free-form text
-- (not a CHECK constraint) for one release. Adding the constraint now
-- would fail loudly if ANY stray DOCTRINE row survives the UPDATE,
-- which is fine for a forensic crash but not for a quiet migration.
-- The next migration after this one can add:
--
--   alter table public.documents
--     add constraint documents_classification_binary
--     check (classification in ('PRIVATE', 'PUBLIC'));
--
-- once we have a week of telemetry showing no new DOCTRINE rows are
-- being inserted.
