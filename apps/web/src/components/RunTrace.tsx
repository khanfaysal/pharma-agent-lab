'use client';

import { useState } from 'react';
import type { AgentRunResult, AgentStep } from '@/lib/api';

/**
 * Route identity. Same colour in the badge, the trace and the run history, so
 * "which path did this take" is answerable by scanning rather than reading.
 * Architectures deliberately stay neutral -- two categorical scales competing
 * on the compare page is how it turns into confetti.
 */
export const ROUTE_CHIP: Record<string, string> = {
  sql:    'border-route-sql/30    bg-route-sql/10    text-route-sql',
  rag:    'border-route-rag/30    bg-route-rag/10    text-route-rag',
  hybrid: 'border-route-hybrid/30 bg-route-hybrid/10 text-route-hybrid',
  none:   'border-route-none/30   bg-route-none/10   text-route-none',
};

export function routeChip(route: string): string {
  return ROUTE_CHIP[route] ?? ROUTE_CHIP.none!;
}

const KIND_COLOR: Record<string, string> = {
  route: 'border-route-none/30   bg-route-none/10   text-route-none',
  plan: 'border-route-sql/30    bg-route-sql/10    text-route-sql',
  llm: 'border-navy-300        bg-navy-50        text-navy-700',
  tool: 'border-route-rag/30    bg-route-rag/10    text-route-rag',
  synthesize: 'border-route-hybrid/30 bg-route-hybrid/10 text-route-hybrid',
  critique: 'border-slate-200         bg-slate-100         text-slate-800',
};

const fmtCost = (usd: number) => (usd === 0 ? '$0' : `$${usd.toFixed(6)}`);

export function Metrics({ run }: { run: AgentRunResult }) {
  const cells = [
    ['Latency', `${run.latencyMs.toLocaleString()} ms`],
    ['Cost', fmtCost(run.costUsd)],
    ['Tokens', (run.usage.promptTokens + run.usage.outputTokens).toLocaleString()],
    ['Steps', String(run.stepCount)],
    ['Tools', String(run.toolsUsed.length)],
    ['Citations', String(run.citations.length)],
  ] as const;

  return (
    <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-6">
      {cells.map(([label, value]) => (
        <div key={label} className="bg-white px-3 py-2">
          <dt className="label">{label}</dt>
          <dd className="mt-0.5 font-mono text-sm text-navy-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RouteBadge({ run }: { run: AgentRunResult }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className={`chip ${routeChip(run.route)}`}>route: {run.route}</span>
      <span className="chip">decided by: {run.routeDecidedBy}</span>
      {run.compactions > 0 && (
        <span className="chip" title="Older tool results were collapsed to fit the context budget">
          {run.compactions} compaction{run.compactions > 1 ? 's' : ''}
        </span>
      )}
      {run.status !== 'ok' && (
        <span className="chip-warn">{run.status}</span>
      )}
      {run.degraded && (
        <span className="chip-warn">mock model</span>
      )}
      <span className="text-slate-400">{run.routeReasoning}</span>
    </div>
  );
}

export function Citations({ run }: { run: AgentRunResult }) {
  if (!run.citations.length) return null;
  return (
    <div>
      <div className="label mb-1">Citations</div>
      <div className="flex flex-wrap gap-1.5">
        {run.citations.map((c) => (
          <span
            key={c.ref}
            className={`chip ${c.kind === 'sql' ? routeChip('sql') : routeChip('rag')}`}
            title={c.ref}
          >
            {c.kind === 'sql' ? '▤' : '¶'} {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The step-by-step trace.
 *
 * This is the whole reason the lab persists agent_steps: an answer alone tells
 * you nothing about *why* one architecture beat another. Seeing that the
 * multi-model arm spent three calls planning before its first tool call, or
 * that the single arm re-sent 8k tokens of transcript on every step, is where
 * the actual learning is.
 */
export function StepTrace({ steps }: { steps: AgentStep[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!steps.length) return null;

  return (
    <div>
      <div className="label mb-2">Trace ({steps.length} steps)</div>
      <ol className="space-y-1">
        {steps.map((step) => {
          const isOpen = open === step.stepIndex;
          const tokens = (step.usage?.promptTokens ?? 0) + (step.usage?.outputTokens ?? 0);
          return (
            <li key={step.stepIndex} className="overflow-hidden rounded-md border border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : step.stepIndex)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50"
              >
                <span className="w-5 shrink-0 font-mono text-xs text-slate-400">{step.stepIndex}</span>
                <span className={`chip shrink-0 border ${KIND_COLOR[step.kind] ?? KIND_COLOR.critique}`}>
                  {step.kind}
                </span>
                <span className="truncate text-sm text-slate-800">
                  {step.toolName ?? step.model ?? step.agentRole ?? '—'}
                  {step.agentRole && step.toolName ? (
                    <span className="text-slate-400"> · {step.agentRole}</span>
                  ) : null}
                </span>
                <span className="ml-auto shrink-0 font-mono text-xs text-slate-400">
                  {tokens > 0 && `${tokens} tok · `}
                  {step.costUsd ? `${fmtCost(step.costUsd)} · ` : ''}
                  {step.latencyMs ?? 0} ms
                </span>
                {step.error && <span className="chip border-err-br bg-err-bg text-err-fg">error</span>}
              </button>

              {isOpen && (
                <div className="space-y-2 border-t border-slate-200 bg-slate-50 px-3 py-2">
                  {step.error && (
                    <p className="rounded bg-err-bg px-2 py-1 font-mono text-xs text-err-fg">{step.error}</p>
                  )}
                  <Json label="input" value={step.input} />
                  <Json label="output" value={step.output} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div>
      <div className="label">{label}</div>
      <pre className="mt-1 max-h-72 overflow-auto rounded bg-white p-2 font-mono text-[11px] leading-relaxed text-slate-700">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
