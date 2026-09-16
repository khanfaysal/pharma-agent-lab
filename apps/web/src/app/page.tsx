'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, money, type GenericRow, type Health } from '@/lib/api';
import { AgentOrb } from '@/components/Agent';

/**
 * Home.
 *
 * The agent is the headline, but the directory bones stay visible underneath --
 * a search box, browse-by-letter, a route into the catalog. Someone who does
 * not want to talk to an AI can still use this as the medicine directory they
 * came for, which is the whole reason the agent is layered on rather than put
 * in the way.
 */

const SUGGESTIONS = [
  'What is the cheapest alternative to Seclo?',
  'Can I take Napa with Ciprofloxacin?',
  'What is the renal dose of Ciprofloxacin?',
  'Which brands contain Paracetamol?',
];

export default function HomePage() {
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const [health, setHealth] = useState<Health | null>(null);
  const [popular, setPopular] = useState<GenericRow[]>([]);

  useEffect(() => {
    api.get<Health>('/health').then(setHealth).catch(() => setHealth(null));
    api.get<{ results: GenericRow[] }>('/browse/generics?limit=8&class=Non-steroidal')
      .then((r) => setPopular(r.results))
      .catch(() => setPopular([]));
  }, []);

  function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    router.push(`/ask?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <div>
      {/* ------------------------------------------------------- hero */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl px-6 pb-12 pt-14 text-center sm:pt-20">
          <div className="mb-5 flex items-center justify-center gap-2">
            <AgentOrb size={22} />
            <span className="eyebrow text-agent-ink">AI assistant</span>
          </div>

          <h1 className="h-page leading-[1.08] sm:text-5xl">
            Ask anything about a medicine.
            <br />
            <span className="text-slate-400">Get an answer with its sources.</span>
          </h1>

          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-slate-500">
            Brands, generics, dosing, interactions and prices — checked against a verified
            catalog of {health?.counts.brands?.toLocaleString() ?? '28,000+'} brands, never
            answered from memory alone.
          </p>

          <form
            onSubmit={(e) => { e.preventDefault(); ask(question); }}
            className="mx-auto mt-8 flex max-w-xl gap-2"
          >
            <input
              className="input h-12 rounded-xl px-4 text-base shadow-sm"
              placeholder="e.g. Can I take Napa with Ciprofloxacin?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              autoFocus
            />
            <button type="submit" className="btn-primary h-12 shrink-0 rounded-xl px-6" disabled={!question.trim()}>
              Ask
            </button>
          </form>

          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => ask(s)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 transition hover:border-agent-tintEdge hover:text-agent-ink"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------- directory bones */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="h-section">Or browse the directory</h2>
          <Link href="/browse" className="link text-sm">See all medicines →</Link>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {[
            { href: '/browse', title: 'By generic', body: 'Every active ingredient, A to Z, with brand counts and price ranges.', stat: health?.counts.generics },
            { href: '/browse?view=brands', title: 'By brand', body: 'Trade names with manufacturer, form, strength and pack price.', stat: health?.counts.brands },
            { href: '/browse?view=classes', title: 'By therapeutic class', body: 'NSAIDs, antibiotics, antihypertensives and the rest of the tree.', stat: health?.counts.companies },
          ].map((c) => (
            <Link key={c.href} href={c.href} className="card card-hover card-spine-navy p-5">
              <div className="h-sub text-lg">{c.title}</div>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{c.body}</p>
              {c.stat !== undefined && (
                <div className="mt-4 flex items-baseline gap-1.5">
                  <span className="stat-value text-xl">{c.stat.toLocaleString()}</span>
                  <span className="stat-label">entries</span>
                </div>
              )}
            </Link>
          ))}
        </div>

        {popular.length > 0 && (
          <div className="mt-10">
            <h3 className="h-sub">Commonly looked up</h3>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {popular.map((g) => (
                <li key={g.generic_id}>
                  <Link
                    href={`/medicine/${g.generic_id}`}
                    className="card card-hover flex items-baseline justify-between gap-2 px-4 py-3"
                  >
                    <span className="truncate text-sm font-semibold text-navy-700">{g.generic_name}</span>
                    <span className="shrink-0 text-sm font-bold tabular text-slate-500">
                      {money(g.cheapest_brand_price)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
