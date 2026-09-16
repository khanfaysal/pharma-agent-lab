# Backend Architecture

`apps/api` -- Express 4 on Node 20+, TypeScript ESM, `tsx` in development.
Listens on `API_PORT` (4000). Every request is stateless; all durable state is
in Postgres.

```
routes/       Express endpoints, zod-validated
   |
agent/        4 architectures, router, context budget, run recorder
   |
tools/        10 typed tools, grouped sql | rag
   |
providers/    neutral Provider interface: gemini | anthropic | openai-compat | mock
vector/       semanticSearch | lexicalSearch | hybridSearch (RRF)
embeddings/   read-through cache over embedding_cache
   |
db.ts         pg Pool -- query / queryOne / transaction / vectorBackend
```

Each layer is written only against the layer below it. Nothing above
`providers/` knows that Gemini exists.

---

## `config.ts` -- one env file for the whole monorepo

Loads a single `.env` from the repo root, so both workspaces and the standalone
scripts see identical settings. Exposes `db`, `providers`, `embeddings`,
`agent` defaults, `tiers` and `server`.

### Tiers, not model names

Nothing in the codebase names a model. The agent asks for a **tier**:

```
TIER_FAST=gemini:gemini-3.5-flash-lite
TIER_BALANCED=gemini:gemini-3.6-flash
TIER_STRONG=gemini:gemini-3.8-flash
```

`parseModelRef()` splits `provider:model`. Swapping providers is a `.env` edit,
not a code change.

---

## `db.ts`

A single `pg.Pool`. Three helpers -- `query`, `queryOne`, `transaction` -- plus
`vectorBackend()`, which detects at runtime whether `pgvector` is installed so
the vector layer can pick its query shape.

---

## `providers/` -- the vendor-neutral boundary

```ts
interface Provider {
  name: string;
  isConfigured(): boolean;              // false when the API key is missing
  chat(req: ChatRequest): Promise<ChatResponse>;
  embed?(texts, model): Promise<number[][]>;
}
```

The neutral types live in `providers/types.ts`. Vendors disagree about almost
everything -- message shapes, how tool calls come back, what a "system" message
is -- so each adapter absorbs that difference:

| Adapter | Absorbs |
|---|---|
| `gemini.ts` | no system role (goes in `systemInstruction`); tool results matched by **name**, not id; no call ids, so they are synthesised; Gemini 3.x `thought_signature` round-tripping |
| `anthropic.ts` | content blocks, `tool_use` / `tool_result` pairing |
| `openaiCompat.ts` | any OpenAI-shaped endpoint: OpenRouter, Groq, Together, LM Studio, Ollama |
| `mock.ts` | deterministic stub + hash embeddings, so the lab runs with zero keys |

### Gemini 3.x thought signatures

Gemini 3 attaches an opaque `thought_signature` to every `functionCall` part.
When that call is replayed in the next turn's history, the signature **must**
come with it or the API returns `400 INVALID_ARGUMENT`. `ToolCall.signature`
carries it through the neutral layer; nothing above `providers/` reads it.

Signatures on plain *text* parts are currently dropped. That is not rejected
today, but it is where to look if a tool-free turn ever starts returning 400.

### `registry.ts` -- the single entry point for model calls

- `resolveTier(tier)` returns `{ provider, model, degraded }`. If the configured
  provider has no key it falls back to `mock` and sets `degraded: true`, so a
  missing key degrades the lab to offline mode instead of taking the API down.
  The flag is written to the run log and shown in the UI -- a comparison must
  never be silently run against stubs.
- `callModel(target, req)` wraps every call and attaches `latencyMs` and
  `costUsd`. There is no other path to a model.

### `pricing.ts`

USD per 1M tokens, looked up by **longest prefix**, so
`gemini-3.5-flash-lite-preview-xx` resolves against the `gemini-3.5-flash-lite`
entry. Unknown models cost 0 rather than guessing -- a missing rate shows up as
a suspicious zero instead of a fabricated number.

All current tier models are free on the AI Studio free tier; the table stores
the *paid* list rates so comparisons show what an architecture would cost at
production volume.

---

## `tools/` -- typed tools, not text-to-SQL

Ten tools, each a JSON Schema plus a handler. They are **grouped**, and the
router picks the group:

**SQL group** (`sqlTools.ts`)
`search_brands`, `search_generics`, `get_generic_detail`,
`compare_brand_prices`, `search_companies`, `search_by_indication`,
`database_overview`

**RAG group** (`ragTools.ts`)
`semantic_search`, `hybrid_search`, `keyword_search`

Why typed tools rather than letting the model write SQL: a parameterised tool
cannot be injected, cannot table-scan the whole catalog, and returns a shape the
citation layer understands.

### Errors are results, not exceptions

`executeTool()` never throws. An unknown tool name, a bad argument or a thrown
handler all come back as a tool **result** the model can read, so it can retry
with different arguments or say it could not find the information. A failing
tool must not kill the run.

### Narrowing is the point

`toolsFor(group)` exists because a model handed 10 tools for a 1-tool question
picks wrong more often and burns tokens on unused schemas. Making that list
smaller is the router's entire job.

---

## `vector/` -- three retrieval strategies

**`semanticSearch`** -- pure vector, cosine, with `topK` / `minScore` /
`sourceTypes` filters.

**`lexicalSearch`** -- over the generated `tsv` column, with one non-obvious
fix. `websearch_to_tsquery('english', 'how long do you keep my search history')`
yields every term ANDed together, and almost no chunk contains all of them, so
the query matches nothing. That is correct for a search box and wrong for the
lexical arm of a retriever fed whole questions. Rewriting the `&` operators to
`|` gives OR semantics and lets `ts_rank` do the work it is designed for.
Measured on this corpus the rewrite takes lexical recall@6 from 6% to a useful
figure, which is what makes hybrid fusion worth running at all.

