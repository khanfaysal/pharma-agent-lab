import type { Tier } from '../config.js';
import { callModel, resolveTier } from '../providers/registry.js';
import type { ToolGroup } from '../tools/registry.js';
import { SYSTEM_ROUTER } from './prompts.js';
import type { PriorTurn } from './recorder.js';
import type { StepRecorder } from './types.js';

export type Route = 'sql' | 'rag' | 'hybrid' | 'none';

export interface RoutingDecision {
  route: Route;
  tier: Tier;
  reasoning: string;
  /** 'model' when an LLM decided, 'heuristic' when the fallback did. */
  decidedBy: 'model' | 'heuristic';
  toolGroup: ToolGroup;
}

const ROUTE_TO_GROUP: Record<Route, ToolGroup> = {
  sql: 'sql',
  rag: 'rag',
  hybrid: 'all',
  none: 'all',
};

/**
 * Keyword fallback. Used when routing is disabled, when the router model errors,
 * and as the control arm in router-quality comparisons -- if the LLM router does
 * not beat this, it is not paying for itself.
 */
export function heuristicRoute(question: string): RoutingDecision {
  const q = question.toLowerCase();

  const serviceSignals = /\b(privacy|polic|terms|conditions|retention|retain|delete my|gdpr|consent|cookie|rate limit|quota|api key|account|sign ?up|subscription|scrape|licen[cs]e|liabilit|disclaimer|sponsor|contact|support|how does (the )?(search|assistant)|what (is|does) medindex)\b/;
  const drugSignals = /\b(price|cost|cheap|expensive|taka|bdt|brand|generic|manufactur|company|compan|tablet|capsule|syrup|injection|suspension|mg\b|ml\b|dose|dosage|dosing|side ?effect|contraindicat|interaction|pregnan|indicat|treat|therapy|therapeutic|class|strength|pack|medicine|medication|drug|remedy|prescri|suggest|recommend|used for|good for|cure|relief|symptom|disease|syndrome|disorder)\b/;

  const service = serviceSignals.test(q);
  const drug = drugSignals.test(q);

  const route: Route = service && drug ? 'hybrid'
                     : service ? 'rag'
                     : drug ? 'sql'
                     : 'hybrid';

  // Length and conjunctions are a crude but honest proxy for multi-step work.
  const tier: Tier = /\b(compare|versus|vs\.?|cheapest|all brands|and also|both)\b/.test(q) || q.length > 160
    ? 'strong'
    : q.length > 70 ? 'balanced' : 'fast';

  return {
    route,
    tier,
    reasoning: `keyword match: service=${service}, drug=${drug}`,
    decidedBy: 'heuristic',
    toolGroup: ROUTE_TO_GROUP[route],
  };
}

/**
 * LLM routing. Always runs on the `fast` tier: routing is a classification
 * task, and spending a strong model to decide whether to spend a strong model
 * defeats the purpose.
 */
export async function routeQuestion(
  question: string,
  recorder: StepRecorder,
  { useModel = true, history = [] }: { useModel?: boolean; history?: PriorTurn[] } = {},
): Promise<RoutingDecision> {
  // A follow-up carries almost no signal on its own. "What does it cost?" has
  // no drug word in it, so both routers send it to the document corpus and the
  // catalog is never queried. Classify against the resolved question instead:
  // the last exchange plus the new text.
  const last = history[history.length - 1];
  const contextualised = last
    ? `${last.question}
${last.answer.slice(0, 300)}
${question}`
    : question;

  if (!useModel) {
    const decision = heuristicRoute(contextualised);
    await recorder.record({
      kind: 'route',
      agentRole: 'router',
      input: { question, useModel: false },
      output: decision,
    });
    return decision;
  }

  const target = resolveTier('fast');

  try {
    const res = await callModel(target, {
      messages: [
        { role: 'system', content: SYSTEM_ROUTER },
        ...(last
          ? [{
              role: 'user' as const,
              content: `Earlier in this conversation:
Q: ${last.question}
A: ${last.answer.slice(0, 400)}`,
            }]
          : []),
        { role: 'user', content: question },
      ],
      json: true,
      temperature: 0,
      maxTokens: 200,
    });

    const parsed = parseRouterJson(res.text);
    const decision: RoutingDecision = parsed
      ? { ...parsed, decidedBy: 'model', toolGroup: ROUTE_TO_GROUP[parsed.route] }
      // A router that returns unparsable JSON is a router that failed; fall
      // back rather than defaulting to a route that may be wrong.
      : { ...heuristicRoute(contextualised), reasoning: 'router returned unparsable JSON' };

    await recorder.record({
      kind: 'route',
      agentRole: 'router',
      provider: target.provider,
      model: target.model,
      input: { question },
      output: decision,
      usage: res.usage,
      costUsd: res.costUsd,
      latencyMs: res.latencyMs,
    });

    return decision;
  } catch (err) {
    const decision = {
      ...heuristicRoute(contextualised),
      reasoning: `router model failed (${err instanceof Error ? err.message : String(err)}), used keywords`,
    };
    await recorder.record({
      kind: 'route',
      agentRole: 'router',
      input: { question },
      output: decision,
      error: err instanceof Error ? err.message : String(err),
    });
    return decision;
  }
}

function parseRouterJson(text: string): { route: Route; tier: Tier; reasoning: string } | null {
  // Models wrap JSON in fences even when told not to; tolerate it.
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const route = String(obj.route ?? '').toLowerCase();
    const tier = String(obj.tier ?? '').toLowerCase();
    if (!['sql', 'rag', 'hybrid', 'none'].includes(route)) return null;
    return {
      route: route as Route,
      tier: (['fast', 'balanced', 'strong'].includes(tier) ? tier : 'balanced') as Tier,
      reasoning: String(obj.reasoning ?? '').slice(0, 300),
    };
  } catch {
    return null;
  }
}
