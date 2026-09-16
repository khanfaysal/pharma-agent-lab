import { config } from '../config.js';
import {
  type ChatRequest, type ChatResponse, type Provider, type ToolCall,
  requestJson,
} from './types.js';

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAiResponse {
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: OpenAiToolCall[] };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Any endpoint speaking the OpenAI Chat Completions dialect: OpenRouter, Groq,
 * Together, Fireworks, LM Studio, Ollama's /v1 shim, vLLM.
 *
 * This is the cheapest way to add a fourth, fifth and sixth model to the
 * comparison matrix -- one base URL swap and the registry picks it up.
 */
export class OpenAiCompatProvider implements Provider {
  readonly name = 'openai';

  isConfigured(): boolean {
    // Local servers (LM Studio, Ollama) need no key, so a base URL alone counts.
    return Boolean(config.providers.openai.baseUrl);
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const messages = req.messages.map((msg) => {
      if (msg.role === 'tool') {
        return { role: 'tool', tool_call_id: msg.toolCallId, content: msg.content };
      }
      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        return {
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.toolCalls.map((c) => ({
            id: c.id,
            type: 'function' as const,
            function: { name: c.name, arguments: JSON.stringify(c.arguments) },
          })),
        };
      }
      return { role: msg.role, content: msg.content };
    });

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      temperature: req.temperature ?? 0.2,
      max_tokens: req.maxTokens ?? 2048,
    };

    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = req.toolChoice === 'required' ? 'required'
                       : req.toolChoice === 'none' ? 'none'
                       : 'auto';
    }

    if (req.json) body.response_format = { type: 'json_object' };

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (config.providers.openai.apiKey) {
      headers.authorization = `Bearer ${config.providers.openai.apiKey}`;
    }

    const base = config.providers.openai.baseUrl.replace(/\/+$/, '');
    const json = (await requestJson(this.name, `${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })) as OpenAiResponse;

    const choice = json.choices?.[0];

    const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? []).map((c) => ({
      id: c.id,
      name: c.function.name,
      // Arguments arrive as a JSON *string*; a model can emit malformed JSON
      // here, and an empty object is a better failure than a thrown request.
      arguments: parseArgs(c.function.arguments),
    }));

    return {
      text: choice?.message?.content ?? '',
      toolCalls,
      usage: {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
      finishReason: choice?.finish_reason ?? 'stop',
      model: req.model,
      provider: this.name,
    };
  }

  async embed(texts: string[], model: string): Promise<number[][]> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (config.providers.openai.apiKey) {
      headers.authorization = `Bearer ${config.providers.openai.apiKey}`;
    }
    const base = config.providers.openai.baseUrl.replace(/\/+$/, '');

    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 96) {
      const json = (await requestJson(this.name, `${base}/embeddings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, input: texts.slice(i, i + 96) }),
      })) as { data?: Array<{ embedding: number[]; index: number }> };

      // The spec does not guarantee ordering, so sort by index before pushing.
      const sorted = (json.data ?? []).slice().sort((a, b) => a.index - b.index);
      for (const d of sorted) out.push(d.embedding);
    }
    return out;
  }
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
