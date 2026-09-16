import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config.js';
import { pool, vectorBackend } from './db.js';
import { describeTiers } from './providers/registry.js';
import { router } from './routes/index.js';

const app = express();

app.use(cors({ origin: [config.server.webOrigin], credentials: true }));
app.use(express.json({ limit: '1mb' }));

// Request log. Agent calls take seconds, so knowing which one is in flight
// matters more here than in a typical CRUD service.
app.use((req, _res, next) => {
  if (req.path !== '/api/health') console.log(`${req.method} ${req.path}`);
  next();
});

app.use('/api', router);

app.use((_req, res) => {
  res.status(404).json({ error: 'not found' });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[api] unhandled error:', err.message);
  res.status(500).json({ error: err.message });
});

const server = app.listen(config.server.port, async () => {
  const backend = await vectorBackend().catch(() => 'unreachable');
  const tiers = describeTiers();

  console.log(`\n  pharma-agent-lab API  http://localhost:${config.server.port}/api`);
  console.log(`  database              ${config.db.database}@${config.db.host}:${config.db.port}`);
  console.log(`  vector backend        ${backend}`);
  console.log(`  embeddings            ${config.embeddings.provider}:${config.embeddings.model} (${config.embeddings.dim}d)`);
  for (const t of tiers) {
    console.log(`  tier ${t.tier.padEnd(9)}        ${t.effective}${t.degraded ? '   <-- DEGRADED: no key, using mock' : ''}`);
  }
  if (tiers.some((t) => t.degraded)) {
    console.log('\n  Set an API key in .env to run against real models.');
  }
  console.log();
});

async function shutdown(signal: string) {
  console.log(`\n${signal} received, shutting down.`);
  server.close();
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
