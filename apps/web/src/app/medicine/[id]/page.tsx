'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, money, type AgentRunResult, type BrandRow, type GenericDetail } from '@/lib/api';
import { AnswerBody } from '@/components/AnswerBody';
import {
  AgentDisclaimer, AgentOrb, FailureNotice, ReasoningTrace, Sources, narrate,
} from '@/components/Agent';

/**
 * Medicine detail.
 *
 * Two kinds of content sit side by side here and must never be confusable:
 * the monograph on the left is verbatim catalog data, while the panel on the
 * right is generated. The gradient edge and the orb are the only things doing
 * that work, which is why they are reserved so strictly elsewhere.
 */

/** Monograph fields, in the order a clinician would read them. */
const SECTIONS: Array<{ key: keyof GenericDetail; title: string; tone?: 'caution' | 'critical' }> = [
  { key: 'indication', title: 'Indications' },
  { key: 'adult_dose', title: 'Adult dose' },
  { key: 'child_dose', title: 'Child dose' },
  { key: 'renal_dose', title: 'Renal dose' },
  { key: 'administration', title: 'Administration' },
  { key: 'mode_of_action', title: 'Mode of action' },
  { key: 'contra_indication', title: 'Contraindications', tone: 'critical' },
  { key: 'interaction', title: 'Interactions', tone: 'caution' },
  { key: 'precaution', title: 'Precautions', tone: 'caution' },
  { key: 'side_effect', title: 'Side effects', tone: 'caution' },
];

