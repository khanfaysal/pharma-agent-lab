'use client';

import { useState } from 'react';
import type { AgentRunResult, AgentStep } from '@/lib/api';

const KIND_COLOR: Record<string, string> = {
  route: 'bg-purple-100 text-purple-800 border-purple-200',
  plan: 'bg-blue-100 text-blue-800 border-blue-200',
  llm: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  tool: 'bg-amber-100 text-amber-800 border-amber-200',
  synthesize: 'bg-rose-100 text-rose-800 border-rose-200',
  critique: 'bg-ink-100 text-ink-800 border-ink-200',
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
    <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-ink-200 bg-ink-200 sm:grid-cols-6">
      {cells.map(([label, value]) => (
        <div key={label} className="bg-white px-3 py-2">
          <dt className="label">{label}</dt>
          <dd className="mt-0.5 font-mono text-sm text-ink-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RouteBadge({ run }: { run: AgentRunResult }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="chip">route: {run.route}</span>
      <span className="chip">decided by: {run.routeDecidedBy}</span>
      {run.compactions > 0 && (
        <span className="chip" title="Older tool results were collapsed to fit the context budget">
          {run.compactions} compaction{run.compactions > 1 ? 's' : ''}
        </span>
      )}
      {run.status !== 'ok' && (
        <span className="chip border-amber-300 bg-amber-100 text-amber-900">{run.status}</span>
      )}
      {run.degraded && (
        <span className="chip border-amber-300 bg-amber-100 text-amber-900">mock model</span>
      )}
      <span className="text-ink-400">{run.routeReasoning}</span>
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
            className={`chip ${c.kind === 'sql' ? 'border-sky-200 bg-sky-50 text-sky-800' : 'border-violet-200 bg-violet-50 text-violet-800'}`}
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
            <li key={step.stepIndex} className="overflow-hidden rounded-md border border-ink-200 bg-white">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : step.stepIndex)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-ink-50"
              >
                <span className="w-5 shrink-0 font-mono text-xs text-ink-400">{step.stepIndex}</span>
                <span className={`chip shrink-0 border ${KIND_COLOR[step.kind] ?? KIND_COLOR.critique}`}>
                  {step.kind}
                </span>
                <span className="truncate text-sm text-ink-800">
                  {step.toolName ?? step.model ?? step.agentRole ?? '—'}
                  {step.agentRole && step.toolName ? (
                    <span className="text-ink-400"> · {step.agentRole}</span>
                  ) : null}
                </span>
                <span className="ml-auto shrink-0 font-mono text-xs text-ink-400">
                  {tokens > 0 && `${tokens} tok · `}
                  {step.costUsd ? `${fmtCost(step.costUsd)} · ` : ''}
                  {step.latencyMs ?? 0} ms
                </span>
                {step.error && <span className="chip border-red-200 bg-red-50 text-red-700">error</span>}
              </button>

              {isOpen && (
                <div className="space-y-2 border-t border-ink-200 bg-ink-50 px-3 py-2">
                  {step.error && (
                    <p className="rounded bg-red-50 px-2 py-1 font-mono text-xs text-red-700">{step.error}</p>
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
      <pre className="mt-1 max-h-72 overflow-auto rounded bg-white p-2 font-mono text-[11px] leading-relaxed text-ink-700">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
