import type { Usage } from '../providers/types.js';
import type { Citation } from '../tools/types.js';
import type { GatheredResult } from './context.js';

export type Architecture = 'single' | 'multi' | 'router-only' | 'baseline-no-tools';

export interface StepInput {
  kind: 'route' | 'plan' | 'llm' | 'tool' | 'synthesize' | 'critique';
  agentRole?: string;
  provider?: string;
  model?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  usage?: Usage;
  costUsd?: number;
  latencyMs?: number;
  error?: string;
}

/**
 * Collects the per-step trace for one agent run.
 *
 * Every architecture writes through the same recorder, which is what makes the
 * arms comparable: token counts, cost and latency are accumulated identically
 * whether one model did the work or three did.
 */
export interface StepRecorder {
  record(step: StepInput): Promise<void>;
}

export interface AgentRunRequest {
  question: string;
  architecture: Architecture;
  /** Overrides the router's tier choice when set. */
  tier?: 'fast' | 'balanced' | 'strong';
  /** Skip the LLM router and use the keyword heuristic. */
  useModelRouter?: boolean;
  maxSteps?: number;
  conversationId?: string;
  comparisonId?: string;
  /** Label shown in the comparison table; defaults to a generated one. */
  strategyLabel?: string;
}

export interface AgentRunResult {
  runId: number | null;
  comparisonId?: string | null;
  conversationId?: string | null;
  architecture: Architecture;
  strategyLabel: string;
  question: string;
  answer: string;
  route: string;
  routeReasoning: string;
  routeDecidedBy: string;
  toolsUsed: string[];
  gathered: GatheredResult[];
  citations: Citation[];
  steps: Array<StepInput & { stepIndex: number }>;
  usage: Usage;
  costUsd: number;
  latencyMs: number;
  stepCount: number;
  contextTokens: number;
  compactions: number;
  status: 'ok' | 'error' | 'max_steps';
  degraded: boolean;
  error?: string;
}
