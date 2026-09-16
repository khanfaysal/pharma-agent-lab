import { config } from '../config.js';
import {
  type ChatRequest, type ChatResponse, type Provider, type ToolCall,
  requestJson,
} from './types.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Gemini's `contents` entries: only 'user' and 'model' roles exist. */
interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}
interface GeminiContent { role: 'user' | 'model'; parts: GeminiPart[] }

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/**
 * Translate our neutral message list into Gemini's `contents`.
 *
 * Two shape mismatches to absorb:
 *  - system messages are not a role; they go in `systemInstruction`.
 *  - tool results are `functionResponse` parts on a *user* turn, and Gemini
 *    matches them to the call by NAME, not by id -- so toolCallId is dropped.
 */
function toGeminiContents(req: ChatRequest): {
  contents: GeminiContent[];
  systemInstruction?: { parts: GeminiPart[] };
} {
  const systemTexts: string[] = [];
  const contents: GeminiContent[] = [];

  for (const msg of req.messages) {
    if (msg.role === 'system') {
      systemTexts.push(msg.content);
      continue;
    }

    if (msg.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: msg.name ?? 'tool',
            // Gemini requires an object here, so scalar results get wrapped.
            response: safeParseObject(msg.content),
          },
        }],
      });
      continue;
    }

    if (msg.role === 'assistant') {
      const parts: GeminiPart[] = [];
      if (msg.content) parts.push({ text: msg.content });
      for (const call of msg.toolCalls ?? []) {
        parts.push({ functionCall: { name: call.name, args: call.arguments } });
      }
      if (parts.length) contents.push({ role: 'model', parts });
      continue;
    }

    contents.push({ role: 'user', parts: [{ text: msg.content }] });
  }

  return {
    contents,
    ...(systemTexts.length
      ? { systemInstruction: { parts: [{ text: systemTexts.join('\n\n') }] } }
      : {}),
  };
}

function safeParseObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { result: parsed };
  } catch {
    return { result: raw };
  }
}

export class GeminiProvider implements Provider {
  readonly name = 'gemini';

  isConfigured(): boolean {
    return Boolean(config.providers.gemini.apiKey);
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const { contents, systemInstruction } = toGeminiContents(req);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: req.temperature ?? 0.2,
        maxOutputTokens: req.maxTokens ?? 2048,
        ...(req.json ? { responseMimeType: 'application/json' } : {}),
      },
    };
    if (systemInstruction) body.systemInstruction = systemInstruction;

    if (req.tools?.length) {
      body.tools = [{
        functionDeclarations: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      }];
      body.toolConfig = {
        functionCallingConfig: {
          mode: req.toolChoice === 'none' ? 'NONE'
              : req.toolChoice === 'required' ? 'ANY'
              : 'AUTO',
        },
      };
    }

    const json = (await requestJson(
      this.name,
      `${BASE}/models/${encodeURIComponent(req.model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': config.providers.gemini.apiKey,
        },
        body: JSON.stringify(body),
      },
    )) as GeminiResponse;

    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const text = parts.filter((p) => p.text).map((p) => p.text).join('');

    // Gemini issues no call ids, so synthesise stable ones for our run log.
    const toolCalls: ToolCall[] = parts
      .filter((p): p is GeminiPart & { functionCall: NonNullable<GeminiPart['functionCall']> } =>
        Boolean(p.functionCall))
      .map((p, i) => ({
        id: `gemini_${Date.now()}_${i}`,
        name: p.functionCall.name,
        arguments: p.functionCall.args ?? {},
      }));

    return {
      text,
      toolCalls,
      usage: {
        promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      },
      finishReason: json.candidates?.[0]?.finishReason ?? 'stop',
      model: req.model,
      provider: this.name,
    };
  }

  async embed(texts: string[], model: string): Promise<number[][]> {
    // batchEmbedContents caps at 100 inputs per call.
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 100) {
      const batch = texts.slice(i, i + 100);
      const json = (await requestJson(
        this.name,
        `${BASE}/models/${encodeURIComponent(model)}:batchEmbedContents`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': config.providers.gemini.apiKey,
          },
          body: JSON.stringify({
            requests: batch.map((text) => ({
              model: `models/${model}`,
              content: { parts: [{ text }] },
            })),
          }),
        },
      )) as { embeddings?: Array<{ values: number[] }> };

      for (const e of json.embeddings ?? []) out.push(e.values);
    }
    return out;
  }
}
