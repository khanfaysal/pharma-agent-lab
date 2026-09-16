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
    <div className="rounded-lg border border-ink-200 bg-white px-4 py-3">
      <div className="text-lg font-semibold tabular-nums text-ink-900">
        {value === undefined ? '—' : value.toLocaleString()}
      </div>
      <div className="text-xs text-ink-500">{label}</div>
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
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-ink-500">
          Your recent questions, and what this assistant can answer from.
        </p>
      </header>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-ink-900">
            Recent questions{entries.length > 0 && (
              <span className="ml-2 text-xs font-normal text-ink-400">{entries.length}</span>
            )}
          </h2>
          {entries.length > 0 && (
            <button type="button" onClick={clear} className="text-xs text-ink-400 underline hover:text-ink-700">
              Clear history
            </button>
          )}
        </div>

        {!loaded ? (
          <div className="h-20 animate-pulse rounded-lg bg-ink-100" />
        ) : entries.length === 0 ? (
          <div className="card px-5 py-8 text-center">
            <p className="text-sm text-ink-500">You have not asked anything yet.</p>
            <Link href="/" className="mt-2 inline-block text-sm underline hover:text-ink-900">
              Ask your first question
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {entries.map((e) => (
              <li key={e.id} className="card group px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-900">{e.question}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-ink-600">{e.answer}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-400">
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
                    className="shrink-0 text-xs text-ink-300 opacity-0 transition group-hover:opacity-100 hover:text-ink-700"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {entries.length > 0 && (
          <p className="mt-3 text-xs text-ink-400">
            Saved in this browser only — clearing site data removes it.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-900">What it can answer from</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat value={health?.counts.brands} label="brands" />
          <Stat value={health?.counts.generics} label="generics" />
          <Stat value={health?.counts.companies} label="manufacturers" />
          <Stat value={health?.counts.documents} label="documents" />
        </div>
        <p className="mt-3 text-xs text-ink-400">
          Questions are answered from this catalog and these documents — not from the model&apos;s
          own memory. Every answer lists the sources it used.
        </p>
      </section>
    </div>
  );
}
