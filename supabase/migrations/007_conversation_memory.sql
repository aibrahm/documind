-- ============================================================
-- Cross-conversation memory layer
-- Stores distilled facts, decisions, and concerns from prior
-- conversations so future turns can reference institutional context.
-- ============================================================

CREATE TABLE IF NOT EXISTS conversation_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('decision', 'fact', 'recommendation', 'concern', 'preference')),
  entities TEXT[] DEFAULT '{}',
  importance REAL DEFAULT 0.5, -- 0.0 to 1.0, higher = more likely to be injected
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_memory_entities ON conversation_memory USING gin (entities);
CREATE INDEX IF NOT EXISTS idx_conversation_memory_created ON conversation_memory (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_memory_importance ON conversation_memory (importance DESC);
