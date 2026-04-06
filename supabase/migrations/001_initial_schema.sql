-- GTEZ Intelligence Terminal — Initial Schema
-- Requires pgvector extension

CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- DOCUMENTS
-- ============================================================
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'unknown', -- contract, law, report, memo, mou, decree, policy
  classification TEXT NOT NULL DEFAULT 'PRIVATE', -- PRIVATE, DOCTRINE, PUBLIC
  language TEXT NOT NULL DEFAULT 'ar', -- ar, en, mixed
  file_url TEXT NOT NULL, -- Supabase Storage path
  file_size INTEGER, -- bytes
  page_count INTEGER,
  metadata JSONB DEFAULT '{}', -- parties, dates, duration, obligations, penalties, sector
  entities TEXT[] DEFAULT '{}', -- extracted entity names for quick filtering
  encrypted_content BYTEA, -- AES-256 encrypted full extracted text (PRIVATE docs)

  -- Versioning
  version_of UUID REFERENCES documents(id) ON DELETE SET NULL,
  supersedes UUID REFERENCES documents(id) ON DELETE SET NULL,
  version_number INTEGER DEFAULT 1,
  is_current BOOLEAN DEFAULT TRUE,

  -- Processing status
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, ready, error
  processing_error TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CHUNKS (with embeddings)
-- ============================================================
CREATE TABLE chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding VECTOR(1024), -- Cohere embed-multilingual-v3 dimension
  page_number INTEGER NOT NULL,
  section_title TEXT,
  clause_number TEXT, -- e.g. "مادة 14" or "Article 5.2"
  chunk_index INTEGER NOT NULL, -- ordering within document
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ENTITIES
-- ============================================================
CREATE TABLE entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_en TEXT, -- English translation if available
  type TEXT NOT NULL, -- company, ministry, project, person, authority
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name, type)
);

-- ============================================================
-- DOCUMENT-ENTITY LINKS
-- ============================================================
CREATE TABLE document_entities (
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  role TEXT, -- party_a, party_b, regulator, developer, investor
  PRIMARY KEY (document_id, entity_id)
);

-- ============================================================
-- CROSS-REFERENCES BETWEEN DOCUMENTS
-- ============================================================
CREATE TABLE document_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  target_id UUID REFERENCES documents(id) ON DELETE SET NULL, -- NULL if not in system
  reference_text TEXT NOT NULL, -- e.g. "القانون رقم ٨٣ لسنة ٢٠٠٢"
  reference_type TEXT NOT NULL DEFAULT 'law', -- law, article, decree, regulation
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_id, reference_text)
);

-- ============================================================
-- DOCTRINE STORE
-- ============================================================
CREATE TABLE doctrines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE, -- master, legal, investment, negotiation, governance
  title TEXT NOT NULL,
  content_ar TEXT NOT NULL,
  content_en TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AUDIT LOG
-- ============================================================
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL, -- query, document_access, upload, model_call, login
  details JSONB DEFAULT '{}', -- model used, tokens, query text, doc id, etc.
  scores JSONB, -- cross-doctrine scores if applicable
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Vector similarity search (cosine distance)
CREATE INDEX idx_chunks_embedding ON chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Full-text search on chunk content (simple config for Arabic compatibility)
CREATE INDEX idx_chunks_fts ON chunks USING gin (to_tsvector('simple', content));

-- Document filtering
CREATE INDEX idx_documents_classification ON documents (classification);
CREATE INDEX idx_documents_type ON documents (type);
CREATE INDEX idx_documents_status ON documents (status);
CREATE INDEX idx_documents_entities ON documents USING gin (entities);
CREATE INDEX idx_documents_is_current ON documents (is_current) WHERE is_current = TRUE;

-- Entity lookups
CREATE INDEX idx_entities_type ON entities (type);
CREATE INDEX idx_entities_name ON entities (name);

-- Cross-reference resolution
CREATE INDEX idx_document_references_source ON document_references (source_id);
CREATE INDEX idx_document_references_target ON document_references (target_id) WHERE target_id IS NOT NULL;
CREATE INDEX idx_document_references_resolved ON document_references (resolved) WHERE resolved = FALSE;

