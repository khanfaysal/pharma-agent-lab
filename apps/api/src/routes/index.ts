import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { runAgent, runComparison, ARCHITECTURES } from '../agent/index.js';
import { config } from '../config.js';
import { query, vectorBackend } from '../db.js';
import { embeddingStats } from '../embeddings/index.js';
import { evaluateArchitectures, evaluateRetrieval, loadCases } from '../eval/runner.js';
import { describeTiers, availableProviders } from '../providers/registry.js';
import { describeTools, executeTool } from '../tools/registry.js';
import { corpusStats, hybridSearch, lexicalSearch, semanticSearch } from '../vector/store.js';

export const router = Router();

/** Wrap an async handler so a rejected promise reaches the error middleware. */
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

const architectureSchema = z.enum(['single', 'multi', 'router-only', 'baseline-no-tools']);
const tierSchema = z.enum(['fast', 'balanced', 'strong']);

/* ------------------------------------------------------------------ *
 * Health & introspection
 * ------------------------------------------------------------------ */

router.get('/health', wrap(async (_req, res) => {
  const [counts] = await query<Record<string, number>>(
    `SELECT (SELECT count(*)::int FROM brand)           AS brands,
            (SELECT count(*)::int FROM generic)         AS generics,
            (SELECT count(*)::int FROM company)         AS companies,
            (SELECT count(*)::int FROM documents)       AS documents,
            (SELECT count(*)::int FROM document_chunks) AS chunks,
            (SELECT count(*)::int FROM agent_runs)      AS runs,
            (SELECT count(*)::int FROM eval_cases)      AS eval_cases`,
  );

  const tiers = describeTiers();

  res.json({
    ok: true,
    database: config.db.database,
    vectorBackend: await vectorBackend(),
    counts,
    embeddings: await embeddingStats(),
    providers: availableProviders(),
    tiers,
    // Surfaced prominently: a comparison run in degraded mode is not a
    // comparison of models, it is a comparison of stubs.
    degraded: tiers.some((t) => t.degraded),
    agentDefaults: config.agent,
  });
}));

router.get('/tools', (_req, res) => {
  res.json({ tools: describeTools(), architectures: ARCHITECTURES });
});

router.get('/corpus', wrap(async (_req, res) => {
  res.json(await corpusStats());
}));

/* ------------------------------------------------------------------ *
 * Direct search (no agent) -- the UI's plain search page, and a way to
 * inspect retrieval without paying for a model call.
 * ------------------------------------------------------------------ */

const searchSchema = z.object({
  q: z.string().min(1),
  mode: z.enum(['semantic', 'lexical', 'hybrid']).default('hybrid'),
  topK: z.coerce.number().int().min(1).max(20).default(6),
  sourceTypes: z.string().optional(),
});

router.get('/search/documents', wrap(async (req, res) => {
  const parsed = searchSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid query', details: parsed.error.flatten() });
    return;
  }
  const { q, mode, topK, sourceTypes } = parsed.data;
  const opts = {
    topK,
    minScore: 0,
    sourceTypes: sourceTypes ? sourceTypes.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
  };

  const search = mode === 'semantic' ? semanticSearch : mode === 'lexical' ? lexicalSearch : hybridSearch;
  const started = Date.now();
  const chunks = await search(q, opts);

  res.json({ query: q, mode, topK, latencyMs: Date.now() - started, results: chunks });
}));

/** Run any SQL tool directly, for debugging tool behaviour without an agent. */
router.post('/search/sql', wrap(async (req, res) => {
  const schema = z.object({
    tool: z.string().min(1),
    args: z.record(z.unknown()).default({}),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
    return;
  }
  res.json(await executeTool(parsed.data.tool, parsed.data.args));
}));

/* ------------------------------------------------------------------ *
 * Agent
 * ------------------------------------------------------------------ */

const chatSchema = z.object({
  question: z.string().min(1).max(2000),
  architecture: architectureSchema.default('single'),
  tier: tierSchema.optional(),
  useModelRouter: z.boolean().default(true),
  maxSteps: z.number().int().min(1).max(12).optional(),
  conversationId: z.string().optional(),
});

router.post('/chat', wrap(async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
    return;
  }
  const result = await runAgent(parsed.data);
  res.status(result.status === 'error' ? 502 : 200).json(result);
}));

