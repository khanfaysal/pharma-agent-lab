'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Architecture } from './api';

/**
 * User-facing settings, kept in localStorage.
 *
 * The landing page is deliberately bare -- a search box and an answer -- so the
 * knobs that used to sit under it live here instead. Storage is per-browser and
 * never reaches the API: the settings are request parameters, not server state.
 */

export type Tier = 'fast' | 'balanced' | 'strong';

export interface Settings {
  architecture: Architecture;
  useModelRouter: boolean;
  /** undefined = let the router pick a tier from the question. */
  tier?: Tier;
  maxSteps: number;
}

export const DEFAULT_SETTINGS: Settings = {
  architecture: 'single',
  useModelRouter: true,
  tier: undefined,
  maxSteps: 6,
};

const KEY = 'pharma-agent-lab:settings';

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    // Merge rather than replace, so a settings field added later still gets its
    // default for someone whose browser holds an older shape.
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useSettings() {
  // Start from the defaults on both server and first client render, then load
  // from storage in an effect -- reading localStorage during render would make
  // the markup differ between server and client and trip hydration.
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setSettings(read());
    setLoaded(true);
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Private windows and blocked site data throw here. The setting still
        // applies for this session; it just will not survive a reload.
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    try { localStorage.removeItem(KEY); } catch { /* see above */ }
    setSettings(DEFAULT_SETTINGS);
  }, []);

  return { settings, update, reset, loaded };
}

/** Settings as the body fields `POST /api/chat` expects. */
export function toChatBody(question: string, s: Settings) {
  return {
    question,
    architecture: s.architecture,
    useModelRouter: s.useModelRouter,
    maxSteps: s.maxSteps,
    ...(s.tier ? { tier: s.tier } : {}),
  };
}
