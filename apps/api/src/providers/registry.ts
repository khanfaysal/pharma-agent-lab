import { config, TIERS, type Tier } from '../config.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import { MockProvider } from './mock.js';
import { OpenAiCompatProvider } from './openaiCompat.js';
import { costUsd } from './pricing.js';
import { ProviderError, type ChatRequest, type ChatResponse, type Provider } from './types.js';

const providers: Record<string, Provider> = {
  gemini: new GeminiProvider(),
  anthropic: new AnthropicProvider(),
  openai: new OpenAiCompatProvider(),
  mock: new MockProvider(),
};

export function getProvider(name: string): Provider {
  const provider = providers[name];
  if (!provider) throw new Error(`Unknown provider "${name}"`);
  return provider;
}

/** Providers with credentials present. `mock` is always in this list. */
export function availableProviders(): string[] {
  return Object.entries(providers)
    .filter(([, p]) => p.isConfigured())
    .map(([name]) => name);
}

export interface ResolvedModel {
  provider: string;
  model: string;
  tier: Tier;
  /** True when the configured provider had no key and we fell back to mock. */
  degraded: boolean;
}

/**
 * Resolve a tier to a concrete provider+model.
 *
 * Falls back to the mock provider rather than throwing, so a missing key
 * degrades the lab to offline mode instead of taking the API down. The
 * `degraded` flag is surfaced in the run log and in the UI so a comparison is
 * never silently run against stubs.
 */
export function resolveTier(tier: Tier): ResolvedModel {
  const ref = config.tiers[tier];
  const provider = providers[ref.provider];
  if (provider?.isConfigured()) {
    return { provider: ref.provider, model: ref.model, tier, degraded: false };
  }
  return { provider: 'mock', model: `mock-${tier}`, tier, degraded: true };
}

export interface CallResult extends ChatResponse {
  latencyMs: number;
  costUsd: number;
}

/**
 * Is this failure worth trying a different model for?
 *
 * 503 "this model is experiencing high demand" and 429 are properties of the
 * model, not of the request: the same prompt sent to a different model usually
 * succeeds immediately. A 400 is our bug and will fail identically everywhere,
 * so it is not worth the second call.
 */
function isOverloaded(err: unknown): boolean {
  return err instanceof ProviderError && (err.status === 503 || err.status === 429 || err.status >= 500);
}

/** Every configured model except the one that just failed, cheapest first. */
function alternatives(failed: { provider: string; model: string }): Array<{ provider: string; model: string }> {
  const seen = new Set([`${failed.provider}:${failed.model}`]);
  const out: Array<{ provider: string; model: string }> = [];
  for (const tier of TIERS) {
    const ref = config.tiers[tier];
    const key = `${ref.provider}:${ref.model}`;
    if (seen.has(key)) continue;
    if (!providers[ref.provider]?.isConfigured()) continue;
    seen.add(key);
    out.push({ provider: ref.provider, model: ref.model });
  }
  return out;
}

/**
 * Single entry point for every model call: times it, prices it, and survives
 * one model being busy.
 *
 * Without the fallback a 503 on the *router* -- the first, smallest call of the
 * run -- killed the whole question before a single tool ran, and the user saw
 * "that could not be answered" for a problem that had nothing to do with their
 * question. Free-tier models are overloaded often enough that this is a normal
 * operating condition, not an exceptional one.
 */
export async function callModel(
  target: { provider: string; model: string },
  req: Omit<ChatRequest, 'model'>,
): Promise<CallResult> {
  const started = Date.now();
  const attempts = [target, ...alternatives(target)];
  let lastError: unknown;

  for (const attempt of attempts) {
    try {
      const provider = getProvider(attempt.provider);
      const res = await provider.chat({ ...req, model: attempt.model });
      if (attempt !== target) {
        console.warn(`[providers] ${target.model} unavailable, answered with ${attempt.model}`);
      }
      return {
        ...res,
        latencyMs: Date.now() - started,
        costUsd: costUsd(attempt.model, res.usage.promptTokens, res.usage.outputTokens),
      };
    } catch (err) {
      lastError = err;
      if (!isOverloaded(err)) throw err;
    }
  }

  throw lastError;
}

/** Describe the configured tiers, for the UI's model picker and health check. */
export function describeTiers() {
  return (Object.keys(config.tiers) as Tier[]).map((tier) => {
    const resolved = resolveTier(tier);
    return {
      tier,
      configured: `${config.tiers[tier].provider}:${config.tiers[tier].model}`,
      effective: `${resolved.provider}:${resolved.model}`,
      degraded: resolved.degraded,
    };
  });
}