**`hybridSearch`** -- Reciprocal Rank Fusion:

```
score(d) = sum over lists of  1 / (k + rank(d))      k = 60
```

RRF rather than weighted score blending because cosine similarity (0..1,
clustered high) and `ts_rank` (unbounded, clustered near 0) are not on
comparable scales. Normalising them requires per-corpus calibration that goes
stale; RRF only needs the two orderings. `k=60` is the Cormack et al. default and
damps the top rank enough that one list cannot dominate the fusion.

Every returned chunk carries `matchedBy: 'vector' | 'lexical' | 'hybrid'`, which
is what you want when debugging fusion.

---

## `embeddings/` -- read-through cache

`embed(texts)` hashes each input (SHA-256), reads `embedding_cache`, embeds only
the misses, validates the dimension and writes back.

Providers: `gemini`, `openai`, `ollama` (native `/api/embed`, kept separate
because its OpenAI shim is version-dependent), and `hash` (deterministic,
offline). An unconfigured provider degrades to hash embeddings with a warning
rather than failing.

---

## `agent/` -- the core

### Routing (`router.ts`)

```
question --> route: sql | rag | hybrid | none  --> tool group
         --> tier:  fast | balanced | strong
```

The LLM router always runs on the **fast** tier -- routing is classification,
and spending a strong model to decide whether to spend a strong model defeats
the purpose.

`heuristicRoute()` is a keyword matcher used when routing is disabled and when
the router model errors. It is also the **control arm**: if the LLM router does
not beat plain keyword matching, it is not paying for itself.

### Context management (`context.ts`)

An agent that pastes six tool results verbatim blows its input budget on step
three, and the failure looks like "the model got worse" rather than "we ran out
of room". `AgentContext` degrades in a defined order:

1. Truncate each tool result to 3500 chars as it arrives.
2. At 70% of `CONTEXT_TOKEN_BUDGET`, replace the **oldest** tool results with
   their one-line summaries, keeping the two most recent whole -- recency is the
   better proxy for relevance in a tool loop.
3. Never touch the system prompt or the user's question.

70% rather than 100% because the model's own output and the next tool result
still have to fit. Nothing is lost for auditing: full results stay in `gathered`
and are written to `agent_steps`.

### The four architectures

| Arm | Shape | Tests |
|---|---|---|
| `single` | one model routes, calls tools and writes the answer in one loop | the conventional agent |
| `multi` | router(fast) then planner(fast) then executor(balanced) then synthesizer(strong) | whether splitting roles across tiers is cheaper |
| `router-only` | retrieval, no generation | retrieval quality in isolation |
| `baseline-no-tools` | no tools at all | the control -- how much retrieval actually adds |

The multi-model thesis: tool *selection* is an easy task a small model does
adequately, while writing a correct grounded answer is a hard task worth a large
model. If it holds, multi costs less at comparable accuracy, because the
expensive model sees the evidence **once** instead of re-reading a growing
transcript on every step. It pays in latency -- four sequential calls, and a
handoff at which the synthesiser cannot ask for one more tool call. Whether the
trade is worth it is what `eval/` measures.

### `index.ts` -- one boundary for every arm

`runAgent()` is the only entry point. Every arm goes through it, so the timing
boundary, token accounting and run record are identical across arms. Errors are
caught and returned as a failed result rather than thrown: in a comparison, one
arm failing must not discard the arms that succeeded.

`runComparison()` runs several arms over one question under a shared
`comparison_id` and computes the winner row (cheapest / fastest / most citations
/ fewest steps). Arms run **sequentially by default** -- parallel calls trip
free-tier rate limits.

---

## `eval/`

`metrics.ts` -- `recallAtK`, `precisionAtK`, `reciprocalRank`, `ndcg`,
`answerContains`. nDCG is there because recall alone cannot tell apart two
systems that retrieve the same three relevant chunks in different orders.

`runner.ts` -- `evaluateRetrieval()` scores the three retrieval strategies over
`eval_cases`; `evaluateArchitectures()` runs the arms and scores route accuracy,
citation overlap and answer matching. Results persist to `eval_results`.

---

## HTTP API

Mounted at `/api`. CORS is locked to `WEB_ORIGIN`. Bodies are zod-validated and
a validation failure returns 400 with a flattened error.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | row counts, vector backend, providers, tiers, **degraded** flag |
| GET | `/tools` | tool schemas + architecture list |
| GET | `/corpus` | chunk/document stats |
| GET | `/search/documents` | retrieval without the agent (`strategy=semantic\|lexical\|hybrid`) |
| POST | `/search/sql` | execute one SQL tool directly |
| POST | `/chat` | run one architecture over one question |
| POST | `/compare` | run several arms, return winners |
| GET | `/runs`, `/runs/summary`, `/runs/:id` | history and one full trace |
| GET | `/eval/cases` | the graded suite |
| POST | `/eval/retrieval`, `/eval/architectures` | run an evaluation |
| GET | `/eval/summary` | aggregate scores |
| GET | `/brands`, `/generics/:id` | plain catalog browsing |

### `POST /chat` returns 502 on a failed run -- with the full body

```jsonc
{ "question": "...", "architecture": "single", "tier": "balanced",
  "useModelRouter": true, "maxSteps": 6, "conversationId": "..." }
```

A failed run still carries its steps, route, partial cost and error message. The
status code says "this did not succeed"; the body still lets the UI render the
trace. The web client is written to honour that.
