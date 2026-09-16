# Frontend Architecture

`apps/web` -- Next.js 15 (App Router), React 19, Tailwind 3, TypeScript.
Runs on port 3000.

The important thing to understand up front: **this is a thin client.** Every
page is a client component that fetches from the Express API in the browser.
There is no server-side data fetching, no route handlers, no server actions and
no database access from Next.js. All logic lives in `apps/api`.

That is deliberate. The lab compares agent architectures, and every measurement
-- cost, latency, token counts, step traces -- has to be produced at one place
in one way. Splitting work between a Next server and the API would give two
places where a run could be timed.

---

## Three audiences, three languages

```
DIRECTORY (root)                  ASSISTANT               LAB (/dev)
  /            home, agent hero     /ask    chat view       /dev/*  unchanged
  /browse      A-Z, class, brands   panels on /medicine
  /medicine/[id]  monograph
  /dashboard   local history
  /settings    assistant options
```

The directory bones stay familiar and trusted -- search box, browse by
brand/generic, medicine detail pages -- and the agent is layered on as a
distinct, always-available surface rather than replacing them. Someone who does
not want to talk to an AI can still use this as the medicine directory they came
for.

### The colour contract

Two languages, kept strictly apart:

| | Used for | Never |
|---|---|---|
| **navy + slate** | all directory chrome, catalog data, actions | — |
| **agent violet→cyan** | the orb, reasoning trace, answer-card edge, agent chips | any ordinary UI |

This is load-bearing, not decoration. On a medicine page the monograph and the
generated panel sit side by side, and the gradient is the only thing telling a
reader which is which. The moment the accent appears on a button or a nav item
it stops meaning "this was generated".

