/**
 * Ingest the unstructured corpus.
 *
 *   npm run ingest -w @lab/api                 # db/docs only
 *   npm run ingest -w @lab/api -- --monographs # + top 200 generic monographs
 *   npm run ingest -w @lab/api -- --monographs=500
 *   npm run ingest -w @lab/api -- --force      # re-embed even if unchanged
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { config } from '../config.js';
import { query, vectorBackend } from '../db.js';
import { embeddingStats } from '../embeddings/index.js';
import { closePool, ingestDocsDirectory, ingestGenericMonographs } from '../ingest/pipeline.js';

const here = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = resolve(here, '../../../../db/docs');

function flag(name: string): string | null {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  const eq = hit.indexOf('=');
  return eq === -1 ? '' : hit.slice(eq + 1);
}

async function main() {
  const backend = await vectorBackend();

  console.log('Ingestion');
  console.log(`  vector backend   ${backend}${backend === 'fallback' ? ' (pgvector not installed; exact seq-scan cosine)' : ' (HNSW index)'}`);
  console.log(`  embeddings       ${config.embeddings.provider}:${config.embeddings.model} @ ${config.embeddings.dim}d`);
  console.log(`  docs directory   ${DOCS_DIR}`);
  console.log();

  if (flag('force') !== null) {
    // Clearing content_hash makes every document look changed.
    const cleared = await query('UPDATE documents SET content_hash = $1', ['forced']);
    console.log(`  --force: invalidated hashes for re-embedding\n`, cleared.length ? '' : '');
  }

  console.log('Documents (db/docs):');
  const docs = await ingestDocsDirectory(DOCS_DIR);

  let monographs: Awaited<ReturnType<typeof ingestGenericMonographs>> | null = null;
  const monoFlag = flag('monographs');
  if (monoFlag !== null) {
    const limit = monoFlag ? Number(monoFlag) : 200;
    console.log(`\nGeneric monographs (limit ${limit}):`);
    monographs = await ingestGenericMonographs(Number.isFinite(limit) ? limit : 200);
  }

  const stats = await embeddingStats();

  console.log('\nSummary');
  console.log(`  documents written  ${docs.documents + (monographs?.documents ?? 0)}`);
  console.log(`  documents skipped  ${docs.skipped + (monographs?.skipped ?? 0)} (unchanged)`);
  console.log(`  chunks total       ${docs.chunks + (monographs?.chunks ?? 0)}`);
  console.log(`  vectors cached     ${stats.cachedVectors}`);

  if (stats.provider === 'gemini' && !config.providers.gemini.apiKey) {
    console.log('\n  WARNING: GEMINI_API_KEY is not set, so these are deterministic hash');
    console.log('  embeddings, not semantic ones. Retrieval will only match on shared words.');
    console.log('  Set GEMINI_API_KEY in .env and re-run with --force for real semantics.');
  }

  await closePool();
}

main().catch(async (err) => {
  console.error('\nIngestion failed:', err instanceof Error ? err.message : err);
  await closePool();
  process.exit(1);
});
