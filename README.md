# Pharma Agent Lab

A production-shaped testbed for comparing **single-model** and **multi-model** agentic RAG
architectures over a mix of structured SQL data and unstructured documents.

```
Next.js  →  Express  →  Agent layer  →  SQL tools / RAG tools  →  PostgreSQL (+ pgvector)
                            │
                            ├── router      (which data source, how much model)
                            ├── planner     (which tools, in what order)
                            ├── executor    (calls the tools)
                            └── synthesiser (writes the grounded answer)
```

The dataset is a real DIMS-style pharmaceutical reference database — **28,245 marketed brands,
2,512 active-ingredient monographs, 674 manufacturers, 1,674 indications**, plus a parallel herbal
catalogue — alongside a corpus of service documents (privacy policy, terms, FAQ, product docs,
website pages).

---

## Why this exists

Most RAG demos prove that retrieval *works*. This one is built to measure **whether a given agent
topology is worth its cost**, which requires three things a demo usually skips:

1. **A control arm.** `baseline-no-tools` answers from the model's own knowledge. Without it, a
   respectable score on the agent arms is uninterpretable — you cannot tell retrieval from recall.
2. **Separated metrics.** Retrieval quality and answer quality are different failure modes with
   different fixes. They are scored independently.
3. **A full trace.** Every LLM call and tool call is persisted with tokens, cost and latency, so
   "multi-model was better" can be traced to *which step* made it better.

---

## Quick start

**Prerequisites:** Node ≥ 20.11, PostgreSQL ≥ 13 running locally, and `psql` on disk.

```bash
cd "D:/work folder/pharma-agent-lab"
npm install
cp .env.example .env        # then edit: PG* credentials, PSQL_BIN, GEMINI_API_KEY
```

```bash
node scripts/mysql2pg.mjs "C:/Users/<you>/Downloads/pharmaceutical_data_full.sql" db/seed/pharma_data.sql
```

```bash
node scripts/db-setup.mjs --drop
```

```bash
npm run ingest -w @lab/api && npm run seed:eval -w @lab/api
```

```bash
npm run dev
```

API on `http://localhost:4000/api`, UI on `http://localhost:3000`.

### It runs without any API key

With no provider key configured, the lab falls back to a deterministic **mock provider** and
**hashed bag-of-words embeddings**. The entire pipeline — routing, tool calls, retrieval, synthesis,
run logging, evaluation — executes end to end offline. A standing amber banner says so, because a
comparison run in that state compares stubs, not models.

Add `GEMINI_API_KEY` to `.env` (free tier at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)),
restart the API, and re-run `npm run ingest -w @lab/api -- --force` for real semantic embeddings.

---

## Layout

```
db/
  migrations/001_structured_schema.sql   15 tables + 3 denormalised views, ported from MySQL
  migrations/002_vector_schema.sql       documents, chunks, dual-mode embedding column
  migrations/003_agent_schema.sql        agent_runs, agent_steps, eval_cases, eval_results
  docs/                                  the unstructured corpus (6 markdown documents)
  seed/pharma_data.sql                   generated; git-ignored
scripts/
  mysql2pg.mjs                           mysqldump → PostgreSQL converter
  db-setup.mjs                           create + migrate + seed in one command
apps/api/src/
  providers/    gemini · anthropic · openai-compatible · mock, behind one interface
  embeddings/   provider-agnostic, read-through cache
  vector/       semantic · lexical · hybrid (RRF) search
  tools/        7 typed SQL tools + 3 retrieval tools
  agent/        router · single · multi · baseline · context manager · recorder
  eval/         recall@k, precision@k, MRR, nDCG, route accuracy, answer assertions
apps/web/src/   Ask · Compare · Search · Evaluate · Runs
```

---

## Design decisions worth knowing

### pgvector is optional

pgvector is not installable on every PostgreSQL build (notably the Windows/Laragon one this was
developed against — no Docker, no MSVC). Rather than block on it, migration 002 is **dual-mode**:

| pgvector present | pgvector absent |
| --- | --- |
| `embedding vector(768)` | `embedding double precision[]` |
| `<=>` cosine operator, HNSW index | `array_cosine_similarity()`, exact seq scan |

One SQL function, `vector_backend()`, is the single source of truth; the Node `VectorStore` reads it
at boot and picks a driver. Installing pgvector later is `node scripts/db-setup.mjs --drop` plus a
re-ingest — **no application code changes**. The fallback is exact (not approximate) and comfortably
fast at this corpus size; it stops scaling somewhere in the tens of thousands of chunks.

