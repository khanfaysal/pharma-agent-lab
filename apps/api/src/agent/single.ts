import { config } from '../config.js';
import { callModel, resolveTier, type ResolvedModel } from '../providers/registry.js';
import { executeTool, schemasFor } from '../tools/registry.js';
import { AgentContext } from './context.js';
import { SYSTEM_ANSWERER } from './prompts.js';
import { loadConversation } from './recorder.js';
import { routeQuestion, type RoutingDecision } from './router.js';
import type { AgentRunRequest, StepRecorder } from './types.js';

export interface LoopOutcome {
  answer: string;
  context: AgentContext;
  routing: RoutingDecision;
  model: ResolvedModel;
  status: 'ok' | 'max_steps';
  steps: number;
}

/**
 * Single-model architecture.
 *
 * One model does everything: it sees the question and the tool schemas, decides
 * what to call, reads the results, and writes the answer. The router still runs
 * (to narrow the tool surface), but the same tier can be forced to isolate the
 * router's contribution.
 *
 * This is the baseline every other architecture is measured against. Its
 * characteristic cost profile is a growing prompt: every step resends the whole
 * transcript including all prior tool output.
 */
export async function runSingleModel(
  req: AgentRunRequest,
  recorder: StepRecorder,
): Promise<LoopOutcome> {
  const history = await loadConversation(req.conversationId);

  const routing = await routeQuestion(req.question, recorder, {
    useModel: req.useModelRouter ?? true,
    history,
  });

  const tier = req.tier ?? routing.tier;
  const model = resolveTier(tier);
  const maxSteps = req.maxSteps ?? config.agent.maxSteps;

  const ctx = new AgentContext(SYSTEM_ANSWERER, req.question, history);
  const tools = schemasFor(routing.toolGroup);

  for (let step = 0; step < maxSteps; step++) {
    const res = await callModel(model, {
      messages: ctx.forModel(),
      tools,
      // Force a tool call on the first step only. Without this, a model asked
      // a factual question will sometimes answer from prior knowledge -- which
      // is exactly the failure this whole architecture exists to prevent.
      toolChoice: step === 0 && routing.route !== 'none' ? 'required' : 'auto',
      temperature: 0.1,
      maxTokens: 2048,
    });

    await recorder.record({
      kind: 'llm',
      agentRole: 'solo',
      provider: model.provider,
      model: model.model,
      input: { step, toolsOffered: tools.length, contextTokens: ctx.estimatedTokens() },
      output: { text: res.text.slice(0, 2000), toolCalls: res.toolCalls.map((c) => c.name) },
      usage: res.usage,
      costUsd: res.costUsd,
      latencyMs: res.latencyMs,
    });

    if (res.toolCalls.length === 0) {
      return { answer: res.text.trim(), context: ctx, routing, model, status: 'ok', steps: step + 1 };
    }

    ctx.pushAssistant(res.text, res.toolCalls);

    // Parallel calls in one assistant turn are executed concurrently and all
    // results returned together -- splitting them teaches the model to stop
    // batching, which costs an extra round-trip on every later question.
    const executed = await Promise.all(
      res.toolCalls.map((call) => executeTool(call.name, call.arguments)),
    );

    for (let i = 0; i < executed.length; i++) {
      const call = res.toolCalls[i]!;
      const exec = executed[i]!;
      ctx.pushToolResult(call.id, call.name, call.arguments, exec.result);
      await recorder.record({
        kind: 'tool',
        agentRole: 'solo',
        toolName: exec.name,
        input: exec.args,
        output: { summary: exec.result.summary, empty: exec.result.empty, data: exec.result.data },
        latencyMs: exec.latencyMs,
        error: exec.error,
      });
    }
  }

  // Budget exhausted: ask once more with tools withheld, so the user gets the
  // best answer available from what was already gathered rather than nothing.
  const final = await callModel(model, {
    messages: [
      ...ctx.forModel(),
      {
        role: 'user',
        content: 'You have reached the tool-call limit. Answer now from the results you already have, '
          + 'and state explicitly what you could not determine.',
      },
    ],
    temperature: 0.1,
    maxTokens: 1500,
  });

  await recorder.record({
    kind: 'synthesize',
    agentRole: 'solo',
    provider: model.provider,
    model: model.model,
    input: { reason: 'max_steps' },
    output: { text: final.text.slice(0, 2000) },
    usage: final.usage,
    costUsd: final.costUsd,
    latencyMs: final.latencyMs,
  });

  return {
    answer: final.text.trim(),
    context: ctx,
    routing,
    model,
    status: 'max_steps',
    steps: maxSteps,
  };
}
