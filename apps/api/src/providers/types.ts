/**
 * One vendor-neutral chat interface that every provider implements.
 *
 * The agent layer is written against these types only. Gemini, Anthropic and
 * OpenAI-compatible endpoints disagree about almost everything -- message
 * shapes, how tool calls are returned, what a "system" message is -- so each
 * adapter absorbs that difference and nothing above this file has to care.
 */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  /** Provider-issued id. Synthesised when the provider does not supply one. */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: Role;
  content: string;
  /** Present on assistant turns that requested tools. */
  toolCalls?: ToolCall[];
  /** Present on tool-result turns; must match the originating ToolCall.id. */
  toolCallId?: string;
  /** Tool name, on tool-result turns. */
  name?: string;
}

/** JSON Schema subset understood by all three vendors' function-calling APIs. */
export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  /** 'required' is best-effort: not every vendor enforces it. */
  toolChoice?: 'auto' | 'none' | 'required';
  /** Ask for a raw JSON object back. Used by the router and the LLM judge. */
  json?: boolean;
}

export interface Usage {
  promptTokens: number;
  outputTokens: number;
}

export interface ChatResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  finishReason: string;
  /** Echoed back for the run log so a bad answer can be traced to raw output. */
  model: string;
  provider: string;
}

export interface Provider {
  readonly name: string;
  /** False when the API key is missing; the registry then hides the provider. */
  isConfigured(): boolean;
  chat(req: ChatRequest): Promise<ChatResponse>;
  /** Optional: not every provider we support exposes embeddings. */
  embed?(texts: string[], model: string): Promise<number[][]>;
}

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    message: string,
  ) {
    super(`[${provider}] ${status}: ${message}`);
    this.name = 'ProviderError';
  }
}

/** Shared fetch wrapper: timeout, retry on 429/5xx, uniform error type. */
export async function requestJson(
  providerName: string,
  url: string,
  init: RequestInit,
  { retries = 3, timeoutMs = 60_000 } = {},
): Promise<unknown> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const body = await res.text();

      if (res.ok) return body ? JSON.parse(body) : {};

      // 429 and 5xx are worth retrying; 4xx otherwise is a bug in our request.
      const retryable = res.status === 429 || res.status >= 500;
      lastError = new ProviderError(providerName, res.status, body.slice(0, 500));
      if (!retryable || attempt === retries) throw lastError;

      // Exponential backoff with jitter, honouring Retry-After when present.
      const retryAfter = Number(res.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(2 ** attempt * 750, 8000) + Math.random() * 400;
      await new Promise((r) => setTimeout(r, delay));
    } catch (err) {
      if (err instanceof ProviderError) { lastError = err; if (attempt === retries) throw err; continue; }
      lastError = err as Error;
      if (attempt === retries) throw new ProviderError(providerName, 0, lastError.message);
      await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new ProviderError(providerName, 0, 'unreachable');
}
