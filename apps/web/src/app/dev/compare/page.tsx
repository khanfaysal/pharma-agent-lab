'use client';

import { useState } from 'react';
import {
  ARCHITECTURE_BLURBS, ARCHITECTURE_LABELS, api,
  type Architecture, type ComparisonResult,
} from '@/lib/api';
import { Citations, Metrics, RouteBadge, StepTrace } from '@/components/RunTrace';

const ALL: Architecture[] = ['single', 'multi', 'router-only', 'baseline-no-tools'];

export default function ComparePage() {
  const [question, setQuestion] = useState('');
  const [selected, setSelected] = useState<Architecture[]>(['single', 'multi']);
  const [parallel, setParallel] = useState(false);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (a: Architecture) =>
    setSelected((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));

  async function compare() {
    if (!question.trim() || !selected.length || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.post<ComparisonResult>('/compare', {
        question: question.trim(), architectures: selected, parallel,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-mono text-2xl font-bold uppercase tracking-tight text-navy-900">Compare architectures</h1>
        <p className="mt-1 text-sm text-slate-500">
          Same question, same tools, same retrieval — different agent topology. Every arm is timed and
          priced through the same code path, so the differences are the architecture and not the harness.
        </p>
      </header>

      <form
        onSubmit={(e) => { e.preventDefault(); void compare(); }}
        className="card-dev space-y-4 p-4"
      >
        <div className="flex gap-2">
          <input
            className="input"
            placeholder="A question worth comparing — ideally one needing more than one lookup"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button type="submit" className="btn-primary shrink-0" disabled={loading || !question.trim() || !selected.length}>
            {loading ? `Running ${selected.length} arms…` : 'Compare'}
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-6">
          <div>
            <div className="label mb-1.5">Arms ({selected.length})</div>
            <div className="flex flex-wrap gap-1.5">
              {ALL.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => toggle(a)}
                  title={ARCHITECTURE_BLURBS[a]}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                    selected.includes(a)
                      ? 'border-navy-900 bg-navy-900 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {ARCHITECTURE_LABELS[a]}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={parallel}
              onChange={(e) => setParallel(e.target.checked)}
              className="rounded border-slate-300"
            />
            Run in parallel
            <span className="text-slate-400">(faster, but free-tier rate limits will skew latency)</span>
          </label>
        </div>
      </form>

      {error && <div className="card-dev alert-err p-4">{error}</div>}

      {result && (
        <>
          <div className="card-dev overflow-hidden">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Architecture</th>
                  <th className="th">Route</th>
                  <th className="th text-right">Latency</th>
                  <th className="th text-right">Tokens</th>
                  <th className="th text-right">Cost</th>
                  <th className="th text-right">Steps</th>
                  <th className="th text-right">Tools</th>
                  <th className="th text-right">Citations</th>
                  <th className="th">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.runs.map((run) => (
                  <tr key={run.architecture} className={run.status === 'error' ? 'bg-err-bg' : undefined}>
                    <td className="td font-medium">{ARCHITECTURE_LABELS[run.architecture]}</td>
                    <td className="td">{run.route}</td>
                    <td className="td text-right font-mono">{run.latencyMs.toLocaleString()} ms</td>
                    <td className="td text-right font-mono">
                      {(run.usage.promptTokens + run.usage.outputTokens).toLocaleString()}
                    </td>
                    <td className="td text-right font-mono">${run.costUsd.toFixed(6)}</td>
                    <td className="td text-right font-mono">{run.stepCount}</td>
                    <td className="td text-right font-mono">{run.toolsUsed.length}</td>
                    <td className="td text-right font-mono">{run.citations.length}</td>
                    <td className="td">{run.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex flex-wrap gap-4 border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {([
                ['cheapest', result.winners.cheapest],
                ['fastest', result.winners.fastest],
                ['most citations', result.winners.mostCitations],
                ['fewest steps', result.winners.fewestSteps],
              ] as const).map(([label, winner]) => (
                <span key={label}>
                  <span className="label">{label}:</span>{' '}
                  <span className={winner ? 'rounded bg-navy-50 px-1.5 py-0.5 font-medium text-navy-700' : 'text-slate-400'}>
                    {winner ?? '—'}
                  </span>
                </span>
              ))}
            </div>
          </div>

          <p className="text-xs text-slate-500">
            One question is an anecdote. For a defensible comparison run the full suite on the{' '}
            <a href="/dev/eval" className="underline">Evaluate</a> page, or{' '}
            <code className="font-mono">npm run eval -w @lab/api -- --agents</code>.
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            {result.runs.map((run) => (
              <div key={run.architecture} className="card-dev space-y-4 p-5">
                <div>
                  <div className="label">{ARCHITECTURE_LABELS[run.architecture]}</div>
                  <p className="mt-0.5 text-xs text-slate-400">{run.strategyLabel}</p>
                </div>

                <RouteBadge run={run} />

                {run.error ? (
                  <p className="rounded bg-err-bg px-3 py-2 font-mono text-xs text-err-fg">{run.error}</p>
                ) : (
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-navy-900">
                    {run.answer || <span className="text-slate-400">(empty answer)</span>}
                  </div>
                )}

                <Citations run={run} />
                <Metrics run={run} />
                <StepTrace steps={run.steps} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
