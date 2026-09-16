import { config, type Tier } from '../config.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import { MockProvider } from './mock.js';
import { OpenAiCompatProvider } from './openaiCompat.js';
import { costUsd } from './pricing.js';
import type { ChatRequest, ChatResponse, Provider } from './types.js';

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

/** Single entry point for every model call: times it and prices it. */
export async function callModel(
  target: { provider: string; model: string },
  req: Omit<ChatRequest, 'model'>,
): Promise<CallResult> {
  const started = Date.now();
  const provider = getProvider(target.provider);
  const res = await provider.chat({ ...req, model: target.model });
  return {
    ...res,
    latencyMs: Date.now() - started,
    costUsd: costUsd(target.model, res.usage.promptTokens, res.usage.outputTokens),
  };
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