### Typed tools, not text-to-SQL

The model never writes SQL. It calls parameterised tools like `compare_brand_prices` and
`search_by_indication`.

Generated SQL over 15 tables — one of which has a misspelled join column, `therapitic_id`, preserved
verbatim from the source dump — fails in the worst possible way: it *runs*, returns plausible rows,
and answers a different question than the one asked. Typed tools trade flexibility for failures that
are loud instead of silent. A tool either matches or reports `empty`, and every row it returns
carries a citable primary key.

### Hybrid retrieval uses RRF, not score blending

Cosine similarity (0–1, clustered high) and `ts_rank` (unbounded, clustered near zero) are not on
comparable scales. Normalising them needs per-corpus calibration that goes stale. Reciprocal Rank
Fusion at k=60 needs only the two *orderings*.

**A measured bug this surfaced:** `websearch_to_tsquery('english', 'how long do you keep my search
history')` produces `'long' & 'keep' & 'search' & 'histori'` — every term ANDed. Almost no chunk
contains all of them, so the lexical arm matched essentially nothing. Rewriting `&` to `|` and
letting `ts_rank` order the results took lexical **recall@6 from 6.3% → 93.8%** and **MRR from
12.5% → 84.4%** on the gold set.

### Context management degrades in a defined order

An agent that pastes six tool results verbatim exhausts its input budget on step three, and the
failure looks like "the model got worse". `AgentContext` keeps an explicit budget and:

1. truncates each tool result on arrival (bounded per-result cost);
2. at 70% of budget, collapses the **oldest** tool results to one-line summaries, keeping the two
   most recent intact — recency is the better relevance proxy in a tool loop;
3. never touches the system prompt or the question.

Nothing is lost for auditing: full results still go to `agent_steps`.

### Cost accounting is real

`providers/pricing.ts` holds per-model USD rates with longest-prefix lookup. Every model call is
priced and timed through one function, so arms are comparable. Unknown models price at **zero**
rather than a guess — a suspicious zero in the table is better than a fabricated number.

---

## The four architectures

| Arm | Topology | What it isolates |
| --- | --- | --- |
| `single` | one model routes → calls tools → answers, in one loop | the baseline agent |
| `multi` | fast router → fast planner → mid executor → strong synthesiser | whether splitting roles by difficulty pays |
| `router-only` | route → one tool call → raw output, no answering model | retrieval quality, free of generation |
| `baseline-no-tools` | one call, no database, no retrieval | how much the model already knew |

**The hypothesis `multi` tests:** tool *selection* is easy enough for a small model, while writing a
correct grounded answer is worth a large one. If that holds, `multi` costs less at comparable
accuracy — the expensive model sees the evidence exactly once, instead of re-reading a growing
transcript on every step. What it pays is latency, and a handoff at which the synthesiser can no
longer request one more tool call.

Whether the trade is worth it is an empirical question. That is what the eval harness is for.

---

## Evaluation

```bash
npm run eval -w @lab/api                    # retrieval only — free, no LLM calls
npm run eval -w @lab/api -- --agents        # + end-to-end architecture comparison
npm run eval -w @lab/api -- --agents --arch=single,multi,baseline-no-tools --limit=8
```

The gold set (`src/scripts/seed-eval-cases.ts`) is **25 cases** — 9 SQL, 13 document, 3 hybrid.
Every `expected_contains` value was read out of the loaded database, not invented; a gold set
asserting facts the data does not contain measures nothing.

Metrics: `recall@k`, `precision@k`, `MRR`, `nDCG` for retrieval; route accuracy and substring
assertions for generation. nDCG is the one to watch — unlike recall it penalises burying a relevant
passage at rank 6, where context truncation may drop it.

Answer scoring is deliberately **substring assertions, not an LLM judge**. A judge costs money and
injects its own bias into a comparison whose entire purpose is comparing models — it will flatter
whichever arm shares its family.

**Cases with no gold refs are excluded from the retrieval averages**, not scored as 1.0. `recall@k`
over an empty gold set is trivially perfect, and the SQL cases have no document refs — averaging
them in handed every arm a free 100%, including the no-tools baseline that retrieves nothing at all.
Excluding them is what makes the column discriminate:

