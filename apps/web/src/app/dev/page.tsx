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
        <h1 className="text-xl font-semibold tracking-tight">Developer tools</h1>
        <p className="mt-1 text-sm text-ink-500">
          Instrumentation for the agent behind the user-facing app. Nothing here is visible at{' '}
          <Link href="/" className="underline">the front door</Link>.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        {TOOLS.map((t) => (
          <Link key={t.href} href={t.href} className="card block p-4 transition hover:border-ink-400">
            <div className="text-sm font-medium text-ink-900">{t.title}</div>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">{t.body}</p>
          </Link>
        ))}
      </section>

      {summary.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-ink-900">Recorded so far</h2>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs text-ink-500">
                  <th className="px-4 py-2 font-medium">Architecture</th>
                  <th className="px-4 py-2 text-right font-medium">Runs</th>
                  <th className="px-4 py-2 text-right font-medium">Avg latency</th>
                  <th className="px-4 py-2 text-right font-medium">Avg cost</th>
                  <th className="px-4 py-2 text-right font-medium">Avg steps</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((r) => (
                  <tr key={r.architecture} className="border-b border-ink-100 last:border-0">
                    <td className="px-4 py-2 text-ink-900">{r.architecture}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-600">{r.runs}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-600">
                      {Math.round(r.avg_latency_ms).toLocaleString()} ms
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-600">
                      ${r.avg_cost_usd.toFixed(5)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-600">
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
          <h2 className="mb-3 text-sm font-medium text-ink-900">Configuration</h2>
          <dl className="card divide-y divide-ink-100 text-sm">
            {[
              ['Database', health.database],
              ['Vector backend', health.vectorBackend === 'pgvector' ? 'pgvector (HNSW)' : 'float8[] fallback'],
              ['Embeddings', `${health.embeddings.provider}:${health.embeddings.model} · ${health.embeddings.dim}d · ${health.embeddings.cachedVectors.toLocaleString()} cached`],
              ['Providers', health.providers.join(', ')],
              ...health.tiers.map((t) => [`Tier: ${t.tier}`, t.degraded ? `${t.effective} (degraded)` : t.effective]),
            ].map(([k, v]) => (
              <div key={k} className="flex gap-4 px-4 py-2">
                <dt className="w-40 shrink-0 text-ink-500">{k}</dt>
                <dd className="font-mono text-xs text-ink-800">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