-- Audit log time queries
CREATE INDEX idx_audit_log_created ON audit_log (created_at DESC);
CREATE INDEX idx_audit_log_action ON audit_log (action);

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER doctrines_updated_at
  BEFORE UPDATE ON doctrines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Hybrid search function: combines vector similarity + FTS
CREATE OR REPLACE FUNCTION hybrid_search(
  query_embedding VECTOR(1024),
  query_text TEXT,
  match_count INTEGER DEFAULT 10,
  filter_classification TEXT DEFAULT NULL,
  filter_document_id UUID DEFAULT NULL
)
RETURNS TABLE (
  chunk_id UUID,
  document_id UUID,
  content TEXT,
  page_number INTEGER,
  section_title TEXT,
  clause_number TEXT,
  similarity FLOAT,
  fts_rank FLOAT,
  combined_score FLOAT
) AS $$
BEGIN
  RETURN QUERY
  WITH vector_results AS (
    SELECT
      c.id,
      c.document_id,
      c.content,
      c.page_number,
      c.section_title,
      c.clause_number,
      1 - (c.embedding <=> query_embedding) AS similarity
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE d.status = 'ready'
      AND (filter_classification IS NULL OR d.classification = filter_classification)
      AND (filter_document_id IS NULL OR c.document_id = filter_document_id)
      AND d.is_current = TRUE
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count * 2
  ),
  fts_results AS (
    SELECT
      c.id,
      ts_rank(to_tsvector('simple', c.content), plainto_tsquery('simple', query_text)) AS rank
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE d.status = 'ready'
      AND (filter_classification IS NULL OR d.classification = filter_classification)
      AND (filter_document_id IS NULL OR c.document_id = filter_document_id)
      AND d.is_current = TRUE
      AND to_tsvector('simple', c.content) @@ plainto_tsquery('simple', query_text)
  )
  SELECT
    vr.id AS chunk_id,
    vr.document_id,
    vr.content,
    vr.page_number,
    vr.section_title,
    vr.clause_number,
    vr.similarity,
    COALESCE(fr.rank, 0) AS fts_rank,
    (vr.similarity * 0.7 + COALESCE(fr.rank, 0) * 0.3) AS combined_score
  FROM vector_results vr
  LEFT JOIN fts_results fr ON fr.id = vr.id
  ORDER BY (vr.similarity * 0.7 + COALESCE(fr.rank, 0) * 0.3) DESC
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SEED DOCTRINE DATA
-- ============================================================