const compareSchema = z.object({
  question: z.string().min(1).max(2000),
  architectures: z.array(architectureSchema).min(1).max(4).optional(),
  useModelRouter: z.boolean().default(true),
  parallel: z.boolean().default(false),
});

router.post('/compare', wrap(async (req, res) => {
  const parsed = compareSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
    return;
  }
  res.json(await runComparison(parsed.data));
}));

/* ------------------------------------------------------------------ *
 * Runs
 * ------------------------------------------------------------------ */

router.get('/runs', wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const rows = await query(
    `SELECT id, comparison_id, architecture, strategy_label, question,
            left(answer, 240) AS answer_preview, tools_used, step_count,
            prompt_tokens, output_tokens, cost_usd, latency_ms, status, created_at
       FROM agent_runs
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit],
  );
  res.json({ runs: rows });
}));

router.get('/runs/summary', wrap(async (_req, res) => {
  res.json({ summary: await query('SELECT * FROM v_architecture_summary ORDER BY architecture') });
}));

router.get('/runs/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'invalid id' }); return; }

  const [run] = await query('SELECT * FROM agent_runs WHERE id = $1', [id]);
  if (!run) { res.status(404).json({ error: 'run not found' }); return; }

  const steps = await query('SELECT * FROM agent_steps WHERE run_id = $1 ORDER BY step_index', [id]);
  res.json({ run, steps });
}));

/* ------------------------------------------------------------------ *
 * Evaluation
 * ------------------------------------------------------------------ */

router.get('/eval/cases', wrap(async (req, res) => {
  res.json({ cases: await loadCases(String(req.query.suite ?? 'default')) });
}));

router.post('/eval/retrieval', wrap(async (req, res) => {
  const schema = z.object({
    suite: z.string().default('default'),
    modes: z.array(z.enum(['semantic', 'lexical', 'hybrid'])).optional(),
    topK: z.number().int().min(1).max(20).optional(),
    persist: z.boolean().default(false),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
    return;
  }
  res.json(await evaluateRetrieval(parsed.data));
}));

router.post('/eval/architectures', wrap(async (req, res) => {
  const schema = z.object({
    suite: z.string().default('default'),
    architectures: z.array(architectureSchema).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    persist: z.boolean().default(true),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
    return;
  }
  res.json(await evaluateArchitectures(parsed.data));
}));

router.get('/eval/summary', wrap(async (_req, res) => {
  res.json({ summary: await query('SELECT * FROM v_eval_summary ORDER BY config_label') });
}));

/* ------------------------------------------------------------------ *
 * Browse -- plain catalogue endpoints for the UI's search page
 * ------------------------------------------------------------------ */

router.get('/brands', wrap(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  if (!q) { res.json({ results: [] }); return; }

  const rows = await query(
    `SELECT brand_id, brand_name, company_name, generic_name, form, strength,
            packsize, price_min, is_sponsored
       FROM v_brand_full
      WHERE brand_name ILIKE '%' || $1 || '%'
         OR generic_name ILIKE '%' || $1 || '%'
         OR company_name ILIKE '%' || $1 || '%'
      ORDER BY CASE WHEN lower(brand_name) = lower($1) THEN 0
                    WHEN brand_name ILIKE $1 || '%' THEN 1 ELSE 2 END,
               price_min ASC NULLS LAST
      LIMIT $2`,
    [q, limit],
  );
  res.json({ query: q, results: rows });
}));

router.get('/generics/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'invalid id' }); return; }

  const [generic] = await query('SELECT * FROM v_generic_full WHERE generic_id = $1', [id]);
  if (!generic) { res.status(404).json({ error: 'generic not found' }); return; }

  const brands = await query(
    `SELECT brand_id, brand_name, company_name, form, strength, packsize, price_min
       FROM v_brand_full WHERE generic_id = $1 ORDER BY price_min ASC NULLS LAST LIMIT 100`,
    [id],
  );
  res.json({ generic, brands });
}));
