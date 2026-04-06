-- Fix hybrid_search return types: use REAL instead of FLOAT
DROP FUNCTION IF EXISTS hybrid_search(VECTOR(1024), TEXT, INTEGER, TEXT, UUID);
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
  similarity REAL,
  fts_rank REAL,
  combined_score DOUBLE PRECISION
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
      (1 - (c.embedding <=> query_embedding))::REAL AS similarity
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
      ts_rank(to_tsvector('simple', c.content), plainto_tsquery('simple', query_text))::REAL AS rank
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
    COALESCE(fr.rank, 0::REAL) AS fts_rank,
    (vr.similarity * 0.7 + COALESCE(fr.rank, 0) * 0.3)::DOUBLE PRECISION AS combined_score
  FROM vector_results vr
  LEFT JOIN fts_results fr ON fr.id = vr.id
  ORDER BY (vr.similarity * 0.7 + COALESCE(fr.rank, 0) * 0.3) DESC
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;
