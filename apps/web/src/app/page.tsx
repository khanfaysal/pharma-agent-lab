'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, type AgentRunResult } from '@/lib/api';
import { recordRun } from '@/lib/history';
import { toChatBody, useSettings } from '@/lib/settings';

/**
 * The user surface: a question, and an answer.
 *
 * Everything that used to sit under the search box -- architecture buttons, the
 * router toggle, the step trace, cost and token counts -- has moved. The knobs
 * are in /settings, the instrumentation is under /dev. What is left is the part
 * a person actually came for.
 */

const EXAMPLES = [
  'Who manufactures Napa and what is its active ingredient?',
  'What is the cheapest alternative brand to Seclo?',
  'What is the renal dose of Ciprofloxacin?',
  'How long do you keep my search history?',
];

export default function AskPage() {
  const { settings } = useSettings();
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState('');
  const [run, setRun] = useState<AgentRunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    setRun(null);
    setAsked(trimmed);

    try {
      const result = await api.post<AgentRunResult>('/chat', toChatBody(trimmed, settings));
      setRun(result);
      if (result.status !== 'error') recordRun(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const idle = !run && !loading && !error;

  return (
    <div className={idle ? 'mx-auto max-w-2xl pt-12 sm:pt-20' : 'mx-auto max-w-2xl'}>
      {idle && (
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
            Ask about any medicine
          </h1>
          <p className="mt-2 text-sm text-ink-500">
            Brands, generics, dosing, interactions and prices — answered from a real catalog,
            with sources.
          </p>
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); void ask(question); }}
        className="flex gap-2"
      >
        <input
          className="input"
          placeholder="e.g. What is the cheapest alternative to Seclo?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          autoFocus
        />
        <button
          type="submit"
          className="btn-primary shrink-0"
          disabled={loading || !question.trim()}
        >
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </form>

      {idle && (
        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => { setQuestion(ex); void ask(ex); }}
              className="rounded-full border border-ink-200 bg-white px-3 py-1 text-xs text-ink-600 hover:bg-ink-100"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="mt-8 space-y-2" aria-live="polite">
          <div className="h-3 w-3/4 animate-pulse rounded bg-ink-100" />
          <div className="h-3 w-full animate-pulse rounded bg-ink-100" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-ink-100" />
        </div>
      )}

      {error && (
        <div className="card mt-8 border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Something went wrong answering that. Please try again.
          <p className="mt-1 font-mono text-xs text-red-600">{error}</p>
        </div>
      )}

      {run && (
        <div className="mt-8">
          <p className="text-sm text-ink-400">{asked}</p>

          {run.status === 'error' ? (
            <div className="card mt-3 border-red-200 bg-red-50 p-4 text-sm text-red-800">
              That question could not be answered this time. Please try rephrasing it.
              <p className="mt-2 text-xs text-red-600">
                Developers: the full trace is in{' '}
                <Link href="/dev/runs" className="underline">Runs</Link>
                {run.runId ? ` (run #${run.runId})` : ''}.
              </p>
            </div>
          ) : (
            <>
              <div className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-ink-900">
                {run.answer || <span className="text-ink-400">No answer was produced.</span>}
              </div>

              {run.citations.length > 0 && (
                <div className="mt-6 border-t border-ink-200 pt-4">
                  <div className="label mb-2">Sources</div>
                  <ul className="space-y-1.5">
                    {run.citations.map((c) => (
                      <li key={c.ref} className="text-sm text-ink-600">
                        <span className="chip mr-2">{c.kind === 'sql' ? 'catalog' : 'document'}</span>
                        {c.uri ? (
                          <a href={c.uri} className="underline hover:text-ink-900">{c.label}</a>
                        ) : (
                          c.label
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          <button
            type="button"
            onClick={() => { setRun(null); setQuestion(''); setAsked(''); }}
            className="mt-8 text-xs text-ink-400 underline hover:text-ink-700"
          >
            Ask something else
          </button>
        </div>
      )}
    </div>
  );
}
