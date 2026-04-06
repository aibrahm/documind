-- Drop and recreate conversations with richer schema
DROP TABLE IF EXISTS conversations;

-- Conversations with full context preservation
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'search',
  query TEXT NOT NULL,
  response TEXT,
  sources JSONB DEFAULT '[]',       -- [{id, type, title, pageNumber, documentId}]
  classification JSONB DEFAULT '{}', -- {intent, complexity, doctrines, language}
  model TEXT,
  scores JSONB,                      -- doctrine scores if any
  search_results JSONB,              -- preserved search results for replay
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Knowledge entries — things the system learns from user behavior
CREATE TABLE knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL, -- 'preference', 'correction', 'entity_note', 'pattern', 'terminology'
  content TEXT NOT NULL, -- the actual knowledge
  context TEXT, -- what triggered this learning
  source_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  source_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  relevance_score FLOAT DEFAULT 1.0, -- decays over time or increases with reinforcement
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User feedback on analyses — explicit learning signal
CREATE TABLE feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5), -- 1-5 star rating
  comment TEXT, -- free text feedback
  corrections JSONB, -- specific corrections: [{field, was, should_be}]
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_conversations_created ON conversations (created_at DESC);
CREATE INDEX idx_knowledge_type ON knowledge (type) WHERE active = TRUE;
CREATE INDEX idx_knowledge_active ON knowledge (active, created_at DESC);
CREATE INDEX idx_feedback_conversation ON feedback (conversation_id);

-- Triggers
CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER knowledge_updated_at
  BEFORE UPDATE ON knowledge
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_conversations" ON conversations FOR SELECT TO authenticated USING (true);
CREATE POLICY "write_conversations" ON conversations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_conversations" ON conversations FOR UPDATE TO authenticated USING (true);

CREATE POLICY "read_knowledge" ON knowledge FOR SELECT TO authenticated USING (true);
CREATE POLICY "write_knowledge" ON knowledge FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_knowledge" ON knowledge FOR UPDATE TO authenticated USING (true);

CREATE POLICY "read_feedback" ON feedback FOR SELECT TO authenticated USING (true);
CREATE POLICY "write_feedback" ON feedback FOR INSERT TO authenticated WITH CHECK (true);
