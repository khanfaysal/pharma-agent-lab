'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { api, money, type BrandRow, type GenericRow } from '@/lib/api';

/**
 * The directory proper. No agent, no generated text -- every row here is a
 * database record, and that is the point: it is the surface a reader can check
 * the assistant against.
 */

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const PAGE = 40;

function BrowseView() {
  const [view, setViewState] = useState<'generics' | 'brands'>('generics');
  const [letter, setLetterState] = useState('A');
  const [cls, setClsState] = useState('');
  const [q, setQ] = useState('');
  /** `q` is what is typed; `term` is what gets fetched. */
  const [term, setTerm] = useState('');

  // One request per pause, not one per keystroke. Every response used to
  // change the result count and therefore the page height.
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(q.trim());
      // Batched with setTerm, so this is still one render and one fetch.
      setOffset(0);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  // Changing a filter resets paging. Doing this here rather than in an effect
  // keeps it to a single fetch -- an effect that reset offset after the fact
  // fired a second request with the old offset first.
  const setView = (v: 'generics' | 'brands') => { setViewState(v); setOffset(0); };
  const setLetter = (l: string) => { setLetterState(l); setOffset(0); };
  const setCls = (c: string) => { setClsState(c); setOffset(0); };

  const [generics, setGenerics] = useState<GenericRow[]>([]);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [classes, setClasses] = useState<Array<{ name: string; n: number }>>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api.get<{ letters: Array<{ letter: string; n: number }> }>('/browse/letters')
      .then((r) => setCounts(Object.fromEntries(r.letters.map((l) => [l.letter, l.n]))))
      .catch(() => setCounts({}));
    api.get<{ classes: Array<{ name: string; n: number }> }>('/browse/classes')
      .then((r) => setClasses(r.classes))
      .catch(() => setClasses([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (view === 'brands') {
        // The brand list is search-driven; there is no useful A-Z over 28k rows.
        const searchTerm = term || letter;
        const r = await api.get<{ results: BrandRow[] }>(
          `/brands?q=${encodeURIComponent(searchTerm)}&limit=60`,
        );
        setBrands(r.results);
        setTotal(r.results.length);
      } else {
        const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
        if (term) params.set('q', term);
        else if (!cls) params.set('letter', letter);
        if (cls) params.set('class', cls);

        const r = await api.get<{ results: GenericRow[]; total: number }>(
          `/browse/generics?${params}`,
        );
        setGenerics(r.results);
        setTotal(r.total);
      }
    } catch {
      setGenerics([]); setBrands([]); setTotal(0);
    } finally {
      setLoading(false);
      setReady(true);
    }
  }, [view, letter, cls, term, offset]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="h-page">Browse medicines</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every record here comes straight from the catalog.
        </p>
      </header>

      {/* ------------------------------------------------- controls */}
      <div className="card mb-6 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
            {(['generics', 'brands'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${
                  view === v ? 'bg-navy-600 text-white' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          <input
            className="input max-w-xs"
            placeholder={view === 'brands' ? 'Search brand or manufacturer…' : 'Search generics…'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          {view === 'generics' && (
            <select
              className="input max-w-[16rem]"
              value={cls}
              onChange={(e) => setCls(e.target.value)}
            >
              <option value="">All therapeutic classes</option>
              {classes.map((c) => (
                <option key={c.name} value={c.name}>{c.name} ({c.n})</option>
              ))}
            </select>
          )}
        </div>

        {view === 'generics' && !q.trim() && !cls && (
          <div className="mt-3 flex flex-wrap gap-1">
            {LETTERS.map((l) => {
              const n = counts[l] ?? 0;
              return (
                <button
                  key={l}
                  type="button"
                  disabled={n === 0}
                  onClick={() => setLetter(l)}
                  title={n ? `${n} generics` : 'none'}
                  className={`h-7 w-7 rounded text-xs font-medium transition ${
                    letter === l ? 'bg-navy-600 text-white'
                      : n === 0 ? 'text-slate-300'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {l}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------- results */}
      {!ready ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      ) : (
      <div className={loading ? 'pointer-events-none opacity-60 transition-opacity' : 'transition-opacity'}>
      {view === 'generics' ? (
        <>
          <p className="eyebrow mb-3">
            {total.toLocaleString()} generic{total === 1 ? '' : 's'}
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {generics.map((g) => (
              <li key={g.generic_id}>
                <Link
                  href={`/medicine/${g.generic_id}`}
                  className="card card-hover flex items-center justify-between gap-3 px-4 py-3.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-navy-700">{g.generic_name}</div>
                    {g.therapeutic_classes && (
                      <div className="truncate text-xs text-slate-400">{g.therapeutic_classes}</div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-base font-bold tabular text-navy-700">{money(g.cheapest_brand_price)}</div>
                    <div className="stat-label mt-0.5">{g.brand_count} brands</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {total > PAGE && (
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button" className="btn-ghost text-xs"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE))}
              >
                Previous
              </button>
              <span className="text-xs tabular text-slate-500">
                {offset + 1}–{Math.min(offset + PAGE, total)} of {total.toLocaleString()}
              </span>
              <button
                type="button" className="btn-ghost text-xs"
                disabled={offset + PAGE >= total}
                onClick={() => setOffset(offset + PAGE)}
              >
                Next
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="th">Brand</th>
                <th className="th">Manufacturer</th>
                <th className="th">Generic</th>
                <th className="th">Form</th>
                <th className="th text-right">Price</th>
              </tr>
            </thead>
            <tbody>
              {brands.map((b) => (
                <tr key={b.brand_id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="td font-medium text-navy-700">{b.brand_name}</td>
                  <td className="td text-slate-500">{b.company_name}</td>
                  <td className="td">
                    {b.generic_id ? (
                      <Link href={`/medicine/${b.generic_id}`} className="link">{b.generic_name}</Link>
                    ) : b.generic_name}
                  </td>
                  <td className="td text-slate-500">
                    {[b.form, b.strength].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="td text-right tabular">{money(b.price_min)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {brands.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-400">
              No brands matched. Try a different spelling.
            </p>
          )}
        </div>
      )}
      </div>
      )}
    </div>
  );
}

export default function BrowsePage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-6 py-8 text-sm text-slate-400">Loading…</div>}>
      <BrowseView />
    </Suspense>
  );
}
