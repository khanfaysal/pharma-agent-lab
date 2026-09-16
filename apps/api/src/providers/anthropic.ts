import { config } from '../config.js';
import {
  type ChatRequest, type ChatResponse, type Provider, type ToolCall,
  requestJson,
} from './types.js';

const BASE = 'https://api.anthropic.com/v1';
const API_VERSION = '2023-06-01';

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'thinking'; thinking: string };

interface AnthropicMessage { role: 'user' | 'assistant'; content: AnthropicBlock[] | string }

interface AnthropicResponse {
  content?: AnthropicBlock[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Translate our neutral message list into the Messages API shape.
 *
 * Differences to absorb:
 *  - `system` is a top-level request field, not a message.
 *  - tool results are `tool_result` blocks on a *user* message, matched by id.
 *  - consecutive same-role messages are legal, but grouping tool results into
 *    one user message matters: splitting them teaches the model to stop making
 *    parallel calls.
 */
function toAnthropicMessages(req: ChatRequest): { system: string; messages: AnthropicMessage[] } {
  const systemTexts: string[] = [];
  const messages: AnthropicMessage[] = [];

  for (const msg of req.messages) {
    if (msg.role === 'system') {
      systemTexts.push(msg.content);
      continue;
    }

    if (msg.role === 'tool') {
      const block: AnthropicBlock = {
        type: 'tool_result',
        tool_use_id: msg.toolCallId ?? 'unknown',
        content: msg.content,
      };
      // Coalesce into the previous user message when it is already a
      // tool-result batch, so parallel calls answer in a single turn.
      const prev = messages[messages.length - 1];
      if (prev && prev.role === 'user' && Array.isArray(prev.content)
          && prev.content.every((b) => b.type === 'tool_result')) {
        prev.content.push(block);
      } else {
        messages.push({ role: 'user', content: [block] });
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const blocks: AnthropicBlock[] = [];
      if (msg.content) blocks.push({ type: 'text', text: msg.content });
      for (const call of msg.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
      }
      if (blocks.length) messages.push({ role: 'assistant', content: blocks });
      continue;
    }

    messages.push({ role: 'user', content: [{ type: 'text', text: msg.content }] });
  }

  return { system: systemTexts.join('\n\n'), messages };
}

export class AnthropicProvider implements Provider {
  readonly name = 'anthropic';

  isConfigured(): boolean {
    return Boolean(config.providers.anthropic.apiKey);
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const { system, messages } = toAnthropicMessages(req);

    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      messages,
    };
    if (system) body.system = system;
    // Sampling params are rejected by the 4.6+ family, which uses effort instead.
    if (req.temperature !== undefined && !isAdaptiveThinkingModel(req.model)) {
      body.temperature = req.temperature;
    }

    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
      if (req.toolChoice === 'required') body.tool_choice = { type: 'any' };
      else if (req.toolChoice === 'none') body.tool_choice = { type: 'none' };
    }

    // JSON mode: Anthropic has no response_mime_type, so instruct instead.
    if (req.json) {
      body.system = `${system}\n\nRespond with a single raw JSON object and nothing else. No prose, no markdown fences.`.trim();
    }

    const json = (await requestJson(this.name, `${BASE}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.providers.anthropic.apiKey,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify(body),
    })) as AnthropicResponse;

    const blocks = json.content ?? [];
    const text = blocks
      .filter((b): b is Extract<AnthropicBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const toolCalls: ToolCall[] = blocks
      .filter((b): b is Extract<AnthropicBlock, { type: 'tool_use' }> => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, arguments: b.input ?? {} }));

    return {
      text,
      toolCalls,
      usage: {
        promptTokens: json.usage?.input_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
      },
      finishReason: json.stop_reason ?? 'end_turn',
      model: req.model,
      provider: this.name,
    };
  }
}

/** Models that reject temperature/top_p in favour of output_config.effort. */
function isAdaptiveThinkingModel(model: string): boolean {
  return /^claude-(opus-(5|4-[678])|sonnet-5|fable-5|mythos-5)/.test(model);
}
