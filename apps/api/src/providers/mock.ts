import { createHash } from 'node:crypto';
import { config } from '../config.js';
import type { ChatRequest, ChatResponse, Provider } from './types.js';

/**
 * Offline provider. Always configured, so the whole pipeline -- routing, tool
 * calls, retrieval, synthesis, run logging -- can be exercised end to end with
 * no API key and no network.
 *
 * It is deliberately dumb but *deterministic*: the same input always produces
 * the same output. That makes it useful as a control arm in comparisons (it
 * isolates how much of a score comes from retrieval versus from the model) and
 * it makes the integration tests reproducible.
 */
export class MockProvider implements Provider {
  readonly name = 'mock';

  isConfigured(): boolean {
    return true;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
    const question = lastUser?.content ?? '';
    const toolResults = req.messages.filter((m) => m.role === 'tool');

    // Router calls ask for JSON; answer in the router's schema.
    if (req.json) {
      return this.reply(req, JSON.stringify({
        route: /price|cheap|cost|company|manufactur|brand|strength|mg\b/i.test(question)
          ? 'sql'
          : /policy|privacy|terms|retain|delete|faq|how do i|support/i.test(question)
            ? 'rag'
            : 'hybrid',
        tier: question.length > 120 ? 'strong' : 'fast',
        reasoning: 'mock router: keyword heuristic, no model call',
      }));
    }

    // First turn with tools available: call the most plausible one so that the
    // agent loop actually exercises tool execution.
    if (req.tools?.length && toolResults.length === 0) {
      const tool = pickTool(req.tools.map((t) => t.name), question);
      if (tool) {
        return {
          text: '',
          toolCalls: [{
            id: `mock_${createHash('sha1').update(question).digest('hex').slice(0, 8)}`,
            name: tool,
            arguments: argumentsFor(tool, question),
          }],
          usage: { promptTokens: 120, outputTokens: 24 },
          finishReason: 'tool_use',
          model: req.model,
          provider: this.name,
        };
      }
    }

    // Synthesis turn: echo back what the tools actually returned, truncated.
    const evidence = toolResults
      .map((t, i) => `[${i + 1}] ${t.name}: ${t.content.slice(0, 240)}`)
      .join('\n');

    return this.reply(req, evidence
      ? `(mock answer) Based on ${toolResults.length} tool result(s):\n${evidence}`
      : `(mock answer) No tools were called for: "${question.slice(0, 120)}"`);
  }

  async embed(texts: string[]): Promise<number[][]> {
    // Deterministic hashed bag-of-words. Not semantic -- two paraphrases score
    // near zero -- so it is a floor for retrieval quality, never a substitute.
    return texts.map((text) => {
      const vec = new Array<number>(config.embeddings.dim).fill(0);
      for (const token of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
        const h = createHash('md5').update(token).digest();
        const idx = h.readUInt32BE(0) % config.embeddings.dim;
        vec[idx] = (vec[idx] ?? 0) + 1;
      }
      const norm = Math.hypot(...vec) || 1;
      return vec.map((v) => v / norm);
    });
  }

  private reply(req: ChatRequest, text: string): ChatResponse {
    return {
      text,
      toolCalls: [],
      usage: { promptTokens: 200, outputTokens: Math.ceil(text.length / 4) },
      finishReason: 'stop',
      model: req.model,
      provider: this.name,
    };
  }
}

function pickTool(available: string[], question: string): string | undefined {
  const q = question.toLowerCase();
  const order = /cheap|price|cost/.test(q)
      ? ['compare_brand_prices', 'search_brands', 'hybrid_search']
    : /company|manufactur|maker/.test(q)
      ? ['search_companies', 'search_brands']
    : /treat|indicat|used for|condition/.test(q)
      ? ['search_by_indication', 'search_generics']
    : /dose|dosage|side effect|contraindic|interaction/.test(q)
      ? ['get_generic_detail', 'search_generics']
    : /privacy|policy|terms|retain|delete|faq/.test(q)
      ? ['semantic_search', 'hybrid_search']
    : ['hybrid_search', 'search_brands'];

  return order.find((name) => available.includes(name)) ?? available[0];
}

function argumentsFor(tool: string, question: string): Record<string, unknown> {
  // Strip question words so the mock passes something search-like downstream.
  const term = question
    .replace(/[?.,!]/g, ' ')
    .replace(/\b(what|which|who|how|is|are|the|of|for|a|an|in|to|do|does|you|your|i|my|can|much|many)\b/gi, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join(' ');

  switch (tool) {
    case 'compare_brand_prices': return { generic_name: term, limit: 10 };
    case 'search_brands':        return { query: term, limit: 10 };
    case 'search_generics':      return { query: term, limit: 5 };
    case 'search_companies':     return { query: term, limit: 5 };
    case 'search_by_indication': return { indication: term, limit: 10 };
    case 'get_generic_detail':   return { generic_name: term };
    default:                     return { query: question, top_k: 6 };
  }
}
