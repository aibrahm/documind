-- Enable RLS on all tables
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctrines ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS, so server-side operations work
-- These policies allow authenticated users to read everything (single-user system)
-- Write operations go through the service role key (server-side only)

CREATE POLICY "Authenticated users can read documents"
  ON documents FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read chunks"
  ON chunks FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read entities"
  ON entities FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read document_entities"
  ON document_entities FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read document_references"
  ON document_references FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read doctrines"
  ON doctrines FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read audit_log"
  ON audit_log FOR SELECT
  TO authenticated
  USING (true);