Cyan (`agent-end`, #22D3EE) is **1.81 on white** and is decorative only --
never text, never a fill behind white text. `agent-ink` (#6D28D9, 7.10) exists
for agent-coloured words.

Safety colours are a third, separate axis: `safe` / `caution` / `critical`,
each a fg+bg+border triplet, because a contraindication has to be scannable
before it is readable.

## Typography

Space Grotesk for headlines (technical edge), Plus Jakarta Sans for body
(humanist, readable through long clinical prose). Both self-hosted through
`next/font`, bound to `--font-display` / `--font-body` and exposed as
`font-display` / `font-sans`. Fallback metrics are generated, so there is no
layout shift.

## `lib/api.ts` -- the whole data layer

A typed `fetch` wrapper over `NEXT_PUBLIC_API_URL` (default
`http://localhost:4000`), with `cache: 'no-store'` because every response is a
fresh measurement.

```ts
export const api = {
  get:  <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
          request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
};
```

### The one non-obvious rule

```ts
// The agent endpoint returns 502 with a full result body on a failed run.
// Surface that body rather than a bare status, so the UI can show the trace.
if (!res.ok && !(body as { architecture?: string }).architecture) {
  throw new ApiError(res.status, body.error ?? res.statusText);
}
return body as T;
```

`POST /api/chat` answers **502 with a complete run object** when a run fails. A
failed run is data in this application, not an exception: it still has a route,
steps, partial token counts, cost and latency, and those are exactly what you
need to see when debugging. So a non-OK response that carries an `architecture`
field is passed through as a normal result and rendered as a trace with an error
banner.

If you ever change error handling here, keep that carve-out. Without it a failed
run collapses to a one-line message and the trace is lost.

This file also holds the shared response types -- `Architecture`, `Citation`,
`AgentStep`, `AgentRunResult`, `ComparisonResult`, `Health` and the eval shapes
-- hand-mirrored from `apps/api/src/agent/types.ts`. They are not generated, so
an API shape change needs a matching edit here.

---

## State that is not on the server

Two localStorage-backed modules, both written so a throwing or empty
`localStorage` (private window, blocked site data) degrades quietly.

**`lib/settings.ts`** -- architecture, model tier, smart-routing toggle and
search depth. These are *request parameters*, not server state, so they never
leave the browser except as fields on `POST /api/chat`. `toChatBody()` is the
single place that maps settings to the request body.

`useSettings()` returns the defaults on the first render and loads from storage
in an effect. Reading storage during render would make server and client markup
differ and trip hydration. Stored values are merged over the defaults, so a
field added later still has a value for someone holding an older shape.

**`lib/history.ts`** -- the dashboard's question list. Deliberately *not* read
from `agent_runs`: that table holds every run by everyone, including the eval
harness. "Questions I asked in this browser" is the only reading of history that
means anything to a user with no account. `/dev/runs` is the server-side view of
the same activity.

## Pages

### `/` -- the front door

A heading, a search box, four example questions. That is all, until you ask
something -- then the examples and heading fall away and the answer takes the
page, with its sources underneath.

What is deliberately **not** here: architecture buttons, the router toggle, the
step trace, retrieved evidence, token counts and cost. Those moved to
`/settings` and `/dev/ask`.

Error wording differs by surface too. A failed run shows "That question could not
be answered this time" with a quiet pointer to `/dev/runs`, rather than the raw
provider error a developer wants.

### `/settings`

Architecture, model tier (including **Automatic**, which lets the router pick),
smart routing on/off, and search depth (`maxSteps`). Each row is titled in user
language -- "Search depth", not "max tool-call steps" -- with a one-line
explanation of the trade-off. Changes save as you make them.

### `/dashboard`

Recent questions from localStorage, each with its answer preview, age and source
count, removable individually or all at once. Below that, coverage: brands,
generics, manufacturers and documents from `/api/health`, with a line making the
grounding explicit -- answers come from this catalog, not from the model's
memory.

No cost, tokens or latency. Those are developer concerns.

### `/dev`

Cards for the five tools, aggregate run totals by architecture from
`/api/runs/summary`, and the live configuration: database, vector backend,
embedding model and dimension, configured providers, and each resolved tier with
its degraded flag.

### `/dev/ask`, `/dev/compare`, `/dev/search`, `/dev/eval`, `/dev/runs`

Unchanged from before the split, other than their paths. `/dev/ask` is the full
instrumented version of the landing page: architecture picker, router toggle,
retrieved evidence and the complete step trace.

## Components

**Width is part of the split.** The directory pages are reading surfaces and
cap themselves (`max-w-2xl` to `max-w-6xl`). `/dev` is full-bleed:
`app/dev/layout.tsx` supplies `w-full px-6 2xl:px-10` and the dev pages carry
no container of their own. A four-arm comparison, a run table with ten numeric
columns and a step trace all want every pixel, and a centred column makes them
scroll sideways on the machines where they are actually used. `Nav` and
`HealthBanner` widen under `/dev` too, so the chrome lines up with the content
beneath it.

**`Nav.tsx`** reads `usePathname()` and renders the user nav or the dev nav.
Adding a page means adding it to `USER_NAV` or `DEV_NAV` -- there is no third
list.

**`HealthBanner.tsx`** polls `GET /api/health`. Under `/dev` it shows database
name, row counts, vector backend (`pgvector` or `fallback`) and configured
tiers. Outside `/dev` it renders nothing unless the API is unreachable, or
`degraded` is true -- in which case users get a plain "Demo mode: answers are
placeholders" strip, because an answer produced by the mock provider must never
be mistaken for a real one.

**`RunTrace.tsx`** renders `AgentStep[]`: index, kind (`route`, `plan`, `llm`,
`tool`, `synthesize`), agent role, model, tokens and duration, with inputs and
outputs expandable. Shared by `/` and `/compare` so a trace looks identical
wherever it appears.

---

## Configuration

`next.config.mjs` does two things:

```js
outputFileTracingRoot: repoRoot,   // pin the workspace root
turbopack: { root: repoRoot },
env: { NEXT_PUBLIC_API_URL: ... }
```

The root pinning is not cosmetic. Stray `package-lock.json` files above the repo
make Next walk up and infer the wrong workspace root, which it warns about at
startup. Pinning it to `apps/web/../..` settles it.

`NEXT_PUBLIC_API_URL` is inlined at build time, so changing it requires a
restart of the dev server, not just a refresh.

---

## Conventions

- Every page starts with `'use client'`. If you add a server component, be
  deliberate about it -- the measurement boundary is the reason everything is
  client-side today.
- All data access goes through `lib/api.ts`. No bare `fetch` in a page.
- **Keep the surfaces separate.** Anything showing cost, tokens, latency, step
  traces or model names belongs under `/dev`. If a user-facing page starts
  needing those, that is a signal the feature belongs in dev tools instead.
- Settings are read through `useSettings()` and sent via `toChatBody()`. Do not
  read `localStorage` directly from a page.
- Tailwind utility classes inline; no component library.
- Loading and error states are local `useState` -- there is no global store and
  the app does not need one.
