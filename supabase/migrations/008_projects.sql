-- ============================================================
-- Phase 03: Projects + negotiations schema
-- ============================================================
-- Adds project as the unit of organization. A project bundles
-- documents, companies, conversations, and (optionally) negotiation
-- threads. Existing conversations have project_id = NULL by default
-- (general/ephemeral pool); they can be assigned to a project later.
-- ============================================================

-- ── PROJECTS ──
CREATE TABLE IF NOT EXISTS projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','on_hold','closed','archived')),
  start_date      DATE,
  target_close    DATE,
  closed_at       TIMESTAMPTZ,
  color           TEXT,
  icon            TEXT,
  context_summary TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_slug   ON projects(slug);
CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);

-- ── PROJECT ↔ DOCUMENTS (M:N) ──
-- A document can belong to multiple projects (e.g. the master plan
-- touches Safaga Industrial Zone, Mining Strategy, and Master Plan
-- Update simultaneously). Cascade delete from either side.
CREATE TABLE IF NOT EXISTS project_documents (
  project_id   UUID NOT NULL REFERENCES projects(id)  ON DELETE CASCADE,
  document_id  UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  role         TEXT,                                   -- 'primary' | 'reference' | 'supporting'
  added_by     TEXT DEFAULT 'user',                    -- 'user' | 'librarian' | 'auto'
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, document_id)
);
CREATE INDEX IF NOT EXISTS idx_project_documents_doc ON project_documents(document_id);

-- ── PROJECT ↔ COMPANIES (M:N) ──
-- A project can involve multiple companies; one company can be in
-- multiple projects. Reuses the existing entities table. Roles
-- distinguish counterparty / consultant / partner / etc.
CREATE TABLE IF NOT EXISTS project_companies (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entity_id   UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'counterparty'
              CHECK (role IN ('counterparty','consultant','partner','investor','regulator')),
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, entity_id, role)
);
CREATE INDEX IF NOT EXISTS idx_project_companies_entity ON project_companies(entity_id);

-- ── NEGOTIATIONS ──
-- A specific deal thread inside a project. A project can have
-- multiple negotiations (e.g. "Scenario 1 — Developer + Partnership"
-- and "Scenario 2 — Developer Only" are two negotiations under one
-- project for the same counterparty).
CREATE TABLE IF NOT EXISTS negotiations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id               UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,
  counterparty_entity_id   UUID REFERENCES entities(id) ON DELETE SET NULL,
  status                   TEXT NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open','active','stalled','closed_won','closed_lost','withdrawn')),
  opened_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at                TIMESTAMPTZ,
  -- Structured key facts extracted from the deal docs
  -- e.g. {"land_area_m2": 17700000, "tenor_years": 17, "rou_egp": 885000000,
  --       "revenue_share_pct": 15, "equity_split": {"developer": 80, "authority": 20}}
  key_terms                JSONB DEFAULT '{}',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_negotiations_project       ON negotiations(project_id);
CREATE INDEX IF NOT EXISTS idx_negotiations_counterparty  ON negotiations(counterparty_entity_id);
CREATE INDEX IF NOT EXISTS idx_negotiations_status        ON negotiations(status);

-- ── NEGOTIATION ↔ DOCUMENTS (M:N) ──
CREATE TABLE IF NOT EXISTS negotiation_documents (
  negotiation_id  UUID NOT NULL REFERENCES negotiations(id) ON DELETE CASCADE,
  document_id     UUID NOT NULL REFERENCES documents(id)    ON DELETE CASCADE,
  role            TEXT,                                     -- 'proposal' | 'counterproposal' | 'analysis' | 'reference' | 'final'
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (negotiation_id, document_id)
);

-- ── CONVERSATIONS — extend with project link (nullable) ──
-- NULL project_id = "general / ephemeral" session
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);

-- ── CONVERSATION_MEMORY — extend with project link (nullable) ──
-- Project-scoped memories live with the project; cross-project
-- entity-based memories stay project_id = NULL.
ALTER TABLE conversation_memory
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_conversation_memory_project ON conversation_memory(project_id);
