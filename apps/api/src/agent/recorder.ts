import { query, queryOne } from '../db.js';
import type { AgentRunResult, StepInput, StepRecorder } from './types.js';

/**
 * Buffers steps in memory and flushes them with the run in one transaction at
 * the end.
 *
 * Buffering rather than writing per-step keeps a chatty agent from turning one
 * question into a dozen round-trips to PostgreSQL, and it means a crashed run
 * leaves no half-written trace.
 */
export class RunRecorder implements StepRecorder {
  readonly steps: Array<StepInput & { stepIndex: number }> = [];
  private totalPromptTokens = 0;
  private totalOutputTokens = 0;
  private totalCost = 0;

  async record(step: StepInput): Promise<void> {
    this.steps.push({ ...step, stepIndex: this.steps.length });
    this.totalPromptTokens += step.usage?.promptTokens ?? 0;
    this.totalOutputTokens += step.usage?.outputTokens ?? 0;
    this.totalCost += step.costUsd ?? 0;
  }

  get usage() {
    return { promptTokens: this.totalPromptTokens, outputTokens: this.totalOutputTokens };
  }

  get costUsd(): number {
    return this.totalCost;
  }
}

export interface PriorTurn { question: string; answer: string }

/**
 * Prior turns of a conversation, oldest first.
 *
 * `conversation_id` used to be written and never read, which made the chat view
 * a lie: every question looked like a follow-up and was answered as though it
 * were the first. Seeding the transcript with the last few exchanges is what
 * makes "what about the syrup form?" resolve against the drug named two turns
 * ago.
 *
 * Capped at the last few turns rather than the whole thread: the transcript is
 * re-sent on every model call inside the loop, so an unbounded history would
 * push out the tool results the answer actually depends on.
 */
export async function loadConversation(
  conversationId: string | undefined | null,
  limit = 4,
): Promise<PriorTurn[]> {
  if (!conversationId) return [];
  try {
    const rows = await query<{ question: string; answer: string | null }>(
      `SELECT question, answer FROM agent_runs
         WHERE conversation_id = $1 AND status = 'ok' AND answer IS NOT NULL AND answer <> ''
         ORDER BY created_at DESC
         LIMIT $2`,
      [conversationId, limit],
    );
    return rows.reverse().map((r) => ({ question: r.question, answer: r.answer! }));
  } catch (err) {
    // History is an enhancement. If the lookup fails the question is still
    // answerable on its own, so degrade rather than fail the run.
    console.warn('[agent] could not load conversation history:', (err as Error).message);
    return [];
  }
}

/** Persist a completed run plus its steps. Returns the run id, or null if the write failed. */
export async function persistRun(result: AgentRunResult): Promise<number | null> {
  try {
    const run = await queryOne<{ id: number }>(
      `INSERT INTO agent_runs
         (comparison_id, conversation_id, architecture, strategy_label, question, answer,
          tools_used, citations, step_count, prompt_tokens, output_tokens, cost_usd,
          latency_ms, status, error, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
       RETURNING id`,
      [
        result.comparisonId ?? null,
        result.conversationId ?? null,
        result.architecture,
        result.strategyLabel,
        result.question,
        result.answer,
        result.toolsUsed,
        JSON.stringify(result.citations),
        result.stepCount,
        result.usage.promptTokens,
        result.usage.outputTokens,
        result.costUsd,
        result.latencyMs,
        result.status,
        result.error ?? null,
        JSON.stringify({
          route: result.route,
          routeReasoning: result.routeReasoning,
          routeDecidedBy: result.routeDecidedBy,
          contextTokens: result.contextTokens,
          compactions: result.compactions,
          degraded: result.degraded,
        }),
      ],
    );

    if (!run) return null;

    for (const step of result.steps) {
      await query(
        `INSERT INTO agent_steps
           (run_id, step_index, kind, agent_role, provider, model, tool_name,
            input, output, prompt_tokens, output_tokens, cost_usd, latency_ms, error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14)`,
        [
          run.id,
          step.stepIndex,
          step.kind,
          step.agentRole ?? null,
          step.provider ?? null,
          step.model ?? null,
          step.toolName ?? null,
          JSON.stringify(step.input ?? null),
          JSON.stringify(truncateForStorage(step.output)),
          step.usage?.promptTokens ?? 0,
          step.usage?.outputTokens ?? 0,
          step.costUsd ?? 0,
          step.latencyMs ?? 0,
          step.error ?? null,
        ],
      );
    }

    return run.id;
  } catch (err) {
    // Losing the trace must never lose the answer.
    console.error('[recorder] failed to persist run:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Cap any single step payload so one huge tool result cannot bloat the table. */
function truncateForStorage(value: unknown, limit = 20_000): unknown {
  if (value === null || value === undefined) return null;
  const json = JSON.stringify(value);
  if (json.length <= limit) return value;
  return { truncated: true, originalLength: json.length, preview: json.slice(0, limit) };
}
