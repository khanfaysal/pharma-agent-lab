'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type AgentStep, type RunSummaryRow } from '@/lib/api';
import { StepTrace } from '@/components/RunTrace';

interface RunRow {
  id: number;
  comparison_id: string | null;
  architecture: string;
  strategy_label: string;
  question: string;
  answer_preview: string | null;
  tools_used: string[];
  step_count: number;
  prompt_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number;
  status: string;
  created_at: string;
}

interface RunDetail {
  run: Record<string, unknown> & { answer: string | null; metadata: Record<string, unknown> };
  steps: Array<Record<string, unknown>>;
}

export default function RunsPage() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [summary, setSummary] = useState<RunSummaryRow[]>([]);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api.get<{ runs: RunRow[] }>('/runs?limit=60'),
      api.get<{ summary: RunSummaryRow[] }>('/runs/summary'),
    ])
      .then(([r, s]) => { setRuns(r.runs); setSummary(s.summary); })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  async function open(id: number) {
    if (selected === id) { setSelected(null); setDetail(null); return; }
    setSelected(id);
    setDetail(null);
    try {
      setDetail(await api.get<RunDetail>(`/runs/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-2xl font-bold uppercase tracking-tight text-navy-900">Runs</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every agent invocation, with its per-step trace. This is the record that makes any
            after-the-fact comparison possible.
          </p>
        </div>
        <button type="button" className="btn-ghost shrink-0" onClick={load}>Refresh</button>
      </header>

      {error && <div className="card-dev alert-err p-4">{error}</div>}

      {summary.length > 0 && (
        <section className="card-dev overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Architecture</th>
                <th className="th">Strategy</th>
                <th className="th text-right">Runs</th>
                <th className="th text-right">Avg latency</th>
                <th className="th text-right">Avg steps</th>
                <th className="th text-right">Avg tokens</th>
                <th className="th text-right">Avg cost</th>
                <th className="th text-right">Total cost</th>
                <th className="th text-right">Failures</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.map((row) => (
                <tr key={`${row.architecture}-${row.strategy_label}`}>
                  <td className="td font-medium">{row.architecture}</td>
                  <td className="td text-xs text-slate-500">{row.strategy_label}</td>
                  <td className="td text-right font-mono">{row.runs}</td>
                  <td className="td text-right font-mono">{row.avg_latency_ms} ms</td>
                  <td className="td text-right font-mono">{row.avg_steps}</td>
                  <td className="td text-right font-mono">{row.avg_tokens}</td>
                  <td className="td text-right font-mono">${Number(row.avg_cost_usd).toFixed(6)}</td>
                  <td className="td text-right font-mono">${Number(row.total_cost_usd).toFixed(4)}</td>
                  <td className="td text-right font-mono">{row.failures}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="space-y-2">
        {runs.length === 0 && (
          <p className="card-dev p-4 text-sm text-slate-400">
            No runs yet. Ask something on the <a href="/" className="underline">Ask</a> page.
          </p>
        )}

        {runs.map((run) => (
          <div key={run.id} className="card-dev overflow-hidden">
            <button
              type="button"
              onClick={() => void open(run.id)}
              className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50"
            >
              <span className="w-10 shrink-0 font-mono text-xs text-slate-400">#{run.id}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-navy-900">{run.question}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="chip">{run.architecture}</span>
                  {run.comparison_id && <span className="chip">comparison</span>}
                  {run.tools_used.map((t, i) => (
                    <span key={`${t}-${i}`} className="chip">{t}</span>
                  ))}
                  {run.status !== 'ok' && (
                    <span className="chip border-warn-br bg-warn-bg text-warn-fg">{run.status}</span>
                  )}
                </span>
              </span>
              <span className="shrink-0 text-right font-mono text-xs text-slate-400">
                <span className="block">{run.latency_ms.toLocaleString()} ms</span>
                <span className="block">{(run.prompt_tokens + run.output_tokens).toLocaleString()} tok</span>
                <span className="block">${Number(run.cost_usd).toFixed(6)}</span>
              </span>
            </button>

            {selected === run.id && (
              <div className="space-y-4 border-t border-slate-200 bg-slate-50 px-4 py-4">
                {!detail && <p className="text-sm text-slate-400">Loading…</p>}
                {detail && (
                  <>
                    <div>
                      <div className="label mb-1">Answer</div>
                      <p className="whitespace-pre-wrap text-sm text-slate-800">
                        {detail.run.answer || '(empty)'}
                      </p>
                    </div>
                    <div>
                      <div className="label mb-1">Metadata</div>
                      <pre className="overflow-auto rounded bg-white p-2 font-mono text-[11px] text-slate-700">
                        {JSON.stringify(detail.run.metadata, null, 2)}
                      </pre>
                    </div>
                    <StepTrace
                      steps={detail.steps.map((s): AgentStep => ({
                        stepIndex: Number(s.step_index),
                        kind: String(s.kind),
                        agentRole: (s.agent_role as string) ?? undefined,
                        provider: (s.provider as string) ?? undefined,
                        model: (s.model as string) ?? undefined,
                        toolName: (s.tool_name as string) ?? undefined,
                        input: s.input,
                        output: s.output,
                        usage: {
                          promptTokens: Number(s.prompt_tokens ?? 0),
                          outputTokens: Number(s.output_tokens ?? 0),
                        },
                        costUsd: Number(s.cost_usd ?? 0),
                        latencyMs: Number(s.latency_ms ?? 0),
                        error: (s.error as string) ?? undefined,
                      }))}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
