'use client';

import { useEffect, useState } from 'react';
import { api, ARCHITECTURE_LABELS, type Architecture, type RetrievalEval } from '@/lib/api';

interface EvalCase {
  id: number;
  question: string;
  expected_route: string | null;
  relevant_refs: string[];
  expected_contains: string[];
  notes: string | null;
}

interface AgentEvalSummary {
  architecture: Architecture;
  cases: number;
  routeAccuracy: number | null;
  answerAccuracy: number | null;
  avgRecall: number | null;
  avgNdcg: number | null;
  avgLatencyMs: number | null;
  totalCostUsd: number;
  avgSteps: number | null;
  failures: number;
  degraded: boolean;
  perCase: Array<{
    caseId: number; question: string; expectedRoute: string | null; actualRoute: string;
    routeCorrect: boolean | null; answerMatched: boolean; answerMisses: string[];
    recallAtK: number; latencyMs: number; costUsd: number; steps: number; answer: string;
  }>;
}

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);

export default function EvalPage() {
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [retrieval, setRetrieval] = useState<RetrievalEval | null>(null);
  const [agents, setAgents] = useState<{ summaries: AgentEvalSummary[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(6);

  useEffect(() => {
    api.get<{ cases: EvalCase[] }>('/eval/cases')
      .then((r) => setCases(r.cases))
      .catch((e: Error) => setError(e.message));
  }, []);

  async function run(what: 'retrieval' | 'agents') {
    setBusy(what);
    setError(null);
    try {
      if (what === 'retrieval') {
        setRetrieval(await api.post<RetrievalEval>('/eval/retrieval', { persist: true }));
      } else {
        setAgents(await api.post<{ summaries: AgentEvalSummary[] }>('/eval/architectures', {
          architectures: ['single', 'multi', 'baseline-no-tools'],
          limit,
          persist: true,
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const byRoute = cases.reduce<Record<string, number>>((acc, c) => {
    const k = c.expected_route ?? 'none';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Evaluate</h1>
        <p className="mt-1 text-sm text-ink-500">
          Retrieval quality and answer quality are separate failure modes, so they are scored
          separately. The retrieval pass costs nothing and spends no tokens; the architecture pass
          spends real ones.
        </p>
      </header>

      {error && <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="label">Gold set</span>
          <span className="chip">{cases.length} cases</span>
          {Object.entries(byRoute).map(([route, n]) => (
            <span key={route} className="chip">{route}: {n}</span>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------ retrieval */}
      <section className="card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Retrieval</h2>
            <p className="mt-1 text-xs text-ink-500">
              recall@k, precision@k, MRR and nDCG for each retrieval mode. nDCG is the one to watch:
              it penalises burying a relevant passage at rank 6 where context truncation may drop it.
            </p>
          </div>
          <button
            type="button"
            className="btn-primary shrink-0"
            onClick={() => void run('retrieval')}
            disabled={busy !== null}
          >
            {busy === 'retrieval' ? 'Scoring…' : 'Run retrieval eval'}
          </button>
        </div>

        {retrieval && (
          <div className="mt-4 space-y-4">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-ink-200">
                <thead className="bg-ink-50">
                  <tr>
                    <th className="th">Mode</th>
                    <th className="th text-right">Cases</th>
                    <th className="th text-right">Recall@{retrieval.topK}</th>
                    <th className="th text-right">Precision@{retrieval.topK}</th>
                    <th className="th text-right">MRR</th>
                    <th className="th text-right">nDCG</th>
                    <th className="th text-right">Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {retrieval.results.map((r) => (
                    <tr key={r.mode}>
                      <td className="td font-medium">{r.mode}</td>
                      <td className="td text-right font-mono">{r.cases}</td>
                      <td className="td text-right font-mono">{pct(r.avgRecall)}</td>
                      <td className="td text-right font-mono">{pct(r.avgPrecision)}</td>
                      <td className="td text-right font-mono">{pct(r.avgMrr)}</td>
                      <td className="td text-right font-mono">{pct(r.avgNdcg)}</td>
                      <td className="td text-right font-mono">
                        {r.avgLatencyMs === null ? '—' : `${Math.round(r.avgLatencyMs)} ms`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Zero-recall cases are where the real information is. */}
            {retrieval.results.map((r) => {
              const misses = r.perCase.filter((c) => c.recallAtK === 0);
              if (!misses.length) return null;
              return (
                <details key={r.mode} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                  <summary className="cursor-pointer text-sm text-amber-900">
                    {r.mode}: {misses.length} case(s) retrieved nothing relevant
                  </summary>
                  <ul className="mt-2 space-y-2">
                    {misses.map((m) => (
                      <li key={m.caseId} className="text-xs text-ink-700">
                        <div className="font-medium">{m.question}</div>
                        <div className="font-mono text-ink-500">
                          wanted [{m.relevant.join(', ')}] · got [{m.retrieved.slice(0, 4).join(', ')}]
                        </div>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        )}
      </section>

      {/* ------------------------------------------------ architectures */}
      <section className="card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Architectures</h2>
            <p className="mt-1 text-xs text-ink-500">
              End-to-end: route accuracy, substring answer assertions, citation recall, cost and
              latency per arm. The no-tools baseline is included on purpose — without it you cannot
              tell how much of a score came from retrieval.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label className="text-xs text-ink-500">
              cases
              <input
                type="number"
                min={1}
                max={30}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="ml-1 w-16 rounded border border-ink-300 px-2 py-1 text-xs"
              />
            </label>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void run('agents')}
              disabled={busy !== null}
            >
              {busy === 'agents' ? 'Running…' : 'Run architecture eval'}
            </button>
          </div>
        </div>

        {agents && (
          <div className="mt-4 space-y-4">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-ink-200">
                <thead className="bg-ink-50">
                  <tr>
                    <th className="th">Architecture</th>
                    <th className="th text-right">Cases</th>
                    <th className="th text-right">Route acc.</th>
                    <th className="th text-right">Answer acc.</th>
                    <th className="th text-right">Recall</th>
                    <th className="th text-right">nDCG</th>
                    <th className="th text-right">Steps</th>
                    <th className="th text-right">Latency</th>
                    <th className="th text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {agents.summaries.map((s) => (
                    <tr key={s.architecture}>
                      <td className="td font-medium">
                        {ARCHITECTURE_LABELS[s.architecture]}
                        {s.degraded && <span className="chip ml-1">mock</span>}
                        {s.failures > 0 && (
                          <span className="chip ml-1 border-red-200 bg-red-50 text-red-700">
                            {s.failures} failed
                          </span>
                        )}
                      </td>
                      <td className="td text-right font-mono">{s.cases}</td>
                      <td className="td text-right font-mono">{pct(s.routeAccuracy)}</td>
                      <td className="td text-right font-mono">{pct(s.answerAccuracy)}</td>
                      <td className="td text-right font-mono">{pct(s.avgRecall)}</td>
                      <td className="td text-right font-mono">{pct(s.avgNdcg)}</td>
                      <td className="td text-right font-mono">
                        {s.avgSteps === null ? '—' : s.avgSteps.toFixed(1)}
                      </td>
                      <td className="td text-right font-mono">
                        {s.avgLatencyMs === null ? '—' : `${Math.round(s.avgLatencyMs)} ms`}
                      </td>
                      <td className="td text-right font-mono">${s.totalCostUsd.toFixed(5)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {agents.summaries.map((s) => {
              const bad = s.perCase.filter(
                (c) => c.routeCorrect === false || (!c.answerMatched && c.answerMisses.length),
              );
              if (!bad.length) return null;
              return (
                <details key={s.architecture} className="rounded-md border border-ink-200 bg-ink-50 px-3 py-2">
                  <summary className="cursor-pointer text-sm text-ink-800">
                    {ARCHITECTURE_LABELS[s.architecture]}: {bad.length} case(s) with a miss
                  </summary>
                  <ul className="mt-2 space-y-3">
                    {bad.map((c) => (
                      <li key={c.caseId} className="text-xs">
                        <div className="font-medium text-ink-900">{c.question}</div>
                        {c.routeCorrect === false && (
                          <div className="text-amber-700">
                            route: expected {c.expectedRoute}, got {c.actualRoute}
                          </div>
                        )}
                        {c.answerMisses.length > 0 && (
                          <div className="text-amber-700">
                            missing from answer: {c.answerMisses.join(', ')}
                          </div>
                        )}
                        <p className="mt-1 whitespace-pre-wrap text-ink-500">{c.answer}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        )}
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold">Cases</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full divide-y divide-ink-200">
            <thead className="bg-ink-50">
              <tr>
                <th className="th">#</th>
                <th className="th">Question</th>
                <th className="th">Route</th>
                <th className="th">Relevant refs</th>
                <th className="th">Must contain</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {cases.map((c) => (
                <tr key={c.id}>
                  <td className="td font-mono text-xs text-ink-400">{c.id}</td>
                  <td className="td">
                    {c.question}
                    {c.notes && <div className="mt-0.5 text-xs text-ink-400">{c.notes}</div>}
                  </td>
                  <td className="td"><span className="chip">{c.expected_route ?? '—'}</span></td>
                  <td className="td font-mono text-xs">{c.relevant_refs.join(', ') || '—'}</td>
                  <td className="td font-mono text-xs">{c.expected_contains.join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
