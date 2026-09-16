-- =====================================================================
-- 002_vector_schema.sql
-- The unstructured half of the RAG system.
--
-- pgvector is not available on every PostgreSQL install (notably the
-- Laragon/Windows build this project was developed against), so this
-- migration is DUAL-MODE:
--
--   pgvector present -> document_chunks.embedding is vector(768),
--                       searched with the <=> cosine operator + an HNSW index.
--   pgvector absent  -> document_chunks.embedding is double precision[],
--                       searched with array_cosine_similarity() (seq scan).
--
-- Both modes are driven from one place: the vector_backend() function, which
-- the Node VectorStore reads at boot to pick a driver. Installing pgvector
-- later is a matter of re-running this migration and re-ingesting -- no
-- application code changes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Backend detection
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;
    RAISE NOTICE 'pgvector is available -- using native vector(768) columns.';
  ELSE
    RAISE NOTICE 'pgvector NOT available -- falling back to float8[] + SQL cosine.';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION vector_backend()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
           THEN 'pgvector'
           ELSE 'fallback'
         END;
$$;

COMMENT ON FUNCTION vector_backend() IS
  'Which vector driver the application should use. Read once at API boot.';

-- ---------------------------------------------------------------------
-- Fallback similarity
--
-- Cosine similarity over two equal-length float8 arrays. Exact, not indexed:
-- fine up to a few tens of thousands of chunks, which is what this lab holds.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION array_cosine_similarity(a double precision[], b double precision[])
RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT CASE
           WHEN s.norm_a = 0 OR s.norm_b = 0 THEN 0
           ELSE s.dot / (sqrt(s.norm_a) * sqrt(s.norm_b))
         END
  FROM (
    SELECT sum(x.v * y.v)   AS dot,
           sum(x.v * x.v)   AS norm_a,
           sum(y.v * y.v)   AS norm_b
    FROM unnest(a) WITH ORDINALITY AS x(v, i)
    JOIN unnest(b) WITH ORDINALITY AS y(v, i) USING (i)
  ) s;
$$;

-- ---------------------------------------------------------------------
-- Corpus
-- ---------------------------------------------------------------------

CREATE TABLE documents (
  id          bigserial PRIMARY KEY,
  -- 'policy' | 'terms' | 'faq' | 'docs' | 'website' | 'generic_monograph'
  source_type text  NOT NULL,
  slug        text  NOT NULL UNIQUE,
  title       text  NOT NULL,
  uri         text,
  content     text  NOT NULL,
  -- Free-form provenance: original file, section path, generic_id, etc.
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Hash of `content`; lets the ingester skip unchanged documents.
  content_hash text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_source_type ON documents (source_type);

CREATE TABLE document_chunks (
  id              bigserial PRIMARY KEY,
  document_id     bigint  NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  chunk_index     integer NOT NULL,
  -- Denormalised from documents so retrieval needs no join on the hot path.
  source_type     text    NOT NULL,
  heading         text,
  content         text    NOT NULL,
  token_estimate  integer NOT NULL DEFAULT 0,
  metadata        jsonb   NOT NULL DEFAULT '{}'::jsonb,
  embedding_model text,
  embedding_dim   integer,
  -- Lexical half of hybrid retrieval.
  tsv             tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX idx_chunks_document    ON document_chunks (document_id);
CREATE INDEX idx_chunks_source_type ON document_chunks (source_type);
CREATE INDEX idx_chunks_tsv         ON document_chunks USING gin (tsv);
CREATE INDEX idx_chunks_content_trgm ON document_chunks USING gin (content gin_trgm_ops);

-- The embedding column's type depends on the backend, so it is added here
-- rather than in the CREATE TABLE above.
DO $$
BEGIN
  IF vector_backend() = 'pgvector' THEN
    EXECUTE 'ALTER TABLE document_chunks ADD COLUMN embedding vector(768)';
    -- HNSW over cosine distance. m/ef_construction are pgvector defaults;
    -- raise ef_construction if recall matters more than build time.
    EXECUTE 'CREATE INDEX idx_chunks_embedding_hnsw ON document_chunks '
         || 'USING hnsw (embedding vector_cosine_ops)';
  ELSE
    EXECUTE 'ALTER TABLE document_chunks ADD COLUMN embedding double precision[]';
  END IF;
END
$$;

-- ---------------------------------------------------------------------
-- Embedding cache
--
-- Query embeddings are requested repeatedly across model-comparison runs
-- (the same question is replayed against every agent architecture). Caching
-- them keeps comparisons honest -- retrieval is then identical across arms --
-- and keeps us inside the Gemini free tier.
-- ---------------------------------------------------------------------

CREATE TABLE embedding_cache (
  id         bigserial PRIMARY KEY,
  model      text NOT NULL,
  text_hash  text NOT NULL,
  dim        integer NOT NULL,
  vector     double precision[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model, text_hash)
);
