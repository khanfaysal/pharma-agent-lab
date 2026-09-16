'use client';

import Link from 'next/link';
import type { AgentRunResult, AgentStep, Citation } from '@/lib/api';
import { AnswerBody } from './AnswerBody';

/**
 * Everything that visually belongs to the agent.
 *
 * The rule these components enforce: the violet-to-cyan gradient appears here
 * and nowhere else. A reader should be able to tell at a glance which parts of
 * a page were generated and which came straight out of the catalog, and that
 * distinction stops working the moment the accent leaks into ordinary chrome.
 */

/* ------------------------------------------------------------------ orb */

export function AgentOrb({ thinking = false, size = 28 }: { thinking?: boolean; size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={`agent-gradient inline-block shrink-0 rounded-full ${
        thinking ? 'animate-breathe' : ''
      }`}
    />
  );
}

/* -------------------------------------------------------- reasoning trace */

/**
 * Tool name to something a person would say they did.
 *
 * The raw step list is developer output -- `get_generic_detail`,
 * `hybrid_search` -- and showing it raw makes the agent look like a stack
 * trace. But hiding the steps entirely makes it look like a static FAQ bot.
 * The middle is a short, honest description of the actual lookup performed.
 */
const TOOL_NARRATION: Record<string, string> = {
  search_brands: 'Searched the brand registry',
  search_generics: 'Looked up the generic',
  get_generic_detail: 'Read the drug monograph',
  compare_brand_prices: 'Compared prices across brands',
  search_companies: 'Checked the manufacturer registry',
  search_by_indication: 'Cross-referenced indications',
  database_overview: 'Checked catalog coverage',
  semantic_search: 'Searched the document library',
  hybrid_search: 'Searched the document library',
  keyword_search: 'Searched the document library',
};

const ROUTE_NARRATION: Record<string, string> = {
  sql: 'Identified this as a catalog question',
  rag: 'Identified this as a policy question',
  hybrid: 'Identified this as needing both catalog and documents',
  none: 'Reviewed the question',
};

export interface TraceLine { text: string; done: boolean }

/** Collapse a raw step list into two or three lines worth reading. */
export function narrate(steps: AgentStep[], route?: string): TraceLine[] {
  const lines: TraceLine[] = [];

  if (route && ROUTE_NARRATION[route]) {
    lines.push({ text: ROUTE_NARRATION[route]!, done: true });
  }

  // Consecutive calls to the same tool are one action to a reader, not three.
  let last = '';
  for (const step of steps) {
    if (step.kind !== 'tool' || !step.toolName) continue;
    const text = TOOL_NARRATION[step.toolName] ?? `Queried ${step.toolName}`;
    if (text === last) continue;
    lines.push({ text, done: true });
    last = text;
  }

  return lines.slice(0, 4);
}

export function ReasoningTrace({
  lines, thinking = false,
}: { lines: TraceLine[]; thinking?: boolean }) {
  if (!lines.length && !thinking) return null;

  return (
    <ol className="space-y-1.5">
      {lines.map((line, i) => (
        <li key={i} className="trace-step">
          <span className="agent-gradient h-1.5 w-1.5 shrink-0 rounded-full" />
          {line.text}
        </li>
      ))}
      {thinking && (
        <li className="trace-step">
          <span className="agent-gradient h-1.5 w-1.5 shrink-0 animate-breathe rounded-full" />
          <span className="text-agent-ink">Working…</span>
        </li>
      )}
    </ol>
  );
}

/* ---------------------------------------------------------------- sources */

/**
 * Sources under every answer.
 *
 * This does more for trust than any amount of visual polish: a claim about a
 * dose is only worth reading if you can see which record it came from. Catalog
 * citations link back into the directory so the reader can verify without
 * taking the agent's word for it.
 */
export function Sources({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;

  // The agent cites every matching row; a reader wants the distinct records.
  const seen = new Map<string, Citation>();
  for (const c of citations) if (!seen.has(c.label)) seen.set(c.label, c);
  const unique = [...seen.values()].slice(0, 12);

  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <div className="label mb-2">Sources</div>
      <ul className="flex flex-wrap gap-1.5">
        {unique.map((c) => {
          const generic = c.ref.startsWith('generic:') ? c.ref.slice('generic:'.length) : null;
          const inner = (
            <>
              <span className="text-slate-400">{c.kind === 'sql' ? 'catalog' : 'document'}</span>
              {c.label}
            </>
          );
          return (
            <li key={c.ref}>
              {generic ? (
                <Link href={`/medicine/${generic}`} className="chip hover:border-navy-300 hover:text-navy-700">
                  {inner}
                </Link>
              ) : (
                <span className="chip" title={c.ref}>{inner}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------- disclaimer */

/**
 * Sits with the answer, not in the footer. A caveat a reader has to scroll to
 * find is a caveat that was not really given.
 */
export function AgentDisclaimer({ className = '' }: { className?: string }) {
  return (
    <p className={`text-xs leading-relaxed text-slate-500 ${className}`}>
      Generated from catalog records — not a substitute for professional medical advice.
      Confirm dosing and interactions with a pharmacist or physician.
    </p>
  );
}

/* ------------------------------------------------------------ answer card */

/**
 * Tell "the model was busy" apart from "we could not answer that".
 *
 * They need different words because they need different actions from the
 * reader. A 503 from an overloaded free-tier model has nothing to do with the
 * question, and telling someone to rephrase a perfectly good question because
 * the provider was saturated sends them off fixing the wrong thing.
 */
export function isTransientFailure(error?: string): boolean {
  if (!error) return false;
  return /(503|429|high demand|overload|unavailable|aborted|timeout|timed out|quota)/i.test(error);
}

export function FailureNotice({ error }: { error?: string }) {
  if (isTransientFailure(error)) {
    return (
      <div className="flag-caution">
        The assistant is busy right now — this usually clears in a moment. Try again, or
        browse the directory in the meantime.
      </div>
    );
  }
  return (
    <div className="flag-critical">
      That question could not be answered this time. Try rephrasing it, or browse the
      directory directly.
    </div>
  );
}

export function AnswerCard({
  run, showTrace = true,
}: { run: AgentRunResult; showTrace?: boolean }) {
  const lines = narrate(run.steps, run.route);

  if (run.status === 'error') return <FailureNotice error={run.error} />;

  return (
    <article className="agent-card">
      {showTrace && lines.length > 0 && (
        <div className="mb-4 border-b border-slate-100 pb-3">
          <ReasoningTrace lines={lines} />
        </div>
      )}

      <AnswerBody markdown={run.answer} />

      <AgentDisclaimer className="mt-4 border-t border-slate-100 pt-3" />
      <Sources citations={run.citations} />
    </article>
  );
}
