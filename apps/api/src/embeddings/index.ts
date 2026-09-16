import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { query, queryOne } from '../db.js';
import { getProvider } from '../providers/registry.js';
import { requestJson } from '../providers/types.js';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * Embed via Ollama's native endpoint. Kept separate from the OpenAI-compatible
 * provider because Ollama's /api/embed is simpler and always present, whereas
 * its /v1/embeddings shim depends on the server version.
 */
async function ollamaEmbed(texts: string[], model: string): Promise<number[][]> {
  const base = (config.providers.openai.baseUrl || 'http://localhost:11434')
    .replace(/\/v1\/?$/, '')
    .replace(/\/+$/, '');
  const json = (await requestJson('ollama', `${base}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: texts }),
  })) as { embeddings?: number[][] };
  return json.embeddings ?? [];
}

async function embedRaw(texts: string[]): Promise<number[][]> {
  const { provider, model } = config.embeddings;

  if (provider === 'ollama') return ollamaEmbed(texts, model);
  if (provider === 'hash') return getProvider('mock').embed!(texts, model);

  const impl = getProvider(provider);
  if (!impl.isConfigured() || !impl.embed) {
    // Same degradation policy as chat: fall back to the deterministic hash
    // embedder rather than failing, and let the caller see the dimension.
    console.warn(`[embeddings] ${provider} unavailable, using hash embeddings`);
    return getProvider('mock').embed!(texts, model);
  }
  return impl.embed(texts, model);
}

/**
 * Embed a batch, reading through the `embedding_cache` table.
 *
 * The cache is what makes model comparison fair: every architecture replaying
 * the same question retrieves against byte-identical query vectors, so any
 * score difference is attributable to the agent, not to embedding jitter.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const { model, dim } = config.embeddings;
  const hashes = texts.map(sha256);

  const cached = await query<{ text_hash: string; vector: number[] }>(
    'SELECT text_hash, vector FROM embedding_cache WHERE model = $1 AND text_hash = ANY($2::text[])',
    [model, hashes],
  );
  const byHash = new Map(cached.map((r) => [r.text_hash, r.vector]));

  const missingIdx = hashes
    .map((h, i) => (byHash.has(h) ? -1 : i))
    .filter((i) => i !== -1);

  if (missingIdx.length) {
    const fresh = await embedRaw(missingIdx.map((i) => texts[i]!));

    if (fresh.length !== missingIdx.length) {
      throw new Error(
        `Embedding provider returned ${fresh.length} vectors for ${missingIdx.length} inputs`,
      );
    }

    for (let k = 0; k < missingIdx.length; k++) {
      const vector = fresh[k]!;
      if (vector.length !== dim) {
        throw new Error(
          `Embedding dimension mismatch: got ${vector.length}, schema expects ${dim}. `
          + 'Update EMBEDDING_DIM and db/migrations/002_vector_schema.sql together, then re-ingest.',
        );
      }
      const hash = hashes[missingIdx[k]!]!;
      byHash.set(hash, vector);
      await query(
        `INSERT INTO embedding_cache (model, text_hash, dim, vector)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (model, text_hash) DO NOTHING`,
        [model, hash, dim, vector],
      );
    }
  }

  return hashes.map((h) => byHash.get(h)!);
}

export async function embedOne(text: string): Promise<number[]> {
  const [vector] = await embed([text]);
  return vector!;
}

export async function embeddingStats() {
  const row = await queryOne<{ count: number; models: string[] }>(
    `SELECT count(*)::int AS count, COALESCE(array_agg(DISTINCT model), '{}') AS models
       FROM embedding_cache`,
  );
  return {
    provider: config.embeddings.provider,
    model: config.embeddings.model,
    dim: config.embeddings.dim,
    cachedVectors: row?.count ?? 0,
    cachedModels: row?.models ?? [],
  };
}
