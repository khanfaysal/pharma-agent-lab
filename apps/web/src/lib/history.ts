'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AgentRunResult, Citation } from './api';

/**
 * The asking history shown on the user dashboard.
 *
 * Kept in localStorage rather than read back from `agent_runs`, because
 * `agent_runs` is every run by everyone -- including the developer pages and
 * the eval harness. This is "questions *I* asked in this browser", which is the
 * only reading of history that means anything to a user with no account.
 *
 * The developer view of the same data is /dev/runs, which reads the server.
 */

export interface HistoryEntry {
  id: string;
  question: string;
  answer: string;
  citations: Citation[];
  architecture: string;
  runId: number | null;
  status: string;
  askedAt: number;
}

const KEY = 'pharma-agent-lab:history';
const LIMIT = 50;

function read(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, LIMIT)));
  } catch {
    // Quota or blocked storage. History is a convenience; losing it is fine.
  }
}

/** Append one run. Called by the landing page, not by the dashboard. */
export function recordRun(run: AgentRunResult): void {
  const entry: HistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    question: run.question,
    answer: run.answer,
    citations: run.citations,
    architecture: run.architecture,
    runId: run.runId,
    status: run.status,
    askedAt: Date.now(),
  };
  write([entry, ...read()]);
}

export function useHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setEntries(read());
    setLoaded(true);
  }, []);

  const clear = useCallback(() => {
    write([]);
    setEntries([]);
  }, []);

  const remove = useCallback((id: string) => {
    setEntries((prev) => {
      const next = prev.filter((e) => e.id !== id);
      write(next);
      return next;
    });
  }, []);

  return { entries, clear, remove, loaded };
}

export function relativeTime(ts: number): string {
  const secs = Math.round((Date.now() - ts) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