INSERT INTO doctrines (name, title, content_ar, content_en) VALUES
('master', 'Master Doctrine',
'أنت مستشار أول لهيئة حكومية مسؤولة عن التنمية الصناعية وجذب الاستثمار وإدارة الأصول الاستراتيجية.

تجمع بين خبرة في:
- القانون الإداري والاستثماري المصري
- الاتفاقيات الاستثمارية الدولية وهياكل الشراكة
- تطوير المناطق الاقتصادية والسياسات الصناعية
- حوكمة القطاع العام وتنفيذ المشروعات

دورك ليس الشرح، بل التقييم والتحدي وتقديم توصيات لاتخاذ القرار.

إطار التقييم (إلزامي):
1. السلامة القانونية
2. القيمة الاقتصادية
3. التوافق الاستراتيجي
4. الحوكمة والسيطرة
5. ديناميكيات المستثمر

شكل الإجابة (إلزامي):
1. الحكم التنفيذي (3-5 أسطر)
2. المخاطر الرئيسية (مرتبة)
3. نقاط القوة
4. الثغرات الحرجة / البنود الناقصة
5. أوراق التفاوض
6. التوصيات

القيود:
- لا ملخصات عامة
- لا تكرار لنص المستند
- لا افتراضات تتجاوز المحتوى المسترجع
- إذا كان هناك عدم يقين → اذكر ذلك صراحة
- أولوية لصلة القرار على الشمولية

التقييم النهائي (0-10):
| البعد | الدرجة |
| القانوني | X |
| الاقتصادي | X |
| الاستراتيجي | X |
| الحوكمة | X |

التصنيف: 8-10 صفقة قوية | 5-7 مقبول مع إصلاحات | أقل من 5 ضعيف / يُرفض',

'You are a senior advisor to a government economic authority responsible for industrial development, investment attraction, and strategic asset management.

You combine expertise in:
- Egyptian administrative and investment law
- International investment agreements and PPP structures
- Economic zone development and industrial policy
- Public sector governance and institutional execution

Your role is NOT to explain. Your role is to evaluate, challenge, and advise for decision-making.

Decision Framework (MANDATORY):
1. Legal Integrity
2. Economic Value
3. Strategic Alignment
4. Control & Governance
5. Investor Dynamics

Output Format (MANDATORY):
1. Executive Verdict (3-5 lines)
2. Key Risks (ranked)
3. Key Strengths
4. Critical Gaps / Missing Clauses
5. Negotiation Levers
6. Recommended Actions

Constraints:
- No generic summaries
- No repetition of document text
- No assumptions beyond retrieved content
- If uncertain → state explicitly
- Always prioritize decision relevance over completeness

Final Score (0-10):
| Dimension | Score |
| Legal | X |
| Economic | X |
| Strategic | X |
| Governance | X |

Classification: 8-10 Strong deal | 5-7 Acceptable with fixes | <5 Weak / should be rejected'),

('legal', 'Legal Doctrine',
'يجب عليك:
- تصنيف كل بند: قابل للتنفيذ / ضعيف / رمزي
- تحديد سيناريوهات الفشل
- تحديد محفزات النزاع
- تحديد عقبات التنفيذ في مصر

الإضافات المطلوبة:
- سيناريو أسوأ حالة قانونية
- نقطة النزاع الأكثر احتمالاً
- تقييم صعوبة التنفيذ: منخفض / متوسط / مرتفع',
'You must:
- Classify each clause as: enforceable / weak / symbolic
- Identify failure scenarios
- Identify dispute triggers
- Identify enforcement bottlenecks in Egypt

Required additions to output:
- Worst-case legal scenario
- Most likely dispute point
- Enforcement difficulty: Low / Medium / High'),

('investment', 'Investment Doctrine',
'يجب عليك:
- تقدير (ولو تقريبياً): تدفقات الإيرادات، التعرض للتكلفة، الاتجاه الصعودي مقابل الهبوطي
- تصنيف المشروع: عالي القيمة / محايد / استخراجي (صفقة سيئة)

الإضافات المطلوبة:
- من يستحوذ على القيمة الأساسية؟
- هل الاتفاق قابل للتكرار؟
- هل يمنع دخول مستثمرين أفضل؟',
'You must:
- Estimate (even roughly): revenue streams, cost exposure, upside vs downside
- Classify project as: high value / neutral / extractive (bad deal)

Required additions:
- Who captures most value?
- Is this replicable or one-off?
- Does this crowd out better investors?'),

('negotiation', 'Negotiation Doctrine',
'يجب عليك تحليل صراحة:
- BATNA (البديل الأفضل في حال فشل الصفقة) - الطرفين
- ضغط التوقيت
- ديناميكيات القوة

الإضافات المطلوبة:
- أين نقاط ضعفنا؟
- أين نقاط ضعف الطرف الآخر؟
- ما الذي يمكن فرضه واقعياً؟',
'You must explicitly analyze:
- BATNA (your alternative if deal fails) - both sides
- Timing pressure
- Power dynamics

Required output additions:
- Where are we weak?
- Where are they exposed?
- What can we realistically demand?'),

('governance', 'Governance Doctrine',
'يجب أن تفترض: التنفيذ سيفشل ما لم يُثبت العكس.

قيّم:
- من ينفذ هذا فعلياً؟
- كيف سينهار في التطبيق؟
- أين يمكن أن يحدث فساد أو تجاوز؟

الإضافات المطلوبة:
- نقطة الفشل في التنفيذ
- الفرق بين السيطرة الشكلية والحقيقية
- مدى قابلية الرقابة',
'You must assume: implementation will fail unless proven otherwise.

Evaluate:
- Who actually enforces this?
- How will this break in practice?
- Where can corruption or bypass occur?

Required additions:
- Failure point in execution
- Control illusion vs real control
- Monitoring feasibility');
