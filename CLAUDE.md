# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this project is

A lab for comparing single-model and multi-model agentic RAG architectures over
the same structured SQL + pgvector pharmaceutical data. It is a **measurement
harness**, not a product. When a change would make the app nicer but the
measurements less trustworthy, the measurements win.

Detailed architecture notes live in [`agent/`](agent/):

- [`agent/backend-architecture.md`](agent/backend-architecture.md)
- [`agent/frontend-architecture.md`](agent/frontend-architecture.md)
- [`agent/database-architecture.md`](agent/database-architecture.md)

Read the relevant one before making non-trivial changes to that area.

## Layout

```
apps/api    Express + TypeScript ESM. Agent, tools, providers, retrieval, eval.
apps/web    Next.js 15 App Router. Thin client -- no server-side data access.
db          SQL migrations, markdown corpus, seed dump.
scripts     db-setup.mjs (psql driver), mysql2pg.mjs (dump converter).
.env        ONE file at the repo root, shared by both workspaces and scripts.
```

npm workspaces. This is **not** a git repository.

## Commands

```bash
npm run dev            # api + web together (concurrently)
npm run dev:api        # tsx watch, :4000
npm run dev:web        # next dev, :3000

npm run db:setup       # create db, apply migrations, load seed
npm run db:reset       # drop and recreate first
npm run ingest         # chunk + embed the corpus
npm run eval           # run the graded suite

npm run typecheck      # both workspaces -- run this before declaring done
npm run build
```

There is no test runner. `npm run typecheck` plus a real request against the
running API is the verification bar.

## Environment

Both workspaces load the same root `.env` via `apps/api/src/config.ts`. Never
add a second `.env` inside a workspace.

Model selection is by **tier**, never by model name in code:

```
TIER_FAST=gemini:gemini-3.5-flash-lite
TIER_BALANCED=gemini:gemini-3.6-flash
TIER_STRONG=gemini:gemini-3.8-flash
```

If you need a different model, edit `.env` and the fallback in `config.ts`.
Do not hardcode a model id anywhere else.

## Things that will bite you

**Gemini 3.x requires thought signatures on replayed tool calls.** Every
`functionCall` part comes back with an opaque `thought_signature`; if it is not
echoed on the next turn, the API returns `400 INVALID_ARGUMENT`. This is carried
through the neutral layer as `ToolCall.signature`. Do not drop it when editing
`providers/gemini.ts` or the message-building code in `agent/context.ts`.

**Gemini 2.x models are gone.** A recently issued API key gets `404 ... no
longer available to new users` for the entire `gemini-2.5-*` family, even though
the public pricing page still lists them as free-tier. Verify a model against the
live `models` endpoint before configuring it. Pro-class models return `429` on
the free tier.

**The embedding dimension is coupled to the schema.** `EMBEDDING_DIM=768` is the
column width in `db/migrations/002_vector_schema.sql`. `gemini-embedding-*`
returns 3072 by default, so the provider sends `outputDimensionality`
explicitly. Changing the embedding model means checking the dimension and
re-running `npm run ingest` -- cached vectors are keyed by model name and will
not be reused.

**pgvector is optional.** If the extension is absent the schema degrades to
`float8[]` with a SQL cosine function and no HNSW index. Any change to
`vector/store.ts` must work on both paths. `GET /api/health` reports which one
is live.

**A failed run is data, not an exception.** `POST /api/chat` returns **502 with
a complete run body** so the UI can render the partial trace. `apps/web/src/lib/api.ts`
has a deliberate carve-out for non-OK responses carrying an `architecture`
field. Keep it.

**Arms run sequentially by default.** `runComparison({ parallel: false })` is
the default because concurrent calls trip free-tier rate limits. Do not flip it
to make comparisons faster.

**Next.js workspace root is pinned.** Stray `package-lock.json` files above the
repo make Next infer the wrong root; `next.config.mjs` sets
`outputFileTracingRoot` and `turbopack.root` to fix it. Leave them.

## Conventions

- **Never hardcode a model name.** Ask for a tier.
- **Tools return errors, they do not throw.** `executeTool()` turns a failure
  into a tool result the model can read and recover from. Preserve that.
- **Every model call goes through `callModel()`** so it is timed and priced.
  There is no second path.
- **Everything the UI shows is read back from `agent_runs` / `agent_steps`**,
  never recomputed in the browser.
- **Unknown model prices are 0, not guessed.** A missing rate should look like
  an obvious hole in the comparison table, not a fabricated number.
- Comments explain *why*, not *what*. The existing code sets the density --
  match it rather than adding narration.
- TypeScript ESM: relative imports carry the `.js` extension.

## Adding things

**A new tool** -- add to `tools/sqlTools.ts` or `tools/ragTools.ts` with a JSON
Schema, set its `group`, export it in the array at the bottom. The registry picks
it up. Keep the parameter surface small; the router narrows by group, and a
model given too many tools picks wrong.

**A new provider** -- implement `Provider` in `providers/`, register it in
`registry.ts`, add an env key in `config.ts`. Absorb the vendor's quirks in the
adapter so nothing above it changes.

**A new architecture** -- add a runner returning `LoopOutcome`, register it in
`ARCHITECTURES` and `RUNNERS` in `agent/index.ts`, give it a label. It then gets
the same timing boundary, cost accounting and run record as every other arm.

**A migration** -- add a numbered file in `db/migrations/`. They are applied in
filename order and re-running them on an existing database is expected to fail
on already-present objects.
