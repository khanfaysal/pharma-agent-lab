/** Thin typed client for the Express API. */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });

  const text = await res.text();
  const body = text ? JSON.parse(text) : {};

  // The agent endpoint returns 502 with a full result body on a failed run.
  // Surface that body rather than a bare status, so the UI can show the trace.
  if (!res.ok && !(body as { architecture?: string }).architecture) {
    throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
};

/* --------------------------------------------------------------- types */

export type Architecture = 'single' | 'multi' | 'router-only' | 'baseline-no-tools';

export interface Citation {
  kind: 'sql' | 'doc';
  ref: string;
  label: string;
  uri?: string | null;
}

export interface AgentStep {
  stepIndex: number;
  kind: string;
  agentRole?: string;
  provider?: string;
  model?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  usage?: { promptTokens: number; outputTokens: number };
  costUsd?: number;
  latencyMs?: number;
  error?: string;
}

export interface GatheredResult {
  name: string;
  args: Record<string, unknown>;
  summary: string;
  data: unknown;
  citations: Citation[];
  empty: boolean;
}

export interface AgentRunResult {
  runId: number | null;
  architecture: Architecture;
  strategyLabel: string;
  question: string;
  answer: string;
  route: string;
  routeReasoning: string;
  routeDecidedBy: string;
  toolsUsed: string[];
  gathered: GatheredResult[];
  citations: Citation[];
  steps: AgentStep[];
  usage: { promptTokens: number; outputTokens: number };
  costUsd: number;
  latencyMs: number;
  stepCount: number;
  contextTokens: number;
  compactions: number;
  status: 'ok' | 'error' | 'max_steps';
  degraded: boolean;
  error?: string;
}

export interface ComparisonResult {
  comparisonId: string;
  question: string;
  runs: AgentRunResult[];
  winners: {
    cheapest: string | null;
    fastest: string | null;
    mostCitations: string | null;
    fewestSteps: string | null;
  };
}

export interface Health {
  ok: boolean;
  database: string;
  vectorBackend: 'pgvector' | 'fallback';
  counts: Record<string, number>;
  embeddings: {
    provider: string; model: string; dim: number;
    cachedVectors: number; cachedModels: string[];
  };
  providers: string[];
  tiers: Array<{ tier: string; configured: string; effective: string; degraded: boolean }>;
  degraded: boolean;
  agentDefaults: Record<string, number>;
}

export interface DocChunk {
  chunkId: number;
  slug: string;
  title: string;
  sourceType: string;
  heading: string | null;
  content: string;
  score: number;
  matchedBy: 'vector' | 'lexical' | 'hybrid';
  uri: string | null;
}

export interface RetrievalEval {
  suite: string;
  topK: number;
  results: Array<{
    mode: string;
    cases: number;
    avgRecall: number | null;
    avgPrecision: number | null;
    avgMrr: number | null;
    avgNdcg: number | null;
    avgLatencyMs: number | null;
    perCase: Array<{
      caseId: number; question: string; retrieved: string[]; relevant: string[];
      recallAtK: number; mrr: number; ndcg: number;
    }>;
  }>;
}

export interface RunSummaryRow {
  architecture: string;
  strategy_label: string;
  runs: number;
  avg_latency_ms: number;
  avg_steps: number;
  avg_tokens: number;
  avg_cost_usd: number;
  total_cost_usd: number;
  failures: number;
}

export const ARCHITECTURE_LABELS: Record<Architecture, string> = {
  single: 'Single-model',
  multi: 'Multi-model',
  'router-only': 'Router only',
  'baseline-no-tools': 'Baseline (no tools)',
};

export const ARCHITECTURE_BLURBS: Record<Architecture, string> = {
  single: 'One model routes, calls tools and writes the answer in a single loop.',
  multi: 'Fast router + fast planner + mid executor + strong synthesiser.',
  'router-only': 'Retrieval with no generation — isolates retrieval quality.',
  'baseline-no-tools': 'No database, no retrieval — shows what the model already knew.',
};

/* --------------------------------------------------- directory browse */

export interface GenericRow {
  generic_id: number;
  generic_name: string;
  therapeutic_classes: string | null;
  brand_count: number;
  cheapest_brand_price: number | null;
}

export interface BrandRow {
  brand_id: number;
  brand_name: string;
  company_name: string;
  generic_name: string;
  generic_id?: number;
  form: string | null;
  strength: string | null;
  packsize: string | null;
  price_min: number | null;
  is_sponsored?: boolean;
}

/** One monograph, as `v_generic_full` returns it. */
export interface GenericDetail {
  generic_id: number;
  generic_name: string;
  indication: string | null;
  adult_dose: string | null;
  child_dose: string | null;
  renal_dose: string | null;
  administration: string | null;
  contra_indication: string | null;
  precaution: string | null;
  interaction: string | null;
  side_effect: string | null;
  mode_of_action: string | null;
  pregnancy_category: string | null;
  pregnancy_category_note: string | null;
  brand_count: number;
  cheapest_brand_price: number | null;
  therapeutic_classes: string | null;
  indications: string | null;
}

export const money = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `৳${n.toFixed(2)}`;
