'use client';

import { useState } from 'react';
import { api, type DocChunk } from '@/lib/api';

type Mode = 'semantic' | 'lexical' | 'hybrid';

interface BrandRow {
  brand_id: number;
  brand_name: string;
  company_name: string;
  generic_name: string;
  form: string | null;
  strength: string | null;
  packsize: string | null;
  price_min: number | null;
  is_sponsored: boolean;
}

/**
 * Raw retrieval, no agent.
 *
 * Useful for two things: browsing the catalogue, and eyeballing what the
 * retriever actually returns for a query before blaming the model for a bad
 * answer. Switching between the three modes on one query is the fastest way to
 * see why hybrid fusion exists.
 */
export default function SearchPage() {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<Mode>('hybrid');
  const [docs, setDocs] = useState<DocChunk[] | null>(null);
  const [brands, setBrands] = useState<BrandRow[] | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (!q.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const [docRes, brandRes] = await Promise.all([
        api.get<{ results: DocChunk[]; latencyMs: number }>(
          `/search/documents?q=${encodeURIComponent(q)}&mode=${mode}&topK=8`,
        ),
        api.get<{ results: BrandRow[] }>(`/brands?q=${encodeURIComponent(q)}&limit=25`),
      ]);
      setDocs(docRes.results);
      setLatency(docRes.latencyMs);
      setBrands(brandRes.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Search</h1>
        <p className="mt-1 text-sm text-ink-500">
          Direct retrieval against both halves of the store — no agent, no model call. Switch modes on
          the same query to see where vector and keyword retrieval disagree.
        </p>
      </header>

      <form onSubmit={(e) => { e.preventDefault(); void search(); }} className="card space-y-3 p-4">
        <div className="flex gap-2">
          <input
            className="input"
            placeholder="Paracetamol, Square Pharmaceuticals, data retention, scraping…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="submit" className="btn-primary shrink-0" disabled={loading || !q.trim()}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="label">Document mode</span>
          {(['semantic', 'lexical', 'hybrid'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                mode === m
                  ? 'border-ink-800 bg-ink-800 text-white'
                  : 'border-ink-200 bg-white text-ink-600 hover:bg-ink-100'
              }`}
            >
              {m}
            </button>
          ))}
          {latency !== null && <span className="ml-auto text-xs text-ink-400">{latency} ms</span>}
        </div>
      </form>

      {error && <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2">
          <h2 className="label">
            Documents {docs && `(${docs.length})`}
          </h2>
          {docs?.length === 0 && (
            <p className="card p-4 text-sm text-ink-400">No passages matched.</p>
          )}
          {docs?.map((chunk) => (
            <article key={chunk.chunkId} className="card p-3">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium text-ink-900">{chunk.title}</h3>
                <span className="shrink-0 font-mono text-xs text-ink-400">
                  {chunk.score.toFixed(4)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <span className="chip">{chunk.sourceType}</span>
                <span className="chip">{chunk.matchedBy}</span>
                {chunk.heading && <span className="chip">{chunk.heading}</span>}
              </div>
              <p className="mt-2 line-clamp-6 whitespace-pre-wrap text-xs leading-relaxed text-ink-600">
                {chunk.content}
              </p>
            </article>
          ))}
        </section>

        <section className="space-y-2">
          <h2 className="label">Brands {brands && `(${brands.length})`}</h2>
          {brands?.length === 0 && (
            <p className="card p-4 text-sm text-ink-400">No brands matched.</p>
          )}
          {brands && brands.length > 0 && (
            <div className="card overflow-x-auto">
              <table className="min-w-full divide-y divide-ink-200">
                <thead className="bg-ink-50">
                  <tr>
                    <th className="th">Brand</th>
                    <th className="th">Generic</th>
                    <th className="th">Company</th>
                    <th className="th">Form</th>
                    <th className="th text-right">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {brands.map((b) => (
                    <tr key={b.brand_id}>
                      <td className="td">
                        <span className="font-medium">{b.brand_name}</span>
                        {b.is_sponsored && <span className="chip ml-1">sponsored</span>}
                        {b.strength && (
                          <div className="text-xs text-ink-400">{b.strength}</div>
                        )}
                      </td>
                      <td className="td text-xs">{b.generic_name}</td>
                      <td className="td text-xs">{b.company_name}</td>
                      <td className="td text-xs">{b.form ?? '—'}</td>
                      <td className="td text-right font-mono text-xs">
                        {b.price_min ?? '—'}
                        {b.packsize && <div className="text-ink-400">{b.packsize}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
