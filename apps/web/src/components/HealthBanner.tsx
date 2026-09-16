'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, type Health } from '@/lib/api';

/**
 * Standing status strip.
 *
 * Its main job is the degraded warning: if no API key is configured the agent
 * silently falls back to the mock provider, and a comparison run in that state
 * measures stubs, not models. That has to be impossible to miss.
 *
 * Two forms. Under /dev it is the full status strip -- row counts, vector
 * backend, embedding model, resolved tiers -- because that is exactly what a
 * developer needs standing in front of them. On the user surface it renders
 * nothing at all unless something is wrong, since row counts and tier names
 * mean nothing to someone who just wants an answer.
 */
export function HealthBanner() {
  const pathname = usePathname() ?? '/';
  const full = pathname === '/dev' || pathname.startsWith('/dev/');
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Health>('/health')
      .then(setHealth)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-800">
        <span className="mx-auto block max-w-7xl">
          {full ? (
            <>Cannot reach the API ({error}). Start it with <code className="font-mono">npm run dev:api</code>.</>
          ) : (
            <>The assistant is offline right now. Please try again shortly.</>
          )}
        </span>
      </div>
    );
  }

  if (!health) return full ? <div className="h-9 border-b border-ink-200 bg-white" /> : null;

  // User surface: silence unless the answers would be stubs.
  if (!full) {
    if (!health.degraded) return null;
    return (
      <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
        <span className="mx-auto block max-w-7xl">
          <strong>Demo mode.</strong> No model is configured, so answers are placeholders rather
          than real results.
        </span>
      </div>
    );
  }

  return (
    <div className="border-b border-ink-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-6 py-2 text-xs text-ink-500">
        <span className="chip">
          {health.counts.brands?.toLocaleString()} brands · {health.counts.generics?.toLocaleString()} generics
        </span>
        <span className="chip">{health.counts.chunks} chunks</span>
        <span className="chip">
          vectors: {health.vectorBackend === 'pgvector' ? 'pgvector HNSW' : 'float8[] fallback'}
        </span>
        <span className="chip">
          {health.embeddings.provider}:{health.embeddings.model} · {health.embeddings.dim}d
        </span>
        <span className="ml-auto">
          {health.tiers.map((t) => `${t.tier}=${t.effective}`).join('  ')}
        </span>
      </div>

      {health.degraded && (
        <div className="border-t border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
          <span className="mx-auto block max-w-7xl">
            <strong>Degraded mode.</strong> No provider key is configured, so every model call is
            answered by the deterministic mock and embeddings are hashed bag-of-words. The pipeline
            runs end to end, but any comparison you make here compares stubs. Set{' '}
            <code className="font-mono">GEMINI_API_KEY</code> in <code className="font-mono">.env</code>,
            restart the API, and re-run ingestion with <code className="font-mono">-- --force</code>.
          </span>
        </div>
      )}
    </div>
  );
}
