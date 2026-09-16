import { config } from '../config.js';
import { callModel, resolveTier } from '../providers/registry.js';
import { executeTool, schemasFor } from '../tools/registry.js';
import { AgentContext } from './context.js';
import { SYSTEM_EXECUTOR, SYSTEM_PLANNER, SYSTEM_SYNTHESIZER, renderEvidence } from './prompts.js';
import { loadConversation } from './recorder.js';
import { routeQuestion } from './router.js';
import type { LoopOutcome } from './single.js';
import type { AgentRunRequest, StepRecorder } from './types.js';

/**
 * Multi-model architecture: four roles, each on the cheapest tier that can do
 * its job.
 *
 *   router     (fast)     -- which tool family, how hard is this
 *   planner    (fast)     -- which tools, in what order
 *   executor   (balanced) -- actually calls the tools
 *   synthesiser(strong)   -- writes the answer from the gathered evidence
 *
 * The thesis being tested: tool *selection* is an easy task that a small model
 * does adequately, while writing a correct grounded answer is a hard task worth
 * a large model. If that holds, this arm should cost less than single-model at
 * comparable accuracy -- because the expensive model sees the evidence exactly
 * once, instead of re-reading the whole growing transcript on every step.
 *
 * The cost it pays is latency: four sequential calls instead of a tight loop,
 * and a handoff at which the synthesiser cannot ask for one more tool call.
 * Whether that trade is worth it is what apps/api/src/eval measures.
 */
export async function runMultiModel(
  req: AgentRunRequest,
  recorder: StepRecorder,
): Promise<LoopOutcome> {
  const history = await loadConversation(req.conversationId);

  const routing = await routeQuestion(req.question, recorder, {
    useModel: req.useModelRouter ?? true,
    history,
  });

  const planner = resolveTier('fast');
  const executor = resolveTier(req.tier ?? (routing.tier === 'strong' ? 'balanced' : routing.tier));
  const synthesizer = resolveTier('strong');
  const maxSteps = req.maxSteps ?? config.agent.maxSteps;
  const tools = schemasFor(routing.toolGroup);

  // ---------------------------------------------------------------- plan
  const toolMenu = tools.map((t) => `- ${t.name}: ${t.description}`).join('\n');

  const planRes = await callModel(planner, {
    messages: [
      { role: 'system', content: SYSTEM_PLANNER },
      { role: 'user', content: `Question: ${req.question}\n\nAvailable tools:\n${toolMenu}` },
    ],
    temperature: 0,
    maxTokens: 300,
  });

  const plan = planRes.text.trim();

  await recorder.record({
    kind: 'plan',
    agentRole: 'planner',
    provider: planner.provider,
    model: planner.model,
    input: { question: req.question, toolsOffered: tools.length },
    output: { plan },
    usage: planRes.usage,
    costUsd: planRes.costUsd,
    latencyMs: planRes.latencyMs,
  });

  // ------------------------------------------------------------ execute
  const ctx = new AgentContext(
    SYSTEM_EXECUTOR,
    `Question: ${req.question}\n\nPlan from the planner:\n${plan || '(no plan produced -- use your judgement)'}`,
    history,
  );

  let status: 'ok' | 'max_steps' = 'ok';
  let usedSteps = 0;

  for (let step = 0; step < maxSteps; step++) {
    usedSteps = step + 1;

    const res = await callModel(executor, {
      messages: ctx.forModel(),
      tools,
      toolChoice: step === 0 && routing.route !== 'none' ? 'required' : 'auto',
      temperature: 0,
      maxTokens: 1024,
    });

    await recorder.record({
      kind: 'llm',
      agentRole: 'executor',
      provider: executor.provider,
      model: executor.model,
      input: { step, contextTokens: ctx.estimatedTokens() },
      output: { text: res.text.slice(0, 500), toolCalls: res.toolCalls.map((c) => c.name) },
      usage: res.usage,
      costUsd: res.costUsd,
      latencyMs: res.latencyMs,
    });

    if (res.toolCalls.length === 0) break; // executor said DONE (or gave up)

    ctx.pushAssistant(res.text, res.toolCalls);

    const executed = await Promise.all(
      res.toolCalls.map((call) => executeTool(call.name, call.arguments)),
    );

    for (let i = 0; i < executed.length; i++) {
      const call = res.toolCalls[i]!;
      const exec = executed[i]!;
      ctx.pushToolResult(call.id, call.name, call.arguments, exec.result);
      await recorder.record({
        kind: 'tool',
        agentRole: 'executor',
        toolName: exec.name,
        input: exec.args,
        output: { summary: exec.result.summary, empty: exec.result.empty, data: exec.result.data },
        latencyMs: exec.latencyMs,
        error: exec.error,
      });
    }

    if (step === maxSteps - 1) status = 'max_steps';
  }

  // --------------------------------------------------------- synthesise
  // The synthesiser sees the evidence ONCE, in a compact rendering -- not the
  // executor's transcript. That is the whole cost argument for this design.
  const evidence = renderEvidence(ctx.gathered);

  const synthRes = await callModel(synthesizer, {
    messages: [
      { role: 'system', content: SYSTEM_SYNTHESIZER },
      {
        role: 'user',
        content: `User question: ${req.question}\n\nTool results gathered:\n${evidence}`,
      },
    ],
    temperature: 0.2,
    maxTokens: 1500,
  });

  await recorder.record({
    kind: 'synthesize',
    agentRole: 'synthesizer',
    provider: synthesizer.provider,
    model: synthesizer.model,
    input: { resultCount: ctx.gathered.length, evidenceChars: evidence.length },
    output: { text: synthRes.text.slice(0, 2000) },
    usage: synthRes.usage,
    costUsd: synthRes.costUsd,
    latencyMs: synthRes.latencyMs,
  });

  return {
    answer: synthRes.text.trim(),
    context: ctx,
    routing,
    model: synthesizer,
    status,
    steps: usedSteps,
  };
}
