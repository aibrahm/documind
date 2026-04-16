-- 024_entity_graph_and_metrics.sql
--
-- Phase 1 foundations for the extraction rewrite:
--
-- 1. Entity embeddings + aliases — the old `entities` table used fuzzy
--    string matching (0.82 threshold) which let OCR variants slip through
--    as separate rows (GTEZA appearing 3 times, Ministry of Finance twice,
--    etc.). Adding an embedding vector + aliases array lets us dedupe by
--    cosine similarity and store alternate surface forms on a single row.
--
-- 2. extraction_runs — every pipeline stage gets a row with duration +
--    token counts + USD cost. Replaces the hardcoded `costs: 0` in
--    extraction-v2.ts. Source of truth for the monthly-spend dashboard.
--
-- 3. entity_canonicalization_log — audit trail of every dedup decision
--    (merged into existing / inserted new). Lets us tune the 0.88
--    threshold post-migration by inspecting false merges and false splits.

-- Entity enrichment ─────────────────────────────────────────────────────

ALTER TABLE entities
  ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE entities
  ADD COLUMN IF NOT EXISTS embedding VECTOR(1024);

-- IVFFlat on the embedding column. Cohere embed-multilingual-v3 produces
-- 1024-dim vectors (same as chunks.embedding). Small `lists` because the
-- entity set is tiny relative to chunks; revisit once we have 10k+ entities.
CREATE INDEX IF NOT EXISTS idx_entities_embedding
  ON entities USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);

-- Extraction run telemetry ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS extraction_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  -- Stages: ocr | normalize | chunk | embed |
  -- llm_title | llm_context | llm_entities | llm_graph |
  -- persist | total
  duration_ms INTEGER NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  usd_cost NUMERIC(10, 6) NOT NULL DEFAULT 0,
  model_version TEXT,
  ok BOOLEAN NOT NULL DEFAULT TRUE,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extraction_runs_document
  ON extraction_runs(document_id);

-- Plain btree on `started_at`. The /settings/usage dashboard computes
-- the start-of-month timestamp in the app and passes it as a constant:
--   WHERE started_at >= '2026-04-01'
-- Postgres uses this index for that range scan. Wrapping the column in
-- date_trunc() inside the index expression isn't allowed — date_trunc
-- is STABLE, not IMMUTABLE.
CREATE INDEX IF NOT EXISTS idx_extraction_runs_started_at
  ON extraction_runs(started_at);

-- Canonicalization audit trail ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS entity_canonicalization_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  raw_name TEXT NOT NULL,
  raw_name_en TEXT,
  raw_type TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('merged', 'inserted')),
  matched_entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,
  similarity NUMERIC(5, 4),
  threshold NUMERIC(5, 4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canon_log_entity
  ON entity_canonicalization_log(matched_entity_id);
CREATE INDEX IF NOT EXISTS idx_canon_log_document
  ON entity_canonicalization_log(document_id);
