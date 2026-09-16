'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, type Health } from '@/lib/api';
import { relativeTime, useHistory } from '@/lib/history';

/**
 * The user dashboard: what I asked, and what the assistant can cover.
 *
 * History comes from localStorage, not from `agent_runs` -- the runs table is
 * every run by everyone, including the eval harness. /dev/runs is the server-side
 * view of the same activity.
 */

function Stat({ value, label }: { value: number | undefined; label: string }) {
  return (
    <div className="card card-spine-navy px-4 py-3.5">
      <div className="stat-value">{value === undefined ? '—' : value.toLocaleString()}</div>
      <div className="stat-label mt-0.5">{label}</div>
    </div>
  );
}

export default function DashboardPage() {
  const { entries, clear, remove, loaded } = useHistory();
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    api.get<Health>('/health').then(setHealth).catch(() => setHealth(null));
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-8">
      <header>
        <h1 className="h-page">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Your recent questions, and what this assistant can answer from.
        </p>
      </header>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="h-sub">
            Recent questions{entries.length > 0 && (
              <span className="ml-2 text-xs font-normal text-slate-400">{entries.length}</span>
            )}
          </h2>
          {entries.length > 0 && (
            <button type="button" onClick={clear} className="text-xs text-slate-400 underline hover:text-navy-700">
              Clear history
            </button>
          )}
        </div>

        {!loaded ? (
          <div className="h-20 animate-pulse rounded-lg bg-slate-100" />
        ) : entries.length === 0 ? (
          <div className="card px-5 py-8 text-center">
            <p className="text-sm text-slate-500">You have not asked anything yet.</p>
            <Link href="/" className="mt-2 inline-block text-sm underline hover:text-navy-700">
              Ask your first question
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {entries.map((e) => (
              <li key={e.id} className="card card-hover group px-4 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-navy-700">{e.question}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-600">{e.answer}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span>{relativeTime(e.askedAt)}</span>
                      {e.citations.length > 0 && (
                        <span>
                          · {e.citations.length} source{e.citations.length === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(e.id)}
                    aria-label="Remove from history"
                    className="shrink-0 text-xs text-slate-300 opacity-0 transition group-hover:opacity-100 hover:text-navy-700"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {entries.length > 0 && (
          <p className="mt-3 text-xs text-slate-400">
            Saved in this browser only — clearing site data removes it.
          </p>
        )}
      </section>

      <section>
        <h2 className="h-sub mb-3">What it can answer from</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat value={health?.counts.brands} label="brands" />
          <Stat value={health?.counts.generics} label="generics" />
          <Stat value={health?.counts.companies} label="manufacturers" />
          <Stat value={health?.counts.documents} label="documents" />
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Questions are answered from this catalog and these documents — not from the model&apos;s
          own memory. Every answer lists the sources it used.
        </p>
      </section>
    </div>
  );
}
