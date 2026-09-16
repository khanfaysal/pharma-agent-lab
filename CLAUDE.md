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
agent/      Architecture docs (read these before non-trivial changes).
.env        ONE file at the repo root, shared by both workspaces and scripts.
```

### The web app has three surfaces

```
DIRECTORY (root)                  ASSISTANT            LAB (/dev)
  /              home, agent hero   /ask  chat view     /dev  index, totals
  /browse        A-Z, class, brand  panel on /medicine  /dev/ask, /dev/compare
  /medicine/[id] monograph                              /dev/search, /dev/eval
  /dashboard     local history                          /dev/runs
  /settings      assistant options
```

Keep them separate. **Anything showing cost, tokens, latency, step traces, model
names or retrieval internals belongs under `/dev`.** If a user-facing page starts
needing those, the feature belongs in dev tools instead. `Nav.tsx` and
`HealthBanner.tsx` both switch on whether the path is under `/dev`.

### The colour contract is load-bearing

navy + slate = the directory. The violet→cyan gradient = **only** things the
agent produced (orb, reasoning trace, answer-card edge). On a medicine page the
monograph and the generated panel sit side by side and the gradient is the only
thing telling a reader which is which — the moment it appears on a button it
stops meaning "generated". Cyan `#22D3EE` is 1.81 on white: decorative only,
never text. Use `agent-ink` for agent-coloured words.

Safety colours (`safe`/`caution`/`critical`) are a separate axis from both.

### Conversation history is real

`conversationId` used to be written to `agent_runs` and never read. It now
seeds the transcript via `loadConversation()`, and the **router** sees the last
exchange too — without that, "what does it cost?" has no drug word in it, routes
to the document corpus and never queries the catalog. If you touch routing or
`AgentContext`, keep both halves.

User settings (architecture, tier, routing, search depth) live in localStorage
via `lib/settings.ts` and reach the API only as `POST /api/chat` body fields
through `toChatBody()`. Do not read `localStorage` directly from a page, and do
not add a server-side settings store without a reason -- these are request
parameters, not state.

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

**Views over junction tables fan out.** `v_brand_full` originally reached
therapeutic/systemic class through `therapeutic_generic` with a plain LEFT JOIN,
so a generic in four classes returned four identical rows per brand. Migration
`004` replaced those joins with correlated `string_agg` subqueries, the same
shape `v_generic_full` uses. If you add a column sourced from
`indication_generic` or `therapeutic_generic` to a per-brand view, aggregate it
— do not join it. The symptom shows up first as a React duplicate-key warning,
but the real damage is silent: any `LIMIT` over the view returns a fraction of
the rows, and `COUNT`/`MIN` come back multiplied.

**Changing the embedding model needs `-- --force`.** Plain `npm run ingest`
skips documents whose `content_hash` is unchanged — it does not look at which
model produced the stored vectors. After switching `EMBEDDING_MODEL` the skip
logic reports "6 skipped (unchanged)" and semantic search silently returns zero
results forever. Use `npm run ingest -w @lab/api -- --force`, then confirm with
`SELECT embedding_model, count(*) FROM document_chunks GROUP BY 1`.

**One busy model must not kill a run.** Free-tier Gemini returns 503 "high
demand" often enough to be a normal operating condition. `callModel()` falls
back across the configured tiers on 429/5xx, because a 503 is a property of the
model, not the request. Do not remove that — without it a 503 on the *router*,
the first and smallest call of the run, failed the question before a single tool
executed, and the user was told to rephrase a perfectly good question. Keep the
retry budget in `requestJson` tight (2 attempts, 45s) for the same reason:
three retries at 60s spent 190 seconds arriving at the same 503.

**pgvector is optional.** If the extension is absent the schema degrades to
`float8[]` with a SQL cosine function and no HNSW index. Any change to
`vector/store.ts` must work on both paths. `GET /api/health` reports which one
is live.

**A failed run is data, not an exception.** `POST /api/chat` returns **502 with
a complete run body** so the UI can render the partial trace. `apps/web/src/lib/api.ts`
has a deliberate carve-out for non-OK responses carrying an `architecture`
field. Keep it.

**Never delete `apps/web/.next` while the dev server is running.** It will
serve 500s for every route until you restart it.

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
