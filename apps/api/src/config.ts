import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// The whole monorepo shares one .env at the repo root, so both workspaces and
// the standalone scripts see identical settings.
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../../.env') });

const str = (key: string, fallback = ''): string => process.env[key]?.trim() || fallback;
const num = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** A `provider:model` pair as written in .env, split into parts. */
export interface ModelRef {
  provider: string;
  model: string;
}

function parseModelRef(raw: string, fallback: ModelRef): ModelRef {
  const idx = raw.indexOf(':');
  if (idx <= 0) return fallback;
  return { provider: raw.slice(0, idx), model: raw.slice(idx + 1) };
}

export const config = {
  db: {
    host: str('PGHOST', '127.0.0.1'),
    port: num('PGPORT', 5432),
    user: str('PGUSER', 'postgres'),
    password: str('PGPASSWORD', 'postgres'),
    database: str('PGDATABASE', 'pharma_agent_lab'),
  },

  providers: {
    gemini: { apiKey: str('GEMINI_API_KEY') },
    anthropic: { apiKey: str('ANTHROPIC_API_KEY') },
    openai: { apiKey: str('OPENAI_API_KEY'), baseUrl: str('OPENAI_BASE_URL') },
  },

  embeddings: {
    provider: str('EMBEDDING_PROVIDER', 'gemini'),
    model: str('EMBEDDING_MODEL', 'gemini-embedding-2'),
    // Must match the column width in db/migrations/002_vector_schema.sql.
    dim: num('EMBEDDING_DIM', 768),
  },

  agent: {
    maxSteps: num('AGENT_MAX_STEPS', 6),
    ragTopK: num('RAG_TOP_K', 6),
    // Chunks below this cosine score are dropped rather than padding the
    // context -- an irrelevant chunk costs tokens and invites a wrong citation.
    ragMinScore: num('RAG_MIN_SCORE', 0.25),
    contextTokenBudget: num('CONTEXT_TOKEN_BUDGET', 12_000),
  },

  /**
   * Model tiers. The router chooses a tier by name; only this map knows which
   * concrete model that is, so swapping providers is a .env edit.
   */
  tiers: {
    fast: parseModelRef(str('TIER_FAST'), { provider: 'gemini', model: 'gemini-3.5-flash-lite' }),
    balanced: parseModelRef(str('TIER_BALANCED'), { provider: 'gemini', model: 'gemini-3.6-flash' }),
    strong: parseModelRef(str('TIER_STRONG'), { provider: 'gemini', model: 'gemini-3.8-flash' }),
  },

  server: {
    port: num('API_PORT', 4000),
    webOrigin: str('WEB_ORIGIN', 'http://localhost:3000'),
  },
} as const;

export type Tier = keyof typeof config.tiers;
export const TIERS: Tier[] = ['fast', 'balanced', 'strong'];
