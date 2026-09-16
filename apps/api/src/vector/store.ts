import { config } from '../config.js';
import { query, vectorBackend } from '../db.js';
import { embedOne } from '../embeddings/index.js';

export interface RetrievedChunk {
  chunkId: number;
  documentId: number;
  slug: string;
  title: string;
  sourceType: string;
  heading: string | null;
  content: string;
  uri: string | null;
  /** Cosine similarity in [0,1] for vector hits; RRF score for hybrid hits. */
  score: number;
  /** Where the hit came from -- useful when debugging hybrid fusion. */
  matchedBy: 'vector' | 'lexical' | 'hybrid';
}

export interface SearchOptions {
  topK?: number;
  minScore?: number;
  /** Restrict to e.g. ['policy','terms'] to answer a legal question. */
  sourceTypes?: string[];
}

/**
 * The two backends differ only in how a vector is bound and how distance is
 * computed, so both queries are generated from one shape.
 *
 * pgvector: `embedding <=> $1` is cosine DISTANCE, so similarity is 1 - d.
 * fallback: array_cosine_similarity() returns similarity directly.
 */
async function vectorSql(vec: number[]): Promise<{ scoreExpr: string; param: unknown }> {
  const backend = await vectorBackend();
  return backend === 'pgvector'
    ? { scoreExpr: '1 - (c.embedding <=> $1::vector)', param: JSON.stringify(vec) }
    : { scoreExpr: 'array_cosine_similarity(c.embedding, $1::float8[])', param: vec };
}

interface ChunkRow {
  chunk_id: number;
  document_id: number;
  slug: string;
  title: string;
  source_type: string;
  heading: string | null;
  content: string;
  uri: string | null;
  score: number;
}

const SELECT_CHUNK = `
  c.id            AS chunk_id,
  c.document_id,
  d.slug,
  d.title,
  c.source_type,
  c.heading,
  c.content,
  d.uri`;

function toChunk(row: ChunkRow, matchedBy: RetrievedChunk['matchedBy']): RetrievedChunk {
  return {
    chunkId: row.chunk_id,
    documentId: row.document_id,
    slug: row.slug,
    title: row.title,
    sourceType: row.source_type,
    heading: row.heading,
    content: row.content,
    uri: row.uri,
    score: Number(row.score),
    matchedBy,
  };
}

/** Pure vector search. */
export async function semanticSearch(
  text: string,
  opts: SearchOptions = {},
): Promise<RetrievedChunk[]> {
  const topK = opts.topK ?? config.agent.ragTopK;
  const minScore = opts.minScore ?? config.agent.ragMinScore;

  const vec = await embedOne(text);
  const { scoreExpr, param } = await vectorSql(vec);

  const params: unknown[] = [param, minScore, topK];
  let filter = '';
  if (opts.sourceTypes?.length) {
    params.push(opts.sourceTypes);
    filter = `AND c.source_type = ANY($${params.length}::text[])`;
  }

  const rows = await query<ChunkRow>(
    `SELECT ${SELECT_CHUNK}, ${scoreExpr} AS score
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
      WHERE c.embedding IS NOT NULL
        AND ${scoreExpr} >= $2
        ${filter}
      ORDER BY score DESC
      LIMIT $3`,
    params,
  );

  return rows.map((r) => toChunk(r, 'vector'));
}

/**
 * Lexical-only search, via the generated tsvector column.
 *
 * Note the OR rewrite. `websearch_to_tsquery('english', 'how long do you keep
 * my search history')` yields `'long' & 'keep' & 'search' & 'histori'` -- every
 * term ANDed -- and almost no chunk contains all of them, so the query matches
 * nothing. That is correct behaviour for a search box, and wrong for the
 * lexical arm of a retriever fed whole questions.
 *
 * Swapping `&` for `|` gives OR semantics and lets ts_rank do the work it is
 * designed for: a chunk containing three of the four terms outranks one
 * containing one. Measured on this corpus the rewrite takes lexical recall@6
 * from 6% to a useful figure, which in turn is what makes hybrid fusion worth
 * running at all.
 */
