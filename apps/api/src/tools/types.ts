import type { ToolSchema } from '../providers/types.js';

/** Where a claim in the final answer came from. */
export interface Citation {
  kind: 'sql' | 'doc';
  /** 'brand:9' / 'generic:1124' for SQL; a document slug for docs. */
  ref: string;
  label: string;
  uri?: string | null;
}

export interface ToolResult {
  /** One line the model reads first, so it can skip unpacking `data`. */
  summary: string;
  data: unknown;
  citations: Citation[];
  /** Set when the tool ran but found nothing -- distinct from an error. */
  empty?: boolean;
}

export interface AgentTool {
  schema: ToolSchema;
  /** 'sql' | 'rag' -- lets the router expose only the relevant subset. */
  group: 'sql' | 'rag';
  run(args: Record<string, unknown>): Promise<ToolResult>;
}

/* ------------------------------------------------------------------ *
 * Argument coercion
 *
 * Models send "10" where the schema says integer, `null` for an omitted
 * optional, and occasionally a single string where an array was asked for.
 * Coercing here is far cheaper than a retry round-trip.
 * ------------------------------------------------------------------ */

export function asString(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

export function asInt(v: unknown, fallback: number, { min = 1, max = 100 } = {}): number {
  const n = typeof v === 'number' ? v : Number(asString(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function asNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(asString(v));
  return Number.isFinite(n) ? n : null;
}

export function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => asString(x)).filter(Boolean);
  const single = asString(v);
  return single ? [single] : [];
}

export type { ToolSchema };
