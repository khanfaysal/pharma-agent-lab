'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Render the agent's answer as formatted prose.
 *
 * The model replies in GitHub-flavoured markdown -- it will produce a table
 * whenever it has five drugs with four attributes each, which is exactly the
 * shape of a useful answer here. Piping that through `whitespace-pre-wrap`
 * showed the reader raw pipes and asterisks:
 *
 *   | **Pioglitazone** [generic:1155] | Type 2 DM, fatty liver | 23 | ৳3.75 |
 *
 * This renders the subset the model actually emits -- paragraphs, tables,
 * lists, bold -- and nothing else. A full markdown library would also bring
 * raw-HTML handling, which is not something to hand an LLM's output.
 *
 * Citation markers get special treatment: `[generic:1155]` is noise as text,
 * but it names a record the reader can open, so it becomes a link on the cell
 * it appeared in rather than a visible token.
 */

/* ------------------------------------------------------------- inline */

const GENERIC_REF = /\[generic:(\d+)\]/g;
const BRAND_REF = /\[brand:(\d+)\]/g;
const DOC_REF = /\[([a-z][a-z0-9-]{2,})\]/g;

/** Pull citation markers out of a cell, returning the clean text plus any id. */
function extractRef(raw: string): { text: string; genericId?: string } {
  let genericId: string | undefined;
  const text = raw
    .replace(GENERIC_REF, (_m, id: string) => { genericId ??= id; return ''; })
    .replace(BRAND_REF, '')
    .replace(DOC_REF, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { text, genericId };
}

/** `**bold**`, `*italic*` and `` `code` `` -- the only inline marks used. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;

    if (token.startsWith('**')) {
      out.push(<strong key={key} className="font-semibold text-navy-700">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      out.push(
        <code key={key} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.9em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = pattern.lastIndex;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Cell({ raw, keyPrefix }: { raw: string; keyPrefix: string }) {
  const { text, genericId } = extractRef(raw);
  const body = renderInline(text, keyPrefix);
  if (!genericId) return <>{body}</>;
  return (
    <Link href={`/medicine/${genericId}`} className="hover:underline">
      {body}
    </Link>
  );
}

/* -------------------------------------------------------------- blocks */

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] };

const splitRow = (line: string) =>
  line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());

const isDivider = (line: string) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');

function parse(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (!line.trim()) { i++; continue; }

    // Table: a header row followed by the |---|---| divider.
    if (line.trim().startsWith('|') && isDivider(lines[i + 1] ?? '')) {
      const head = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        rows.push(splitRow(lines[i]!));
        i++;
      }
      blocks.push({ kind: 'table', head, rows });
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'h', level: heading[1]!.length, text: heading[2]! });
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*\d+[.)]\s+/, ''));
        i++;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !lines[i]!.trim().startsWith('|')
           && !/^\s*[-*]\s+/.test(lines[i]!) && !/^#{1,4}\s/.test(lines[i]!)) {
      para.push(lines[i]!);
      i++;
    }
    if (para.length) blocks.push({ kind: 'p', lines: para });
  }

  return blocks;
}

/* --------------------------------------------------------------- view */

export function AnswerBody({ markdown }: { markdown: string }) {
  if (!markdown?.trim()) {
    return <p className="text-sm text-slate-400">No answer was produced.</p>;
  }

  const blocks = parse(markdown);

  return (
    <div className="space-y-4 text-[15px] leading-relaxed text-slate-700">
      {blocks.map((b, bi) => {
        const key = `b${bi}`;

        if (b.kind === 'table') {
          return (
            // Five columns of drug data do not fit a phone; the table scrolls
            // inside its own box rather than making the page scroll sideways.
            <div key={key} className="-mx-1 overflow-x-auto rounded-xl border-2 border-slate-200">
              <table className="w-full min-w-[34rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-200 bg-slate-50">
                    {b.head.map((h, hi) => (
                      <th
                        key={hi}
                        className={`px-3 py-2.5 text-left font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 ${
                          hi > 0 ? 'whitespace-nowrap' : ''
                        }`}
                      >
                        {extractRef(h).text}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((row, ri) => (
                    <tr key={ri} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                      {row.map((cell, ci) => (
                        <td
                          key={ci}
                          className={`px-3 py-2.5 align-top ${
                            ci === 0 ? 'font-medium text-navy-700' : 'text-slate-600'
                          } ${/^[৳$]?[\d.,]+$/.test(extractRef(cell).text) ? 'tabular whitespace-nowrap' : ''}`}
                        >
                          <Cell raw={cell} keyPrefix={`${key}-${ri}-${ci}`} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (b.kind === 'h') {
          return <h3 key={key} className="h-sub pt-1">{renderInline(b.text, key)}</h3>;
        }

        if (b.kind === 'ul' || b.kind === 'ol') {
          const List = b.kind === 'ul' ? 'ul' : 'ol';
          return (
            <List
              key={key}
              className={`space-y-1.5 pl-5 ${b.kind === 'ul' ? 'list-disc' : 'list-decimal'} marker:text-slate-300`}
            >
              {b.items.map((item, ii) => (
                <li key={ii}>
                  <Cell raw={item} keyPrefix={`${key}-${ii}`} />
                </li>
              ))}
            </List>
          );
        }

        return (
          <p key={key}>
            <Cell raw={b.lines.join(' ')} keyPrefix={key} />
          </p>
        );
      })}
    </div>
  );
}
