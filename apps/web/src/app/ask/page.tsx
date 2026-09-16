'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api, type AgentRunResult } from '@/lib/api';
import { AnswerBody } from '@/components/AnswerBody';
import { recordRun } from '@/lib/history';
import { toChatBody, useSettings } from '@/lib/settings';
import {
  AgentDisclaimer, AgentOrb, FailureNotice, ReasoningTrace, Sources, narrate, type TraceLine,
} from '@/components/Agent';

/**
 * The conversational surface.
 *
 * Multi-turn is real, not cosmetic: every request carries a conversationId and
 * the API replays the last few exchanges into the transcript, so "what does it
 * cost?" resolves against the drug named two turns ago. Before that existed
 * this view would have looked like a chat and behaved like a search box, which
 * is worse than not offering it.
 */

interface Turn {
  id: string;
  question: string;
  run?: AgentRunResult;
  error?: string;
  pending: boolean;
}

const newConversationId = () =>
  `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function AskView() {
  const params = useSearchParams();
  const seeded = params.get('q') ?? '';
  const { settings } = useSettings();

  const [conversationId, setConversationId] = useState(newConversationId);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const busy = turns.some((t) => t.pending);

  const endRef = useRef<HTMLDivElement>(null);
  const seededRef = useRef(false);

  const send = useCallback(async (q: string, convId: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setTurns((prev) => [...prev, { id, question: trimmed, pending: true }]);
    setDraft('');

    try {
      const run = await api.post<AgentRunResult>('/chat', {
        ...toChatBody(trimmed, settings),
        conversationId: convId,
      });
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, run, pending: false } : t)));
      if (run.status !== 'error') recordRun(run);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, error: message, pending: false } : t)));
    }
  }, [settings]);

  // A question handed over from the home page starts the conversation.
  useEffect(() => {
    if (seeded && !seededRef.current) {
      seededRef.current = true;
      void send(seeded, conversationId);
    }
  }, [seeded, conversationId, send]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  function reset() {
    setConversationId(newConversationId());
    setTurns([]);
    setDraft('');
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-3xl flex-col px-6 py-8">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <AgentOrb size={26} thinking={busy} />
          <div>
            <h1 className="text-base font-semibold leading-tight">Assistant</h1>
            <p className="text-xs text-slate-500">
              {busy ? 'Checking the catalog…' : 'Ask follow-ups — it remembers the conversation.'}
            </p>
          </div>
        </div>
        {turns.length > 0 && (
          <button type="button" onClick={reset} className="btn-ghost text-xs">
            New conversation
          </button>
        )}
      </header>

      <div className="flex-1 space-y-6 pb-4">
        {turns.length === 0 && (
          <div className="card px-5 py-10 text-center">
            <AgentOrb size={32} />
            <p className="mt-3 text-sm text-slate-500">
              Ask about a brand, a generic, a dose, an interaction or a price.
            </p>
          </div>
        )}

        {turns.map((turn) => (
          <div key={turn.id} className="space-y-3">
            <div className="flex">
              <p className="bubble-user">{turn.question}</p>
            </div>

            {turn.pending && (
              <div className="bubble-agent">
                <ReasoningTrace lines={[]} thinking />
              </div>
            )}

            {turn.error && <FailureNotice error={turn.error} />}

            {turn.run && <AgentTurn run={turn.run} />}
          </div>
        ))}

        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); void send(draft, conversationId); }}
        className="sticky bottom-0 z-10 mt-6 flex gap-2 border-t border-slate-200 bg-canvas pb-5 pt-4"
      >
        <input
          className="input h-11 rounded-xl"
          placeholder={turns.length ? 'Ask a follow-up…' : 'Ask about a medicine…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
        />
        <button type="submit" className="btn-primary h-11 shrink-0 rounded-xl px-5" disabled={busy || !draft.trim()}>
          {busy ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}

/** One agent reply: trace, then answer, then sources and the caveat. */
function AgentTurn({ run }: { run: AgentRunResult }) {
  const lines: TraceLine[] = narrate(run.steps, run.route);

  if (run.status === 'error') return <FailureNotice error={run.error} />;

  return (
    <div className="space-y-2 [&_.bubble-agent]:max-w-none">
      {lines.length > 0 && (
        <div className="pl-1">
          <ReasoningTrace lines={lines} />
        </div>
      )}

      <div className="bubble-agent">
        <AnswerBody markdown={run.answer} />
        <AgentDisclaimer className="mt-4 border-t border-slate-100 pt-3" />
        <Sources citations={run.citations} />
      </div>
    </div>
  );
}

export default function AskPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-3xl px-6 py-8 text-sm text-slate-400">Loading…</div>}>
      <AskView />
    </Suspense>
  );
}