const OR_TSQUERY = `replace(websearch_to_tsquery('english', $1)::text, '&', '|')::tsquery`;

export async function lexicalSearch(
  text: string,
  opts: SearchOptions = {},
): Promise<RetrievedChunk[]> {
  const topK = opts.topK ?? config.agent.ragTopK;

  const params: unknown[] = [text, topK];
  let filter = '';
  if (opts.sourceTypes?.length) {
    params.push(opts.sourceTypes);
    filter = `AND c.source_type = ANY($${params.length}::text[])`;
  }

  const rows = await query<ChunkRow>(
    `WITH q AS (SELECT ${OR_TSQUERY} AS tsq)
     SELECT ${SELECT_CHUNK}, ts_rank(c.tsv, q.tsq) AS score
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
       CROSS JOIN q
      WHERE c.tsv @@ q.tsq
        ${filter}
      ORDER BY score DESC
      LIMIT $2`,
    params,
  );

  return rows.map((r) => toChunk(r, 'lexical'));
}

/**
 * Hybrid search with Reciprocal Rank Fusion.
 *
 * RRF rather than weighted score blending because cosine similarity (0..1,
 * clustered high) and ts_rank (unbounded, clustered near 0) are not on
 * comparable scales -- normalising them requires per-corpus calibration that
 * goes stale, while RRF only needs the two orderings.
 *
 *   score(d) = sum over lists of 1 / (k + rank(d))
 *
 * k=60 is the value from the original Cormack et al. result and is the usual
 * default; it damps the influence of the top rank enough that one list cannot
 * dominate the fusion.
 */
export async function hybridSearch(
  text: string,
  opts: SearchOptions = {},
): Promise<RetrievedChunk[]> {
  const topK = opts.topK ?? config.agent.ragTopK;
  const K = 60;

  // Over-fetch each arm: a document ranked 8th in both lists can beat one
  // ranked 1st in a single list, and it is invisible if we only take topK.
  const pool = Math.max(topK * 3, 20);
  const [vector, lexical] = await Promise.all([
    semanticSearch(text, { ...opts, topK: pool, minScore: 0 }),
    lexicalSearch(text, { ...opts, topK: pool }),
  ]);

  const fused = new Map<number, RetrievedChunk & { rrf: number; inBoth: boolean }>();

  const fold = (list: RetrievedChunk[]) => {
    list.forEach((chunk, i) => {
      const contribution = 1 / (K + i + 1);
      const existing = fused.get(chunk.chunkId);
      if (existing) {
        existing.rrf += contribution;
        existing.inBoth = true;
      } else {
        fused.set(chunk.chunkId, { ...chunk, rrf: contribution, inBoth: false });
      }
    });
  };
  fold(vector);
  fold(lexical);

  return [...fused.values()]
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, topK)
    .map(({ rrf, inBoth, ...chunk }) => ({
      ...chunk,
      score: rrf,
      matchedBy: inBoth ? 'hybrid' : chunk.matchedBy,
    }));
}

export async function corpusStats() {
  const [docs] = await query<{ documents: number; chunks: number; embedded: number }>(
    `SELECT
       (SELECT count(*)::int FROM documents)                                AS documents,
       (SELECT count(*)::int FROM document_chunks)                          AS chunks,
       (SELECT count(*)::int FROM document_chunks WHERE embedding IS NOT NULL) AS embedded`,
  );
  const bySource = await query<{ source_type: string; chunks: number }>(
    `SELECT source_type, count(*)::int AS chunks
       FROM document_chunks GROUP BY source_type ORDER BY source_type`,
  );
  return {
    backend: await vectorBackend(),
    ...(docs ?? { documents: 0, chunks: 0, embedded: 0 }),
    bySource,
  };
}
