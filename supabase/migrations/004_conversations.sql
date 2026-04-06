-- Conversations table for persistent chat history
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL, -- first query or auto-generated title
  mode TEXT NOT NULL DEFAULT 'search', -- search or analyze
  query TEXT NOT NULL,
  response TEXT, -- full response text (search results JSON or analysis text)
  metadata JSONB DEFAULT '{}', -- classification, sources, model, stages, scores
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conversations_created ON conversations (created_at DESC);

-- Auto-update updated_at
CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read conversations"
  ON conversations FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert conversations"
  ON conversations FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update conversations"
  ON conversations FOR UPDATE TO authenticated USING (true);
