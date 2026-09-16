import { config } from '../config.js';
import { estimateTokens } from '../providers/pricing.js';
import type { ChatMessage } from '../providers/types.js';
import type { Citation, ToolResult } from '../tools/types.js';
import type { PriorTurn } from './recorder.js';

/**
 * Context management for the agent loop.
 *
 * An agent that calls six tools and pastes every result verbatim will blow past
 * its input budget on the third step, and the failure looks like "the model got
 * worse" rather than "we ran out of room". This class keeps an explicit budget
 * and degrades in a defined order:
 *
 *   1. Truncate each tool result as it arrives (bounded per-result cost).
 *   2. When the running total crosses a high-water mark, replace the OLDEST
 *      tool results with their one-line summaries, keeping the most recent ones
 *      intact -- recency is the better proxy for relevance in a tool loop.
 *   3. Never touch the system prompt or the user's question.
 *
 * Nothing is lost for auditing: the full results stay in `gathered`, which is
 * what gets written to agent_steps and shown in the UI.
 */

const MAX_RESULT_CHARS = 3500;

export interface GatheredResult {
  name: string;
  args: Record<string, unknown>;
  summary: string;
  data: unknown;
  citations: Citation[];
  empty: boolean;
}

export class AgentContext {
  private readonly messages: ChatMessage[] = [];
  readonly gathered: GatheredResult[] = [];
  private compactions = 0;

  constructor(systemPrompt: string, question: string, history: PriorTurn[] = []) {
    this.messages.push({ role: 'system', content: systemPrompt });

    // Prior turns go in as plain user/assistant text, without their tool calls.
    // Replaying old tool traffic would double the transcript for evidence the
    // model has already summarised, and the answer text is what a follow-up
    // actually refers back to.
    for (const turn of history) {
      this.messages.push({ role: 'user', content: turn.question });
      this.messages.push({ role: 'assistant', content: turn.answer });
    }

    this.messages.push({ role: 'user', content: question });
  }

  /** Messages to send on the next model call. */
  forModel(): ChatMessage[] {
    return this.messages;
  }

  pushAssistant(text: string, toolCalls: ChatMessage['toolCalls']): void {
    this.messages.push({ role: 'assistant', content: text, toolCalls });
  }

  /**
   * Record a tool result, both for the model (truncated) and for the audit
   * trail (complete).
   */
  pushToolResult(
    toolCallId: string,
    name: string,
    args: Record<string, unknown>,
    result: ToolResult,
  ): void {
    this.gathered.push({
      name,
      args,
      summary: result.summary,
      data: result.data,
      citations: result.citations,
      empty: Boolean(result.empty),
    });

    this.messages.push({
      role: 'tool',
      toolCallId,
      name,
      content: serialiseForModel(result),
    });

    this.enforceBudget();
  }

  /** All citations gathered so far, de-duplicated by ref. */
  citations(): Citation[] {
    const seen = new Map<string, Citation>();
    for (const g of this.gathered) {
      for (const c of g.citations) if (!seen.has(c.ref)) seen.set(c.ref, c);
    }
    return [...seen.values()];
  }

  toolNames(): string[] {
    return this.gathered.map((g) => g.name);
  }

  estimatedTokens(): number {
    return this.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  }

  compactionCount(): number {
    return this.compactions;
  }

  /**
   * Collapse the oldest tool results to their summaries once the transcript
   * crosses 70% of the budget. 70% rather than 100% because the model's own
   * output and the next tool result still have to fit.
   */
  private enforceBudget(): void {
    const ceiling = config.agent.contextTokenBudget * 0.7;
    if (this.estimatedTokens() <= ceiling) return;

    // Keep the two most recent tool results whole; summarise everything older.
    const toolIdx = this.messages
      .map((m, i) => (m.role === 'tool' ? i : -1))
      .filter((i) => i !== -1);

    for (const i of toolIdx.slice(0, Math.max(0, toolIdx.length - 2))) {
      const msg = this.messages[i]!;
      if (msg.content.startsWith('[compacted]')) continue;
      const firstLine = msg.content.split('\n')[0] ?? '';
      msg.content = `[compacted] ${firstLine.slice(0, 300)} `
        + '(full result omitted to stay within the context budget; it is preserved in the run log)';
      this.compactions++;
      if (this.estimatedTokens() <= ceiling) break;
    }
  }
}

/**
 * Turn a ToolResult into the text the model actually reads.
 *
 * The summary goes first so a model that stops reading early still gets the
 * headline, and the truncation marker is explicit so the model knows there was
 * more rather than assuming it saw everything.
 */
function serialiseForModel(result: ToolResult): string {
  const body = JSON.stringify(result.data);
  if (body.length <= MAX_RESULT_CHARS) {
    return `${result.summary}\n${body}`;
  }
  return `${result.summary}\n${body.slice(0, MAX_RESULT_CHARS)}\n`
    + `[truncated: ${body.length - MAX_RESULT_CHARS} more characters. `
    + 'Narrow the query with filters or a smaller limit if you need the rest.]';
}
