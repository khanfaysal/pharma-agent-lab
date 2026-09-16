# Database Architecture

Postgres 14+, optionally with `pgvector`. One database holds three concerns that
are deliberately kept separate: the **domain catalog**, the **retrieval index**
built over it, and the **run log** that records what the agent did.

Migrations are applied in filename order by `scripts/db-setup.mjs`, which shells
out to `psql` rather than driving `pg` from Node -- the seed file is a ~9 MB
script of multi-row INSERTs and `psql` streams it in about a second.

```
node scripts/db-setup.mjs            # create db, apply migrations, load seed
node scripts/db-setup.mjs --drop     # drop and recreate first
node scripts/db-setup.mjs --no-seed  # schema only
```

---

## Layer 1 -- `001_structured_schema.sql`, the domain catalog

The pharmaceutical reference data as ordinary normalised tables.

```
company ──┐
          ├──▶ brand ──▶ generic ──┬──▶ pregnancy_category
district  │       │                ├──▶ indication      (via indication_generic)
          │       │                └──▶ therapeutic_class (via therapeutic_generic)
          │       │                          │
sponsored_brand ──┘                          └──▶ systemic_class (self-referencing)

herbal_generic   -- parallel table, same idea, herbal preparations
occupation, specialty, district -- lookup tables
```

### The table that matters: `generic`

`generic` is not a thin lookup row. It carries the clinical monograph as text
columns, and this is what makes the whole lab possible:

| Column | Holds |
|---|---|
| `generic_name` | the name |
| `indication` | what it treats |
| `adult_dose`, `child_dose`, `renal_dose` | dosing prose |
| `administration` | how it is given |
| `contra_indication`, `precaution`, `interaction` | safety prose |
| `side_effect` | adverse effects |
| `mode_of_action` | pharmacology |
| `pregnancy_category_id` + `pregnancy_category_note` | FK plus free text |

`brand` hangs off `generic` with `company_id` and `price_min numeric(12,2)`.

### Extensions

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fuzzy brand-name matching
CREATE EXTENSION IF NOT EXISTS unaccent;
```

Both exist because users misspell drug names constantly. Exact matching on
`brand_name` is not good enough for a search box.

---

## Layer 2 -- `002_vector_schema.sql`, the retrieval index

### Tables

**`documents`** -- whole source documents.

| Column | Note |
|---|---|
| `slug` | UNIQUE; the stable id used in citations |
| `source_type` | `policy`, `terms`, `faq`, `generic`, ... -- used to scope retrieval |
| `content` | full text |
| `content_hash` | lets re-ingest skip unchanged documents |
| `metadata` | jsonb |

**`document_chunks`** -- the retrieval unit. One document becomes many chunks.

| Column | Note |
|---|---|
| `document_id` | FK, `ON DELETE CASCADE` |
| `chunk_index`, `heading` | position and section title |
| `content` | the chunk text |
| `token_estimate` | for context budgeting |
| `tsv` | **generated** tsvector column |
| `embedding` | `vector(768)` or `float8[]` -- see below |
| `embedding_model`, `embedding_dim` | what produced this vector |

**Three indexes over the same text**, because three retrieval strategies are
being compared:

```sql
CREATE INDEX idx_chunks_tsv          ON document_chunks USING gin (tsv);
CREATE INDEX idx_chunks_content_trgm ON document_chunks USING gin (content gin_trgm_ops);
CREATE INDEX idx_chunks_embedding_hnsw ON document_chunks USING hnsw (...);  -- conditional
```

**`embedding_cache`** -- keyed `(model, text_hash)`, storing `dim` and `vector`.

### pgvector is optional

`002` creates the extension inside a `DO` block. If it is unavailable:

- `embedding` becomes `float8[]` instead of `vector(768)`
- the HNSW index is not created
- cosine similarity is computed by a plain SQL function

Everything still runs, just slower and with a sequential scan. `GET /api/health`
reports `vectorBackend: 'pgvector' | 'fallback'` so you always know which you are
on. `apps/api/src/vector/store.ts` generates both query shapes from one template:

- pgvector: `embedding <=> $1` is cosine **distance**, so similarity is `1 - d`
- fallback: `array_cosine_similarity()` returns similarity directly

### The embedding dimension is load-bearing

`EMBEDDING_DIM` (768) is baked into the column width. Changing
`EMBEDDING_MODEL` to one with a different native dimension requires editing
`002_vector_schema.sql` and re-ingesting. `apps/api/src/embeddings/index.ts`
throws a explicit dimension-mismatch error rather than letting a wrong-width
vector reach the database.

Because `gemini-embedding-*` defaults to 3072 dimensions, the Gemini provider
sends `outputDimensionality: config.embeddings.dim` on every embed request.

### Why the embedding cache exists

It is not a performance optimisation first -- it is what makes model comparison
**fair**. Every architecture replaying the same question retrieves against
byte-identical query vectors, so any score difference is attributable to the
agent, not to embedding jitter.

---

## Layer 3 -- `003_agent_schema.sql`, the run log

This layer is what makes the project a lab rather than a demo. Everything the UI
displays is read back from these tables, never recomputed.

**`agent_runs`** -- one row per question per architecture.

| Column | Note |
|---|---|
| `comparison_id` | ties arms of one comparison together |
| `conversation_id` | ties follow-ups together |
| `architecture` | `single` \| `multi` \| `router-only` \| `baseline-no-tools` |
| `route` | what the router chose |
| `strategy_label` | human-readable arm name |
| `question`, `answer` | |
| `tools_used` | `text[]` |
| `citations` | jsonb |
| `step_count`, `prompt_tokens`, `output_tokens` | |
| `cost_usd` | `numeric(12,6)` |
| `latency_ms` | |
| `status` | CHECK `('ok','error','max_steps')` |
| `error` | populated when status is `error` |

**`agent_steps`** -- one row per step, `ON DELETE CASCADE` from the run.

Carries `kind`, `agent_role` (router/planner/executor/synthesizer), `provider`,
`model`, `tool_name`, full `input`/`output` jsonb, plus per-step
`prompt_tokens`, `output_tokens`, `cost_usd`, `latency_ms`, `error`.

A failed run still writes its steps. That is why a run that dies mid-loop still
renders a partial trace in the UI instead of a bare error.

**`eval_cases` / `eval_results`** -- the graded suite. A case carries
`expected_route`, `relevant_refs text[]` (the gold chunks) and
`expected_contains text[]`. A result carries `retrieved_refs`, `actual_route`,
`route_correct`, the metric scores, `answer_match`, `latency_ms` and `cost_usd`.

---

## The idea the schema is built around

The same fact is reachable two ways.

- *"What is the renal dose of Ciprofloxacin?"* -- an exact lookup on
  `generic.renal_dose`. SQL wins: it is precise, cheap and citable.
- *"What is used for reducing suicidal behaviour in schizophrenia?"* -- a
  retrieval question, even though the answer lives in that same column.

`apps/api/src/ingest/pipeline.ts` therefore embeds the structured monographs as
well as the markdown docs, so both paths exist over the same data and the
evaluation harness can show which one wins for which question shape.

Monograph ingestion is bounded by a `limit` (default 200) because embedding all
2,512 monographs is ~2,500 API calls -- fine on a paid key, a poor default on a
free one.
