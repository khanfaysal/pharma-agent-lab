/**
 * USD per 1M tokens, used to attach a cost to every agent step.
 *
 * These are list rates as of 2026-06; they drift. The comparison UI reports
 * relative cost between architectures, which stays meaningful even when an
 * absolute rate is stale -- but update this table before quoting real numbers.
 *
 * Lookup is longest-prefix, so `gemini-2.0-flash-lite-preview-02-05` resolves
 * against the `gemini-2.0-flash-lite` entry without needing every snapshot id.
 */
export interface Rate { input: number; output: number }

const RATES: Record<string, Rate> = {
  // --- Google Gemini --------------------------------------------------
  // Free tier available on all of these, subject to rate limits.
  'gemini-2.0-flash-lite': { input: 0.075, output: 0.30 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'gemini-2.5-pro': { input: 1.25, output: 10.00 },
  'text-embedding-004': { input: 0.00, output: 0.00 },
  // The 2.x entries above are kept for replaying old runs; those models are no
  // longer served to new API keys. Current tier defaults are the 3.x models.
  //
  // Every model below is free of charge on the AI Studio free tier, subject to
  // rate limits. These are the *paid* list rates, so the comparison table shows
  // what an architecture would cost at production volume rather than $0.
  'gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
  'gemini-3.5-flash': { input: 1.50, output: 9.00 },
  // 3.6/3.7/3.8 flash share one rate, rising to 1.50/7.50 on 2027-01-01.
  'gemini-3.6-flash': { input: 0.75, output: 3.75 },
  'gemini-3.7-flash': { input: 0.75, output: 3.75 },
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
  'gemini-embedding-001': { input: 0.00, output: 0.00 },
  'gemini-embedding-2': { input: 0.20, output: 0.00 },

  // --- Anthropic ------------------------------------------------------
  'claude-fable-5-1': { input: 10.00, output: 50.00 },
  'claude-opus-5': { input: 5.00, output: 25.00 },
  'claude-opus-4-8': { input: 5.00, output: 25.00 },
  'claude-sonnet-5': { input: 2.00, output: 10.00 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5': { input: 1.00, output: 5.00 },

  // --- OpenAI ---------------------------------------------------------
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'text-embedding-3-small': { input: 0.02, output: 0.00 },
  'text-embedding-3-large': { input: 0.13, output: 0.00 },

  // --- Local (Ollama / LM Studio): free, but still worth timing -------
  'nomic-embed-text': { input: 0, output: 0 },
  'llama3.2': { input: 0, output: 0 },
  'qwen2.5': { input: 0, output: 0 },
};

export function rateFor(model: string): Rate {
  let best: Rate | null = null;
  let bestLen = -1;
  for (const [key, rate] of Object.entries(RATES)) {
    if (model.startsWith(key) && key.length > bestLen) {
      best = rate;
      bestLen = key.length;
    }
  }
  // Unknown models cost 0 rather than guessing, so a missing rate shows up as
  // a suspicious zero in the comparison table instead of a fabricated number.
  return best ?? { input: 0, output: 0 };
}

export function costUsd(model: string, promptTokens: number, outputTokens: number): number {
  const rate = rateFor(model);
  return (promptTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

/** Rough token estimate for budgeting before a call is made. ~4 chars/token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
