import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

// numeric/int8 arrive as strings by default because they can exceed IEEE754.
// Every numeric in this schema (prices, counts, costs) is comfortably in range,
// and the API serialises straight to JSON, so parse them here once.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params as never[]);
  return result.rows;
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Run a function inside a transaction, rolling back on throw. */
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Which vector driver this database supports. Resolved once at boot: it cannot
 * change while the process is running, and every retrieval query branches on it.
 */
let cachedBackend: 'pgvector' | 'fallback' | null = null;

export async function vectorBackend(): Promise<'pgvector' | 'fallback'> {
  if (cachedBackend) return cachedBackend;
  const row = await queryOne<{ backend: string }>('SELECT vector_backend() AS backend');
  cachedBackend = row?.backend === 'pgvector' ? 'pgvector' : 'fallback';
  return cachedBackend;
}
