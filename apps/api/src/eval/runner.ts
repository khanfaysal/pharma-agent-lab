import { config } from '../config.js';
import { query } from '../db.js';
import { runAgent } from '../agent/index.js';
import type { Architecture } from '../agent/types.js';
import { hybridSearch, lexicalSearch, semanticSearch } from '../vector/store.js';
import { answerContains, mean, scoreRetrieval } from './metrics.js';

export interface EvalCase {
  id: number;
  suite: string;
  question: string;
  expected_route: string | null;
  relevant_refs: string[];
  expected_contains: string[];
  notes: string | null;
}

export async function loadCases(suite = 'default'): Promise<EvalCase[]> {
  return query<EvalCase>(
    'SELECT * FROM eval_cases WHERE suite = $1 ORDER BY id',
    [suite],
  );
}

/* ================================================================== *
 * Retrieval-only evaluation
 *
 * No LLM in the loop at all. This is the cheap, fast, deterministic layer:
 * run it on every change to chunking, embeddings, or fusion, and it tells you
 * whether retrieval improved without spending a token on generation.
 * ================================================================== */

export type RetrievalMode = 'semantic' | 'lexical' | 'hybrid';

export async function evaluateRetrieval(opts: {
  suite?: string;
  modes?: RetrievalMode[];
  topK?: number;
  persist?: boolean;
}) {
  const cases = await loadCases(opts.suite ?? 'default');
  const modes = opts.modes ?? (['semantic', 'lexical', 'hybrid'] as RetrievalMode[]);
  const k = opts.topK ?? config.agent.ragTopK;

  // Only document-backed cases are scoreable here; SQL cases have no chunks.
  const ragCases = cases.filter((c) => c.relevant_refs.some((r) => !r.includes(':')));

  const results = [];

  for (const mode of modes) {
    const perCase = [];

    for (const c of ragCases) {
      const started = Date.now();
      const search = mode === 'semantic' ? semanticSearch
                   : mode === 'lexical' ? lexicalSearch
                   : hybridSearch;

      // minScore 0 so the score reflects ranking quality, not the production
      // cutoff -- otherwise a tuning change to the floor looks like a
      // retrieval regression.
      const chunks = await search(c.question, { topK: k, minScore: 0 });

      // Several chunks of one document collapse to that document's slug: the
      // gold set names documents, and crediting a system three times for
      // retrieving three chunks of the same page would inflate precision.
      const retrieved = [...new Set(chunks.map((ch) => ch.slug))];
      const relevant = c.relevant_refs.filter((r) => !r.includes(':'));
      const scores = scoreRetrieval(retrieved, relevant, k);

      perCase.push({
        caseId: c.id,
        question: c.question,
        retrieved,
        relevant,
        ...scores,
        latencyMs: Date.now() - started,
      });

      if (opts.persist) {
        await query(
          `INSERT INTO eval_results
             (case_id, config_label, retrieved_refs, recall_at_k, precision_at_k, mrr, ndcg, latency_ms, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
          [
            c.id, `retrieval:${mode}@k${k}`, retrieved,
            scores.recallAtK, scores.precisionAtK, scores.mrr, scores.ndcg,
            Date.now() - started,
            JSON.stringify({ mode, topK: k, embeddingModel: config.embeddings.model }),
          ],
        );
      }
    }

    results.push({
      mode,
      topK: k,
      cases: perCase.length,
      avgRecall: mean(perCase.map((r) => r.recallAtK)),
      avgPrecision: mean(perCase.map((r) => r.precisionAtK)),
      avgMrr: mean(perCase.map((r) => r.mrr)),
      avgNdcg: mean(perCase.map((r) => r.ndcg)),
      avgLatencyMs: mean(perCase.map((r) => r.latencyMs)),
      perCase,
    });
  }

  return { suite: opts.suite ?? 'default', topK: k, results };
}

/* ================================================================== *
 * End-to-end architecture evaluation
 * ================================================================== */

export async function evaluateArchitectures(opts: {
  suite?: string;
  architectures?: Architecture[];
  persist?: boolean;
  limit?: number;
}) {
  const all = await loadCases(opts.suite ?? 'default');
  const cases = opts.limit ? all.slice(0, opts.limit) : all;
  const architectures = opts.architectures ?? (['single', 'multi'] as Architecture[]);

  const summaries = [];

  for (const architecture of architectures) {
    const perCase = [];

    for (const c of cases) {
      const run = await runAgent({ question: c.question, architecture });

      // Normalise the agent's citations into the same ref vocabulary the gold
      // set uses, so a SQL citation and a doc citation are both comparable.
      const retrieved = [...new Set(run.citations.map((cit) => cit.ref))];
      const relevant = c.relevant_refs;
      const answer = answerContains(run.answer, c.expected_contains);
      const routeCorrect = c.expected_route ? run.route === c.expected_route : null;

      // A case with no gold refs is not a retrieval case. Scoring it anyway
      // would hand every arm a free 1.0 (recallAtK returns 1 for an empty gold
      // set) and flatter the no-tools baseline into looking like a retriever.
      // Score it as null and exclude it from the averages below.
      const scores = relevant.length
        ? scoreRetrieval(retrieved, relevant, config.agent.ragTopK)
        : { recallAtK: null, precisionAtK: null, mrr: null, ndcg: null };

      perCase.push({
        caseId: c.id,
        question: c.question,
        expectedRoute: c.expected_route,
        actualRoute: run.route,
        routeCorrect,
        answerMatched: answer.matched,
        answerMisses: answer.misses,
        retrievalScored: relevant.length > 0,
        ...scores,
        latencyMs: run.latencyMs,
        costUsd: run.costUsd,
        steps: run.stepCount,
        status: run.status,
        degraded: run.degraded,
        answer: run.answer.slice(0, 600),
      });

      if (opts.persist) {
        await query(
          `INSERT INTO eval_results
             (case_id, run_id, config_label, retrieved_refs, actual_route, route_correct,
              recall_at_k, precision_at_k, mrr, ndcg, answer_match, latency_ms, cost_usd, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
          [
            c.id, run.runId, `agent:${architecture}`, retrieved,
            run.route, routeCorrect,
            scores.recallAtK, scores.precisionAtK, scores.mrr, scores.ndcg,
            answer.matched, run.latencyMs, run.costUsd,
            JSON.stringify({ steps: run.stepCount, degraded: run.degraded, misses: answer.misses }),
          ],
        );
      }
    }

    const routeScored = perCase.filter((r) => r.routeCorrect !== null);
    const answerScored = perCase.filter((r) => r.answerMisses.length > 0 || r.answerMatched);
    const retrievalScored = perCase.filter((r) => r.retrievalScored);

    summaries.push({
      architecture,
      cases: perCase.length,
      routeAccuracy: routeScored.length
        ? routeScored.filter((r) => r.routeCorrect).length / routeScored.length
        : null,
      answerAccuracy: answerScored.length
        ? answerScored.filter((r) => r.answerMatched).length / answerScored.length
        : null,
      retrievalCases: retrievalScored.length,
      avgRecall: mean(retrievalScored.map((r) => r.recallAtK)),
      avgMrr: mean(retrievalScored.map((r) => r.mrr)),
      avgNdcg: mean(retrievalScored.map((r) => r.ndcg)),
      avgLatencyMs: mean(perCase.map((r) => r.latencyMs)),
      totalCostUsd: perCase.reduce((s, r) => s + r.costUsd, 0),
      avgSteps: mean(perCase.map((r) => r.steps)),
      failures: perCase.filter((r) => r.status === 'error').length,
      degraded: perCase.some((r) => r.degraded),
      perCase,
    });
  }

  return { suite: opts.suite ?? 'default', cases: cases.length, summaries };
}
