'use client';

import { useState } from 'react';
import {
  ARCHITECTURE_BLURBS, ARCHITECTURE_LABELS, api,
  type AgentRunResult, type Architecture,
} from '@/lib/api';
import { Citations, Metrics, RouteBadge, StepTrace } from '@/components/RunTrace';

const ARCHITECTURES: Architecture[] = ['single', 'multi', 'router-only', 'baseline-no-tools'];

const EXAMPLES = [
  'Who manufactures Napa and what is its active ingredient?',
  'What is the cheapest alternative brand to Seclo?',
  'How long do you keep my search history?',
  'What is the renal dose of Ciprofloxacin?',
  'Am I allowed to scrape the database?',
  'How current is your price data, and what does Napa cost?',
];

export default function AskPage() {
  const [question, setQuestion] = useState('');
  const [architecture, setArchitecture] = useState<Architecture>('single');
  const [useModelRouter, setUseModelRouter] = useState(true);
  const [run, setRun] = useState<AgentRunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(q: string) {
    if (!q.trim() || loading) return;
    setLoading(true);
    setError(null);
    setRun(null);
    try {
      setRun(await api.post<AgentRunResult>('/chat', {
        question: q.trim(), architecture, useModelRouter,
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
        <h1 className="font-mono text-2xl font-bold uppercase tracking-tight text-navy-900">Ask the agent</h1>
        <p className="mt-1 text-sm text-slate-500">
          One question, one architecture, with the full trace. Use{' '}
          <a href="/dev/compare" className="underline">Compare</a> to run several architectures side by side.
        </p>
      </header>

      <form
        onSubmit={(e) => { e.preventDefault(); void ask(question); }}
        className="card-dev space-y-4 p-4"
      >
        <div className="flex gap-2">
          <input
            className="input"
            placeholder="e.g. Which company makes Seclo, and what does the cheapest equivalent cost?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button type="submit" className="btn-primary shrink-0" disabled={loading || !question.trim()}>
            {loading ? 'Running…' : 'Ask'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <div>
            <div className="label mb-1.5">Architecture</div>
            <div className="flex flex-wrap gap-1.5">
              {ARCHITECTURES.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setArchitecture(a)}
                  title={ARCHITECTURE_BLURBS[a]}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                    architecture === a
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
              checked={useModelRouter}
              onChange={(e) => setUseModelRouter(e.target.checked)}
              className="rounded border-slate-300"
            />
            LLM router
            <span className="text-slate-400">(off = keyword heuristic)</span>
          </label>
        </div>

        <p className="text-xs text-slate-500">{ARCHITECTURE_BLURBS[architecture]}</p>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => { setQuestion(ex); void ask(ex); }}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
          >
            {ex}
          </button>
        ))}
      </div>

      {error && (
        <div className="card-dev alert-err p-4">{error}</div>
      )}

      {run && (
        <div className="space-y-4">
          <div className="card-dev space-y-4 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="label">{ARCHITECTURE_LABELS[run.architecture]}</div>
                <p className="mt-0.5 text-xs text-slate-400">{run.strategyLabel}</p>
              </div>
              {run.runId && <span className="chip">run #{run.runId}</span>}
            </div>

            <RouteBadge run={run} />

            {run.error ? (
              <p className="rounded bg-err-bg px-3 py-2 font-mono text-sm text-err-fg">{run.error}</p>
            ) : (
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-navy-900">
                {run.answer || <span className="text-slate-400">(empty answer)</span>}
              </div>
            )}

            <Citations run={run} />
            <Metrics run={run} />
          </div>

          {run.gathered.length > 0 && (
            <div className="card-dev p-5">
              <div className="label mb-2">Retrieved evidence ({run.gathered.length})</div>
              <div className="space-y-2">
                {run.gathered.map((g, i) => (
                  <details key={i} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <summary className="cursor-pointer text-sm text-slate-800">
                      <span className="chip mr-2">{g.name}</span>
                      {g.summary}
                    </summary>
                    <pre className="mt-2 max-h-80 overflow-auto rounded bg-white p-2 font-mono text-[11px] text-slate-700">
                      {JSON.stringify(g.data, null, 2)}
                    </pre>
                  </details>
                ))}
              </div>
            </div>
          )}

          <div className="card-dev p-5">
            <StepTrace steps={run.steps} />
          </div>
        </div>
      )}
    </div>
  );
}
