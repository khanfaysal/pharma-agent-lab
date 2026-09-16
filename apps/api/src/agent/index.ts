import { randomUUID } from 'node:crypto';
import { runBaseline, runRouterOnly } from './baseline.js';
import { runMultiModel } from './multi.js';
import { persistRun, RunRecorder } from './recorder.js';
import { runSingleModel, type LoopOutcome } from './single.js';
import type { AgentRunRequest, AgentRunResult, Architecture } from './types.js';

export const ARCHITECTURES: Architecture[] = ['single', 'multi', 'router-only', 'baseline-no-tools'];

const RUNNERS: Record<Architecture, (req: AgentRunRequest, rec: RunRecorder) => Promise<LoopOutcome>> = {
  single: runSingleModel,
  multi: runMultiModel,
  'router-only': runRouterOnly,
  'baseline-no-tools': runBaseline,
};

const DEFAULT_LABEL: Record<Architecture, string> = {
  single: 'single-model (solo tool loop)',
  multi: 'multi-model (router + planner + executor + synthesizer)',
  'router-only': 'router only (retrieval, no generation)',
  'baseline-no-tools': 'baseline (no tools, no retrieval)',
};

/**
 * Run one agent architecture over one question, and persist the trace.
 *
 * Every arm goes through this function, so the timing boundary, the token
 * accounting and the run record are identical across arms. An error is caught
 * and returned as a failed result rather than thrown: in a comparison, one arm
 * failing must not discard the arms that succeeded.
 */
export async function runAgent(req: AgentRunRequest): Promise<AgentRunResult> {
  const started = Date.now();
  const recorder = new RunRecorder();
  const architecture = req.architecture;
  const strategyLabel = req.strategyLabel ?? DEFAULT_LABEL[architecture];

  const base = {
    architecture,
    strategyLabel,
    question: req.question,
    comparisonId: req.comparisonId ?? null,
    conversationId: req.conversationId ?? null,
  };

  try {
    const outcome = await RUNNERS[architecture](req, recorder);

    const result: AgentRunResult = {
      ...base,
      runId: null,
      answer: outcome.answer,
      route: outcome.routing.route,
      routeReasoning: outcome.routing.reasoning,
      routeDecidedBy: outcome.routing.decidedBy,
      toolsUsed: outcome.context.toolNames(),
      gathered: outcome.context.gathered,
      citations: outcome.context.citations(),
      steps: recorder.steps,
      usage: recorder.usage,
      costUsd: recorder.costUsd,
      latencyMs: Date.now() - started,
      stepCount: outcome.steps,
      contextTokens: outcome.context.estimatedTokens(),
      compactions: outcome.context.compactionCount(),
      status: outcome.status,
      degraded: outcome.model.degraded,
    };

    result.runId = await persistRun(result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[agent:${architecture}] run failed:`, message);

    const failed: AgentRunResult = {
      ...base,
      runId: null,
      answer: '',
      route: 'none',
      routeReasoning: 'run failed before routing completed',
      routeDecidedBy: 'none',
      toolsUsed: [],
      gathered: [],
      citations: [],
      steps: recorder.steps,
      usage: recorder.usage,
      costUsd: recorder.costUsd,
      latencyMs: Date.now() - started,
      stepCount: recorder.steps.length,
      contextTokens: 0,
      compactions: 0,
      status: 'error',
      degraded: false,
      error: message,
    };

    failed.runId = await persistRun(failed);
    return failed;
  }
}

export interface ComparisonRequest {
  question: string;
  architectures?: Architecture[];
  useModelRouter?: boolean;
  /** Run arms concurrently. Off by default: parallel calls trip free-tier rate limits. */
  parallel?: boolean;
}

export interface ComparisonResult {
  comparisonId: string;
  question: string;
  runs: AgentRunResult[];
  /** Cheapest / fastest / most-cited arm, for the UI's summary row. */
  winners: {
    cheapest: string | null;
    fastest: string | null;
    mostCitations: string | null;
    fewestSteps: string | null;
  };
}

/**
 * Run several architectures over the same question and return them side by side.
 *
 * Sequential by default. Running four arms concurrently against a free-tier key
 * is the fastest way to get 429s, and a rate-limited arm produces a latency
 * number that measures the rate limiter rather than the architecture.
 */
export async function runComparison(req: ComparisonRequest): Promise<ComparisonResult> {
  const comparisonId = randomUUID();
  const architectures = req.architectures?.length ? req.architectures : (['single', 'multi'] as Architecture[]);

  const makeReq = (architecture: Architecture): AgentRunRequest => ({
    question: req.question,
    architecture,
    comparisonId,
    useModelRouter: req.useModelRouter ?? true,
  });

  const runs: AgentRunResult[] = req.parallel
    ? await Promise.all(architectures.map((a) => runAgent(makeReq(a))))
    : await (async () => {
        const out: AgentRunResult[] = [];
        for (const a of architectures) out.push(await runAgent(makeReq(a)));
        return out;
      })();

  const ok = runs.filter((r) => r.status !== 'error');
  const best = <T>(pick: (r: AgentRunResult) => number, better: (a: number, b: number) => boolean) => {
    let winner: AgentRunResult | null = null;
    for (const run of ok) {
      if (!winner || better(pick(run), pick(winner))) winner = run;
    }
    return winner?.strategyLabel ?? null;
  };

  return {
    comparisonId,
    question: req.question,
    runs,
    winners: {
      cheapest: best((r) => r.costUsd, (a, b) => a < b),
      fastest: best((r) => r.latencyMs, (a, b) => a < b),
      mostCitations: best((r) => r.citations.length, (a, b) => a > b),
      fewestSteps: best((r) => r.stepCount, (a, b) => a < b),
    },
  };
}
