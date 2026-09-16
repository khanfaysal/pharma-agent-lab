#!/usr/bin/env node
/**
 * One-command database setup.
 *
 *   node scripts/db-setup.mjs           # create db if absent, apply migrations, load seed
 *   node scripts/db-setup.mjs --drop    # drop and recreate first
 *   node scripts/db-setup.mjs --no-seed # schema only
 *
 * Shells out to psql rather than driving `pg` from Node, because the seed file
 * is a 9 MB script of multi-row INSERTs and psql streams it in about a second.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');

/** Read .env without adding a dependency to the root workspace. */
function loadEnv() {
  const path = join(ROOT, '.env');
  if (!existsSync(path)) return {};
  const parsed = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) parsed[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return parsed;
}

// Real environment variables win over .env, so CI can override without editing files.
const env = { ...loadEnv(), ...process.env };

const PGHOST = env.PGHOST || '127.0.0.1';
const PGPORT = env.PGPORT || '5432';
const PGUSER = env.PGUSER || 'postgres';
const PGPASSWORD = env.PGPASSWORD || 'postgres';
const PGDATABASE = env.PGDATABASE || 'pharma_agent_lab';

/** Locate psql: PSQL_BIN, then PATH, then the usual Windows install roots. */
function findPsql() {
  if (env.PSQL_BIN && existsSync(env.PSQL_BIN)) return env.PSQL_BIN;

  const onPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['psql'], {
    encoding: 'utf8',
  });
  if (onPath.status === 0) {
    const first = onPath.stdout.split(/\r?\n/).find(Boolean);
    if (first && existsSync(first.trim())) return first.trim();
  }

  const candidates = [
    'D:\\laragon\\bin\\postgresql\\postgresql\\bin\\psql.exe',
    'C:\\laragon\\bin\\postgresql\\postgresql\\bin\\psql.exe',
  ];
  for (let v = 18; v >= 13; v--) {
    candidates.push(`C:\\Program Files\\PostgreSQL\\${v}\\bin\\psql.exe`);
  }
  return candidates.find(existsSync) ?? null;
}

const PSQL = findPsql();
if (!PSQL) {
  console.error('Could not find psql. Set PSQL_BIN in .env to its full path.');
  process.exit(1);
}

function psql(database, args, { quiet = false } = {}) {
  const result = spawnSync(
    PSQL,
    ['-h', PGHOST, '-p', String(PGPORT), '-U', PGUSER, '-d', database,
     '-v', 'ON_ERROR_STOP=1', ...(quiet ? ['-q'] : []), ...args],
    { env: { ...process.env, PGPASSWORD }, encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit' },
  );
  if (result.status !== 0) {
    if (quiet && result.stderr) console.error(result.stderr);
    throw new Error(`psql exited ${result.status}`);
  }
  return result.stdout ?? '';
}

const has = (flag) => process.argv.includes(`--${flag}`);

function main() {
  console.log(`psql      ${PSQL}`);
  console.log(`target    ${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE}\n`);

  if (has('drop')) {
    console.log(`Dropping ${PGDATABASE}...`);
    psql('postgres', ['-c', `DROP DATABASE IF EXISTS ${PGDATABASE}`], { quiet: true });
  }

  const exists = psql('postgres', [
    '-At', '-c', `SELECT 1 FROM pg_database WHERE datname = '${PGDATABASE}'`,
  ], { quiet: true }).trim();

  if (!exists) {
    console.log(`Creating ${PGDATABASE}...`);
    psql('postgres', ['-c', `CREATE DATABASE ${PGDATABASE}`], { quiet: true });
  } else {
    console.log(`${PGDATABASE} already exists.`);
  }

  const migrationsDir = join(ROOT, 'db', 'migrations');
  const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  console.log(`\nApplying ${migrations.length} migration(s):`);
  for (const file of migrations) {
    process.stdout.write(`  ${file} ... `);
    try {
      psql(PGDATABASE, ['-f', join(migrationsDir, file)], { quiet: true });
      console.log('ok');
    } catch (err) {
      // Re-running migrations on an existing database is expected to fail on
      // "already exists"; say so rather than looking like a real failure.
      console.log('failed');
      console.error(`\n  ${file} could not be applied. If the database already has this schema,`);
      console.error('  re-run with --drop to rebuild from scratch.\n');
      throw err;
    }
  }

  if (!has('no-seed')) {
    const seed = join(ROOT, 'db', 'seed', 'pharma_data.sql');
    if (!existsSync(seed)) {
      console.log('\nNo db/seed/pharma_data.sql found. Generate it first:');
      console.log('  node scripts/mysql2pg.mjs <path-to>/pharmaceutical_data_full.sql db/seed/pharma_data.sql');
    } else {
      console.log('\nLoading seed data (this takes a second)...');
      psql(PGDATABASE, ['-f', seed], { quiet: true });

      const counts = psql(PGDATABASE, ['-At', '-F', ' ', '-c',
        `SELECT 'brands', count(*) FROM brand
         UNION ALL SELECT 'generics', count(*) FROM generic
         UNION ALL SELECT 'companies', count(*) FROM company
         UNION ALL SELECT 'herbal brands', count(*) FROM herbal_brand`,
      ], { quiet: true });
      console.log(counts.trim().split(/\r?\n/).map((l) => `  ${l}`).join('\n'));
    }
  }

  const backend = psql(PGDATABASE, ['-At', '-c', 'SELECT vector_backend()'], { quiet: true }).trim();
  console.log(`\nVector backend: ${backend}`);
  if (backend === 'fallback') {
    console.log('  pgvector is not installed. Retrieval uses an exact float8[] cosine scan,');
    console.log('  which is correct but unindexed. Install pgvector and re-run with --drop to switch.');
  }

  console.log('\nNext:');
  console.log('  npm run ingest -w @lab/api          # chunk + embed the documents');
  console.log('  npm run seed:eval -w @lab/api       # load the gold evaluation set');
  console.log('  npm run dev                         # start API + web');
}

try {
  main();
} catch (err) {
  console.error(`\nSetup failed: ${err.message}`);
  process.exit(1);
}
