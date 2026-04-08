-- ============================================================
-- Phase 1 workspace model
-- Additive schema changes only. Existing tables remain the source of truth
-- until the app is migrated to the new fields.
-- ============================================================

-- ── PROJECTS ────────────────────────────────────────────────────────────────

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'company_matter',
  ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'analysis',
  ADD COLUMN IF NOT EXISTS objective TEXT,
  ADD COLUMN IF NOT EXISTS brief JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS next_actions JSONB DEFAULT '[]';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_kind_check'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_kind_check
      CHECK (
        kind IN (
          'company_matter',
          'policy',
          'law_amendment',
          'research',
          'internal_strategy',
          'operations',
          'other'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_stage_check'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_stage_check
      CHECK (
        stage IN (
          'sourcing',
          'analysis',
          'engagement',
          'drafting',
          'decision',
          'execution',
          'monitoring',
          'closed'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_projects_kind ON projects(kind);
CREATE INDEX IF NOT EXISTS idx_projects_stage ON projects(stage);

-- ── DOCUMENTS ──────────────────────────────────────────────────────────────

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS access_level TEXT,
  ADD COLUMN IF NOT EXISTS knowledge_scope TEXT,
  ADD COLUMN IF NOT EXISTS summary_status TEXT NOT NULL DEFAULT 'none';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'documents_access_level_check'
  ) THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_access_level_check
      CHECK (access_level IS NULL OR access_level IN ('private', 'public'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'documents_knowledge_scope_check'
  ) THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_knowledge_scope_check
      CHECK (
        knowledge_scope IS NULL OR knowledge_scope IN (
          'project',
          'shared_reference',
          'institutional_doctrine',
          'thread_local'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'documents_summary_status_check'
  ) THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_summary_status_check
      CHECK (summary_status IN ('none', 'queued', 'ready', 'error'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_documents_access_level ON documents(access_level);
CREATE INDEX IF NOT EXISTS idx_documents_knowledge_scope ON documents(knowledge_scope);
CREATE INDEX IF NOT EXISTS idx_documents_summary_status ON documents(summary_status);

-- ── PROJECT ↔ DOCUMENTS ────────────────────────────────────────────────────

ALTER TABLE project_documents
  ADD COLUMN IF NOT EXISTS link_type TEXT,
  ADD COLUMN IF NOT EXISTS relevance REAL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS why_linked TEXT,
  ADD COLUMN IF NOT EXISTS confidence REAL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'project_documents_link_type_check'
  ) THEN
    ALTER TABLE project_documents
      ADD CONSTRAINT project_documents_link_type_check
      CHECK (
        link_type IS NULL OR link_type IN (
          'primary',
          'reference',
          'legal_basis',
          'background',
          'counterparty_material',
          'internal_note',
          'output_source'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_project_documents_link_type
  ON project_documents(project_id, link_type);
CREATE INDEX IF NOT EXISTS idx_project_documents_primary
  ON project_documents(project_id, is_primary);

-- ── PROJECT ↔ ENTITIES ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_entities (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'counterparty',
  importance REAL DEFAULT 0.5,
  why_linked TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, entity_id, role)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'project_entities_role_check'
  ) THEN
    ALTER TABLE project_entities
      ADD CONSTRAINT project_entities_role_check
      CHECK (
        role IN (
          'counterparty',
          'regulator',
          'partner',
          'advisor',
          'internal_owner',
          'stakeholder',
          'asset_owner',
          'other'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_project_entities_entity
  ON project_entities(entity_id);

-- ── CONVERSATIONS AS THREADS ───────────────────────────────────────────────

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'analysis',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS purpose TEXT,
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'conversations_kind_check'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_kind_check
      CHECK (
        kind IN (
          'analysis',
          'drafting',
          'research',
          'meeting_prep',
          'comparison',
          'general'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'conversations_status_check'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_status_check
      CHECK (status IN ('active', 'paused', 'done', 'archived'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_kind ON conversations(kind);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message
  ON conversations(last_message_at DESC);

-- ── THREAD ↔ DOCUMENTS / ENTITIES ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversation_documents (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  role TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_documents_document
  ON conversation_documents(document_id);

CREATE TABLE IF NOT EXISTS conversation_entities (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  role TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_entities_entity
  ON conversation_entities(entity_id);

-- ── OUTPUTS / ARTIFACTS ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  citations JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'artifacts_kind_check'
  ) THEN
    ALTER TABLE artifacts
      ADD CONSTRAINT artifacts_kind_check
      CHECK (
        kind IN (
          'email',
          'memo',
          'brief',
          'deck',
          'note',
          'talking_points',
          'meeting_prep'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'artifacts_status_check'
  ) THEN
    ALTER TABLE artifacts
      ADD CONSTRAINT artifacts_status_check
      CHECK (status IN ('draft', 'review', 'final', 'archived'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_artifacts_project ON artifacts(project_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_conversation ON artifacts(conversation_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_kind ON artifacts(kind);

ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'artifacts' AND policyname = 'Authenticated users can read artifacts'
  ) THEN
    CREATE POLICY "Authenticated users can read artifacts"
      ON artifacts FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'artifacts_updated_at'
  ) THEN
    CREATE TRIGGER artifacts_updated_at
      BEFORE UPDATE ON artifacts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ── MEMORY ITEMS ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS memory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type TEXT NOT NULL,
  scope_id UUID,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  entities TEXT[] DEFAULT '{}',
  importance REAL DEFAULT 0.5,
  source_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  source_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'memory_items_scope_type_check'
  ) THEN
    ALTER TABLE memory_items
      ADD CONSTRAINT memory_items_scope_type_check
      CHECK (scope_type IN ('thread', 'project', 'shared', 'institution'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'memory_items_kind_check'
  ) THEN
    ALTER TABLE memory_items
      ADD CONSTRAINT memory_items_kind_check
      CHECK (
        kind IN (
          'decision',
          'fact',
          'instruction',
          'preference',
          'risk',
          'question'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_memory_items_scope
  ON memory_items(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_memory_items_importance
  ON memory_items(importance DESC);

ALTER TABLE memory_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'memory_items' AND policyname = 'Authenticated users can read memory_items'
  ) THEN
    CREATE POLICY "Authenticated users can read memory_items"
      ON memory_items FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'memory_items_updated_at'
  ) THEN
    CREATE TRIGGER memory_items_updated_at
      BEFORE UPDATE ON memory_items
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ── GRAPH EDGES ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS graph_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  edge_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  evidence JSONB DEFAULT '[]',
  confidence REAL DEFAULT 0.5,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_graph_edges_source
  ON graph_edges(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target
  ON graph_edges(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_type
  ON graph_edges(edge_type);

ALTER TABLE graph_edges ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'graph_edges' AND policyname = 'Authenticated users can read graph_edges'
  ) THEN
    CREATE POLICY "Authenticated users can read graph_edges"
      ON graph_edges FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'graph_edges_updated_at'
  ) THEN
    CREATE TRIGGER graph_edges_updated_at
      BEFORE UPDATE ON graph_edges
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
