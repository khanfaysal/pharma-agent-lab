import type { ToolSchema } from '../providers/types.js';
import { ragTools } from './ragTools.js';
import { sqlTools } from './sqlTools.js';
import type { AgentTool, ToolResult } from './types.js';

const allTools: AgentTool[] = [...sqlTools, ...ragTools];
const byName = new Map(allTools.map((t) => [t.schema.name, t]));

export type ToolGroup = 'sql' | 'rag' | 'all';

/**
 * The tool surface offered to the model for a given route.
 *
 * Narrowing matters: a model given 10 tools for a question that needs 1 picks
 * wrong more often and burns tokens on the unused schemas. The router's whole
 * job is to make this list smaller.
 */
export function toolsFor(group: ToolGroup): AgentTool[] {
  if (group === 'all') return allTools;
  return allTools.filter((t) => t.group === group);
}

export function schemasFor(group: ToolGroup): ToolSchema[] {
  return toolsFor(group).map((t) => t.schema);
}

export function getTool(name: string): AgentTool | undefined {
  return byName.get(name);
}

export interface ExecutedTool {
  name: string;
  args: Record<string, unknown>;
  result: ToolResult;
  latencyMs: number;
  error?: string;
}

/**
 * Execute one tool call.
 *
 * A thrown tool never propagates: the error is returned as a tool *result* so
 * the model sees it and can recover (retry with different arguments, or say it
 * could not find the information) rather than the whole run failing.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ExecutedTool> {
  const started = Date.now();
  const tool = byName.get(name);

  if (!tool) {
    return {
      name,
      args,
      latencyMs: 0,
      error: 'unknown tool',
      result: {
        summary: `No tool named "${name}". Available: ${[...byName.keys()].join(', ')}.`,
        data: null,
        citations: [],
        empty: true,
      },
    };
  }

  try {
    const result = await tool.run(args);
    return { name, args, result, latencyMs: Date.now() - started };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[tool:${name}] failed:`, message);
    return {
      name,
      args,
      latencyMs: Date.now() - started,
      error: message,
      result: {
        summary: `Tool "${name}" failed: ${message}. Try different arguments or a different tool.`,
        data: null,
        citations: [],
        empty: true,
      },
    };
  }
}

export function describeTools() {
  return allTools.map((t) => ({
    name: t.schema.name,
    group: t.group,
    description: t.schema.description,
    parameters: Object.keys(t.schema.parameters.properties),
    required: t.schema.parameters.required ?? [],
  }));
}