```
architecture        cases   route   recall    nDCG    (mock models, 12 cases)
single                 12   58.3%   100.0%   58.7%
multi                  12   58.3%    33.3%   21.0%
baseline-no-tools      12   41.7%     0.0%    0.0%   ← correct: it retrieves nothing
```

### Baseline numbers (hash embeddings, no API key)

```
mode      cases  recall@k  prec@k     MRR    nDCG   latency
semantic     16    81.3%   36.0%   63.0%   63.3%  39ms
lexical      16    93.8%   42.9%   84.4%   83.1%   1ms
hybrid       16    78.1%   36.7%   64.6%   63.0%  46ms
```

Hybrid currently trails lexical — **as expected**, because the semantic arm is running on hashed
bag-of-words vectors that contribute noise to the fusion. Set `GEMINI_API_KEY`, re-ingest with
`--force`, and re-run: real embeddings should lift semantic and put hybrid on top. Reproducing that
flip is a good first experiment.

---

## Configuration

Model tiers are `.env` strings, so changing providers never touches code:

```bash
TIER_FAST=gemini:gemini-2.0-flash-lite
TIER_BALANCED=gemini:gemini-2.0-flash
TIER_STRONG=gemini:gemini-2.5-flash
```

Any `provider:model` works across the four adapters:

```bash
TIER_STRONG=anthropic:claude-sonnet-5
TIER_STRONG=openai:llama-3.3-70b-versatile     # with OPENAI_BASE_URL=https://api.groq.com/openai/v1
TIER_FAST=openai:qwen2.5                       # with OPENAI_BASE_URL=http://localhost:11434/v1
TIER_FAST=mock:anything                        # deterministic, offline
```

A provider with no key is skipped by the registry and the tier degrades to `mock` — surfaced in the
run log, the health endpoint, and the UI banner. It never fails silently.

**Cross-provider comparison is the interesting experiment here:** set `TIER_STRONG` to a different
vendor from `TIER_BALANCED` and the `multi` arm becomes genuinely multi-vendor, with per-vendor cost
and latency broken out per step.

---

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | counts, vector backend, providers, tier resolution, degraded flag |
| `GET` | `/api/tools` | tool catalogue with schemas |
| `POST` | `/api/chat` | run one architecture — `{question, architecture, tier?, useModelRouter?}` |
| `POST` | `/api/compare` | run several arms on one question |
| `GET` | `/api/search/documents` | raw retrieval — `?q=&mode=semantic\|lexical\|hybrid&topK=` |
| `POST` | `/api/search/sql` | invoke one SQL tool directly — `{tool, args}` |
| `GET` | `/api/runs`, `/api/runs/:id`, `/api/runs/summary` | run history and traces |
| `POST` | `/api/eval/retrieval`, `/api/eval/architectures` | scoring |
| `GET` | `/api/brands`, `/api/generics/:id` | plain catalogue browse |

---

## Experiments worth running

1. **Does the LLM router beat keywords?** Toggle `useModelRouter` and compare route accuracy. If the
   model router does not beat `heuristicRoute`, it is not paying for itself.
2. **Does hybrid beat vector-only?** Re-run the retrieval eval after setting a real embedding key.
3. **Where does multi-model win?** Compare cost and accuracy per *question shape* — the aggregate
   likely hides that it wins on multi-step questions and loses on single lookups.
4. **How much does the baseline already know?** Run `baseline-no-tools` on the SQL cases. It cannot
   know that Ciprofloxacin has 328 brands; watch whether it says so or invents a number.
5. **Chunk size sensitivity.** Change `targetChars` in `ingest/pipeline.ts`, re-ingest, re-score.
6. **Embed the monographs.** `npm run ingest -w @lab/api -- --monographs=500` makes the same
   question answerable by SQL lookup *or* semantic retrieval — then measure which wins for which
   question shape.

---

## Notes and limits

- Prices, dosing and clinical text come from the source dump as-is. This is a **reference
  database for architecture research**, not a clinical tool, and the prompts instruct the agent to
  refuse personalised dosing decisions.
- `MedIndex` is a fictional service invented for the document corpus. It is not a real company;
  the policies and terms in `db/docs/` are plausible test fixtures, not legal documents.
- The fallback vector scan is `O(n)` per query. Fine here; install pgvector before scaling the
  corpus much past ~10k chunks.
- `agent_steps` payloads are capped at 20 KB each so one large tool result cannot bloat the table.
