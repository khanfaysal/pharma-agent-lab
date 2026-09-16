import { resolveTier } from '../providers/registry.js';
import { callModel } from '../providers/registry.js';
import { AgentContext } from './context.js';
import { heuristicRoute } from './router.js';
import type { LoopOutcome } from './single.js';
import type { AgentRunRequest, StepRecorder } from './types.js';

const SYSTEM_BASELINE = `
You are a pharmaceutical reference assistant for the Bangladesh market.
Answer the user's question directly from your own knowledge. You have no database access.
If you are not confident, say so rather than guessing.
`.trim();

/**
 * Control arm: one model call, no tools, no retrieval.
 *
 * This exists to answer the question every RAG system should be able to answer
 * about itself -- how much of the accuracy comes from retrieval, and how much
 * the model already knew. Without this row in the comparison table, a
 * respectable-looking score on the agent arms is uninterpretable.
 *
 * Expect it to hallucinate confidently on prices and brand-to-manufacturer
 * mappings, which is the point.
 */
export async function runBaseline(
  req: AgentRunRequest,
  recorder: StepRecorder,
): Promise<LoopOutcome> {
  const routing = { ...heuristicRoute(req.question), reasoning: 'baseline arm: routing not used' };
  const model = resolveTier(req.tier ?? 'balanced');
  const ctx = new AgentContext(SYSTEM_BASELINE, req.question);

  const res = await callModel(model, {
    messages: ctx.forModel(),
    temperature: 0.2,
    maxTokens: 1200,
  });

  await recorder.record({
    kind: 'llm',
    agentRole: 'baseline',
    provider: model.provider,
    model: model.model,
    input: { question: req.question, tools: 0 },
    output: { text: res.text.slice(0, 2000) },
    usage: res.usage,
    costUsd: res.costUsd,
    latencyMs: res.latencyMs,
  });

  return { answer: res.text.trim(), context: ctx, routing, model, status: 'ok', steps: 1 };
}

/**
 * Control arm 2: routing only.
 *
 * Runs the router and the tools it selects, then returns the raw tool output
 * with no synthesis model at all. Isolates retrieval quality from generation
 * quality -- if this arm's retrieved refs score well on the eval but the full
 * arms answer badly, the problem is the writer, not the retriever.
 */
export async function runRouterOnly(
  req: AgentRunRequest,
  recorder: StepRecorder,
): Promise<LoopOutcome> {
  const { routeQuestion } = await import('./router.js');
  const { executeTool } = await import('../tools/registry.js');
  const { toolsFor } = await import('../tools/registry.js');

  const routing = await routeQuestion(req.question, recorder, {
    useModel: req.useModelRouter ?? true,
  });

  const ctx = new AgentContext('(router-only arm: no answering model)', req.question);

  // Call the first tool of the routed family with the question verbatim. Crude
  // on purpose: this arm measures the retriever, not argument construction.
  const candidates = toolsFor(routing.toolGroup);
  const primary = routing.route === 'sql'
    ? candidates.find((t) => t.schema.name === 'search_brands')
    : candidates.find((t) => t.schema.name === 'hybrid_search');
  const tool = primary ?? candidates[0];

  if (tool) {
    const args = tool.group === 'rag'
      ? { query: req.question }
      : { query: req.question, limit: 10 };
    const exec = await executeTool(tool.schema.name, args);
    ctx.pushToolResult('router_only', exec.name, exec.args, exec.result);
    await recorder.record({
      kind: 'tool',
      agentRole: 'router-only',
      toolName: exec.name,
      input: exec.args,
      output: { summary: exec.result.summary, empty: exec.result.empty, data: exec.result.data },
      latencyMs: exec.latencyMs,
      error: exec.error,
    });
  }

  const answer = ctx.gathered.length
    ? ctx.gathered.map((g) => g.summary).join('\n')
    : 'No tool produced a result.';

  return {
    answer,
    context: ctx,
    routing,
    model: resolveTier('fast'),
    status: 'ok',
    steps: 1,
  };
}