export default function MedicinePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [data, setData] = useState<{ generic: GenericDetail; brands: BrandRow[] } | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    api.get<{ generic: GenericDetail; brands: BrandRow[] }>(`/generics/${id}`)
      .then(setData)
      .catch(() => setNotFound(true));
  }, [id]);

  if (notFound) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <p className="text-sm text-slate-500">That medicine is not in the catalog.</p>
        <Link href="/browse" className="link mt-2 inline-block text-sm">Browse all medicines</Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-6xl space-y-3 px-6 py-8">
        <div className="h-8 w-64 animate-pulse rounded bg-slate-100" />
        <div className="h-40 animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  }

  const { generic: g, brands } = data;
  const cheapest = brands[0];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <nav className="mb-4 text-xs text-slate-400">
        <Link href="/browse" className="hover:text-navy-600">Medicines</Link>
        <span className="mx-1.5">/</span>
        <span className="text-slate-600">{g.generic_name}</span>
      </nav>

      <header className="mb-6">
        <h1 className="h-page">{g.generic_name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {g.therapeutic_classes?.split(', ').slice(0, 4).map((c) => (
            <span key={c} className="chip">{c}</span>
          ))}
          {g.pregnancy_category && (
            <span className="chip-caution" title={g.pregnancy_category_note ?? undefined}>
              Pregnancy category {g.pregnancy_category}
            </span>
          )}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        {/* ------------------------------------------ monograph (facts) */}
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              ['Brands', g.brand_count.toLocaleString()],
              ['From', money(g.cheapest_brand_price)],
              ['Cheapest', cheapest?.brand_name ?? '—'],
            ].map(([label, value]) => (
              <div key={label} className="card card-spine-navy px-4 py-3.5">
                <div className="stat-label">{label}</div>
                <div className="stat-value mt-1 truncate">{value}</div>
              </div>
            ))}
          </div>

          {SECTIONS.filter((s) => g[s.key]).map((s) => (
            <section
              key={String(s.key)}
              className={`card overflow-hidden ${
                s.tone === 'critical' ? 'card-spine-critical'
                : s.tone === 'caution' ? 'card-spine-caution'
                : ''
              }`}
            >
              <div className="card-head">
                <h2 className="card-title">{s.title}</h2>
                {s.tone === 'critical' && <span className="chip-critical">safety</span>}
                {s.tone === 'caution' && <span className="chip-caution">check</span>}
              </div>
              <p className="whitespace-pre-wrap px-5 py-4 text-sm leading-relaxed text-slate-600">
                {String(g[s.key])}
              </p>
            </section>
          ))}

          {brands.length > 0 && (
            <section className="card overflow-hidden">
              <div className="card-head">
                <h2 className="card-title">Available brands</h2>
                <span className="chip">{brands.length}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="th">Brand</th>
                      <th className="th">Manufacturer</th>
                      <th className="th">Form / strength</th>
                      <th className="th text-right">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {brands.slice(0, 30).map((b, i) => (
                      <tr key={b.brand_id} className={`border-b border-slate-100 last:border-0 ${i === 0 ? 'bg-safe-bg/40' : ''}`}>
                        <td className="td font-medium text-navy-700">
                          {b.brand_name}
                          {i === 0 && <span className="chip-safe ml-2">cheapest</span>}
                        </td>
                        <td className="td text-slate-500">{b.company_name}</td>
                        <td className="td text-slate-500">
                          {[b.form, b.strength, b.packsize].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td className="td text-right tabular">{money(b.price_min)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        {/* --------------------------------------- agent panel (generated) */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <AskAboutThis generic={g} onOpenChat={(q) =>
            router.push(`/ask?q=${encodeURIComponent(q)}`)} />
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ panel */

const PROMPTS = (name: string) => [
  { label: 'Cheaper alternatives', q: `What are the cheapest brands of ${name}, and how do they compare?` },
  { label: 'Interactions', q: `What drugs interact with ${name}, and how serious are they?` },
  { label: 'Dosing', q: `What is the adult and renal dose of ${name}?` },
  { label: 'Safety in pregnancy', q: `Is ${name} safe in pregnancy?` },
];

/**
 * The entry point into the agent from a drug page.
 *
 * Answers land in place rather than navigating away: the reader keeps the
 * monograph beside the generated text and can check one against the other.
 * "Continue in chat" hands the thread to /ask when they want follow-ups.
 */
function AskAboutThis({
  generic, onOpenChat,
}: { generic: GenericDetail; onOpenChat: (q: string) => void }) {
  const [run, setRun] = useState<AgentRunResult | null>(null);
  const [asked, setAsked] = useState('');
  const [loading, setLoading] = useState(false);

  async function ask(q: string) {
    setLoading(true); setRun(null); setAsked(q);
    try {
      setRun(await api.post<AgentRunResult>('/chat', { question: q, architecture: 'single' }));
    } catch {
      setRun(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="agent-card">
      <div className="mb-3 flex items-center gap-2">
        <AgentOrb size={20} thinking={loading} />
        <h2 className="font-display text-base font-bold tracking-tight text-agent-ink">
          Ask about {generic.generic_name}
        </h2>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {PROMPTS(generic.generic_name).map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => void ask(p.q)}
            disabled={loading}
            className="rounded-full border border-agent-tintEdge bg-agent-tint px-2.5 py-1 text-xs font-medium text-agent-ink transition hover:bg-white disabled:opacity-50"
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="mt-4">
          <ReasoningTrace lines={[]} thinking />
        </div>
      )}

      {run && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="mb-2 text-xs font-medium text-slate-400">{asked}</p>

          {run.status === 'error' ? (
            <FailureNotice error={run.error} />
          ) : (
            <>
              <ReasoningTrace lines={narrate(run.steps, run.route)} />
              <div className="mt-3 text-sm">
                <AnswerBody markdown={run.answer} />
              </div>
              <AgentDisclaimer className="mt-4 border-t border-slate-100 pt-3" />
              <Sources citations={run.citations} />
            </>
          )}

          <button
            type="button"
            onClick={() => onOpenChat(asked)}
            className="mt-3 text-xs font-medium text-agent-ink hover:underline"
          >
            Continue in chat →
          </button>
        </div>
      )}

    </div>
  );
}
