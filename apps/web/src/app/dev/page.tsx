'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, type Health, type RunSummaryRow } from '@/lib/api';

/**
 * Developer index.
 *
 * The user surface hides all of this on purpose. Here it is the point: what the
 * agent did, what it cost, and whether the architecture you picked is actually
 * better than the one you did not.
 */

const TOOLS = [
  {
    href: '/dev/ask',
    title: 'Ask + trace',
    body: 'One question, one architecture, every step — the model calls, the tool calls, the tokens and the cost of each.',
  },
  {
    href: '/dev/compare',
    title: 'Compare',
    body: 'The same question through several architectures side by side, with the cheapest, fastest and best-cited arm called out.',
  },
  {
    href: '/dev/search',
    title: 'Retrieval',
    body: 'Semantic, lexical and hybrid search without the agent. Use it to tell a retrieval problem apart from a generation problem.',
  },
  {
    href: '/dev/eval',
    title: 'Evaluate',
    body: 'The graded suite: recall@k, precision@k, MRR and nDCG for retrieval; route accuracy and answer matching for the arms.',
  },
  {
    href: '/dev/runs',
    title: 'Runs',
    body: 'Every run ever recorded, and aggregate cost and latency by architecture.',
  },
];

export default function DevIndexPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [summary, setSummary] = useState<RunSummaryRow[]>([]);

  useEffect(() => {
    api.get<Health>('/health').then(setHealth).catch(() => setHealth(null));
    api.get<{ summary: RunSummaryRow[] }>('/runs/summary')
      .then((r) => setSummary(r.summary))
      .catch(() => setSummary([]));
  }, []);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-mono text-2xl font-bold uppercase tracking-tight text-navy-900">
          Developer tools
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Instrumentation for the agent behind the user-facing app. Nothing here is visible at{' '}
          <Link href="/" className="underline">the front door</Link>.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        {TOOLS.map((t) => (
          <Link key={t.href} href={t.href} className="card-dev card-dev-hover block overflow-hidden">
            <div className="card-dev-head">{t.title}</div>
            <p className="px-4 py-3 text-xs leading-relaxed text-slate-600">{t.body}</p>
          </Link>
        ))}
      </section>

      {summary.length > 0 && (
        <section>
          <h2 className="eyebrow mb-3 text-navy-900">Recorded so far</h2>
          <div className="card-dev overflow-x-auto">
            <table className="w-full font-mono text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="px-4 py-2 font-medium">Architecture</th>
                  <th className="px-4 py-2 text-right font-medium">Runs</th>
                  <th className="px-4 py-2 text-right font-medium">Avg latency</th>
                  <th className="px-4 py-2 text-right font-medium">Avg cost</th>
                  <th className="px-4 py-2 text-right font-medium">Avg steps</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((r) => (
                  <tr key={r.architecture} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2 text-navy-900">{r.architecture}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">{r.runs}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                      {Math.round(r.avg_latency_ms).toLocaleString()} ms
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                      ${r.avg_cost_usd.toFixed(5)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                      {r.avg_steps.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {health && (
        <section>
          <h2 className="eyebrow mb-3 text-navy-900">Configuration</h2>
          <dl className="card-dev divide-y divide-slate-100 font-mono text-sm">
            {[
              ['Database', health.database],
              ['Vector backend', health.vectorBackend === 'pgvector' ? 'pgvector (HNSW)' : 'float8[] fallback'],
              ['Embeddings', `${health.embeddings.provider}:${health.embeddings.model} · ${health.embeddings.dim}d · ${health.embeddings.cachedVectors.toLocaleString()} cached`],
              ['Providers', health.providers.join(', ')],
              ...health.tiers.map((t) => [`Tier: ${t.tier}`, t.degraded ? `${t.effective} (degraded)` : t.effective]),
            ].map(([k, v]) => (
              <div key={k} className="flex gap-4 px-4 py-2">
                <dt className="w-40 shrink-0 text-slate-500">{k}</dt>
                <dd className="font-mono text-xs text-slate-800">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
