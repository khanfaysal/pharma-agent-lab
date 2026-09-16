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

/**
 * Absent means absent.
 *
 * `Number('')` is 0, so coercing an omitted optional through asString() used to
 * yield a real 0 rather than "not given". That turned every unset numeric filter
 * into an active one -- `max_price <= 0 AND min_price >= 0` matched almost
 * nothing -- and collapsed an unset `limit` to the clamp minimum of 1. The
 * failure was invisible: the tool reported "no matching rows" for data that was
 * plainly there, and the model burned its whole step budget rephrasing a query
 * that was never the problem.
 */
function numericOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const text = asString(v);
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function asInt(v: unknown, fallback: number, { min = 1, max = 100 } = {}): number {
  const n = numericOrNull(v);
  if (n === null) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function asNumber(v: unknown): number | null {
  return numericOrNull(v);
}

export function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => asString(x)).filter(Boolean);
  const single = asString(v);
  return single ? [single] : [];
}

export type { ToolSchema };
