CREATE TABLE IF NOT EXISTS document_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('extraction')),
  version INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(document_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_document_artifacts_document_kind
  ON document_artifacts(document_id, kind);

ALTER TABLE document_artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read document_artifacts"
  ON document_artifacts FOR SELECT
  TO authenticated
  USING (true);

CREATE TRIGGER document_artifacts_updated_at
  BEFORE UPDATE ON document_artifacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
