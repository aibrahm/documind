-- ============================================================
-- Phase 1 workspace model backfill
-- Safe/idempotent data migration for the additive Phase 1 schema.
-- ============================================================

-- ── DOCUMENT ACCESS / KNOWLEDGE ROLE ───────────────────────────────────────

UPDATE documents
SET access_level = CASE
  WHEN classification = 'PRIVATE' THEN 'private'
  ELSE 'public'
END
WHERE access_level IS NULL;

WITH project_link_counts AS (
  SELECT document_id, COUNT(DISTINCT project_id) AS project_count
  FROM project_documents
  GROUP BY document_id
)
UPDATE documents d
SET knowledge_scope = CASE
  WHEN d.classification = 'DOCTRINE' THEN 'institutional_doctrine'
  WHEN COALESCE(plc.project_count, 0) > 1 THEN 'shared_reference'
  WHEN COALESCE(plc.project_count, 0) = 1 THEN 'project'
  ELSE 'shared_reference'
END
FROM project_link_counts plc
WHERE d.id = plc.document_id
  AND d.knowledge_scope IS NULL;

UPDATE documents
SET knowledge_scope = CASE
  WHEN classification = 'DOCTRINE' THEN 'institutional_doctrine'
  WHEN classification = 'PUBLIC' THEN 'shared_reference'
  ELSE 'project'
END
WHERE knowledge_scope IS NULL;

UPDATE documents
SET summary_status = 'none'
WHERE summary_status IS NULL;

-- ── PROJECT DOCUMENT LINKS ──────────────────────────────────────────────────

UPDATE project_documents
SET link_type = CASE
  WHEN role = 'primary' THEN 'primary'
  WHEN role = 'reference' THEN 'reference'
  WHEN role = 'supporting' THEN 'background'
  ELSE 'reference'
END
WHERE link_type IS NULL;

UPDATE project_documents
SET is_primary = (role = 'primary')
WHERE is_primary IS DISTINCT FROM (role = 'primary');

UPDATE project_documents
SET relevance = 0.9
WHERE relevance IS NULL AND role = 'primary';

UPDATE project_documents
SET relevance = 0.6
WHERE relevance IS NULL AND role = 'reference';

UPDATE project_documents
SET relevance = 0.4
WHERE relevance IS NULL AND role = 'supporting';

UPDATE project_documents
SET relevance = 0.5
WHERE relevance IS NULL;

UPDATE project_documents
SET confidence = 1.0
WHERE confidence IS NULL;

-- ── PROJECT ENTITIES ────────────────────────────────────────────────────────

INSERT INTO project_entities (project_id, entity_id, role, importance, why_linked, added_at)
SELECT
  project_id,
  entity_id,
  CASE
    WHEN role IN ('counterparty', 'regulator', 'partner') THEN role
    WHEN role = 'consultant' THEN 'advisor'
    WHEN role = 'investor' THEN 'stakeholder'
    ELSE 'other'
  END,
  0.7,
  'Backfilled from project_companies',
  added_at
FROM project_companies pc
WHERE NOT EXISTS (
  SELECT 1
  FROM project_entities pe
  WHERE pe.project_id = pc.project_id
    AND pe.entity_id = pc.entity_id
    AND pe.role = CASE
      WHEN pc.role IN ('counterparty', 'regulator', 'partner') THEN pc.role
      WHEN pc.role = 'consultant' THEN 'advisor'
      WHEN pc.role = 'investor' THEN 'stakeholder'
      ELSE 'other'
    END
);

-- ── CONVERSATIONS / THREADS ────────────────────────────────────────────────

WITH latest_messages AS (
  SELECT conversation_id, MAX(created_at) AS last_message_at
  FROM messages
  GROUP BY conversation_id
)
UPDATE conversations c
SET
  kind = COALESCE(c.kind, CASE WHEN c.project_id IS NULL THEN 'general' ELSE 'analysis' END),
  status = COALESCE(c.status, 'active'),
  last_message_at = COALESCE(lm.last_message_at, c.updated_at, c.created_at, now())
FROM latest_messages lm
WHERE c.id = lm.conversation_id;

UPDATE conversations
SET
  kind = COALESCE(kind, CASE WHEN project_id IS NULL THEN 'general' ELSE 'analysis' END),
  status = COALESCE(status, 'active'),
  last_message_at = COALESCE(last_message_at, updated_at, created_at, now())
WHERE kind IS NULL
   OR status IS NULL
   OR last_message_at IS NULL;

-- ── PROJECTS ────────────────────────────────────────────────────────────────

UPDATE projects
SET kind = COALESCE(kind, 'company_matter'),
    stage = COALESCE(stage, 'analysis'),
    brief = COALESCE(brief, '{}'::jsonb),
    next_actions = COALESCE(next_actions, '[]'::jsonb)
WHERE kind IS NULL
   OR stage IS NULL
   OR brief IS NULL
   OR next_actions IS NULL;

UPDATE projects
SET objective = context_summary
WHERE objective IS NULL
  AND context_summary IS NOT NULL
  AND length(trim(context_summary)) > 0;

-- ── MEMORY ITEMS ────────────────────────────────────────────────────────────

INSERT INTO memory_items (
  scope_type,
  scope_id,
  kind,
  text,
  entities,
  importance,
  source_conversation_id,
  created_at
)
SELECT
  CASE WHEN cm.project_id IS NOT NULL THEN 'project' ELSE 'shared' END,
  cm.project_id,
  CASE
    WHEN cm.kind = 'decision' THEN 'decision'
    WHEN cm.kind = 'fact' THEN 'fact'
    WHEN cm.kind = 'preference' THEN 'preference'
    WHEN cm.kind = 'concern' THEN 'risk'
    ELSE 'instruction'
  END,
  cm.text,
  COALESCE(cm.entities, '{}'),
  COALESCE(cm.importance, 0.5),
  cm.conversation_id,
  cm.created_at
FROM conversation_memory cm
WHERE NOT EXISTS (
  SELECT 1
  FROM memory_items mi
  WHERE mi.text = cm.text
    AND mi.source_conversation_id IS NOT DISTINCT FROM cm.conversation_id
    AND mi.scope_type = CASE WHEN cm.project_id IS NOT NULL THEN 'project' ELSE 'shared' END
    AND mi.scope_id IS NOT DISTINCT FROM cm.project_id
);
