'use client';

import Link from 'next/link';
import {
  ARCHITECTURE_BLURBS, ARCHITECTURE_LABELS, type Architecture,
} from '@/lib/api';
import { DEFAULT_SETTINGS, useSettings, type Tier } from '@/lib/settings';

const ARCHITECTURES: Architecture[] = ['single', 'multi', 'router-only', 'baseline-no-tools'];

const TIERS: Array<{ value: Tier | undefined; label: string; hint: string }> = [
  { value: undefined,  label: 'Automatic', hint: 'Let the router pick per question' },
  { value: 'fast',     label: 'Fast',      hint: 'Cheapest and quickest' },
  { value: 'balanced', label: 'Balanced',  hint: 'The usual choice' },
  { value: 'strong',   label: 'Strong',    hint: 'Best quality, slowest' },
];

function Row({ title, description, children }: {
  title: string; description: string; children: React.ReactNode;
}) {
  return (
    <div className="border-t border-slate-200 py-5 first:border-t-0 first:pt-0">
      <div className="h-sub text-sm">{title}</div>
      <p className="mt-0.5 mb-3 text-xs text-slate-500">{description}</p>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const { settings, update, reset, loaded } = useSettings();

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <header className="mb-6">
        <h1 className="h-page">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          How the assistant answers your questions. Saved in this browser only.
        </p>
      </header>

      <div className="card px-5 py-5">
        <Row
          title="Architecture"
          description="How the assistant works out an answer. Different shapes trade accuracy against speed and cost."
        >
          <div className="flex flex-wrap gap-1.5">
            {ARCHITECTURES.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => update({ architecture: a })}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                  settings.architecture === a
                    ? 'border-navy-600 bg-navy-600 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                }`}
              >
                {ARCHITECTURE_LABELS[a]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {ARCHITECTURE_BLURBS[settings.architecture]}
          </p>
        </Row>

        <Row
          title="Model tier"
          description="Which model answers. Automatic lets the router decide from the question — usually the right choice."
        >
          <div className="flex flex-wrap gap-1.5">
            {TIERS.map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={() => update({ tier: t.value })}
                title={t.hint}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                  settings.tier === t.value
                    ? 'border-navy-600 bg-navy-600 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Row>

        <Row
          title="Smart routing"
          description="Use a model to decide which tools a question needs. Turning this off falls back to keyword matching — faster, slightly blunter."
        >
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={settings.useModelRouter}
              onChange={(e) => update({ useModelRouter: e.target.checked })}
              className="rounded border-slate-300"
            />
            {settings.useModelRouter ? 'On' : 'Off — keyword matching'}
          </label>
        </Row>

        <Row
          title="Search depth"
          description="How many lookups the assistant may make before it has to answer. Higher digs deeper into layered questions and costs more."
        >
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={12}
              value={settings.maxSteps}
              onChange={(e) => update({ maxSteps: Number(e.target.value) })}
              className="w-56"
            />
            <span className="w-16 text-sm tabular-nums text-slate-700">
              {settings.maxSteps} step{settings.maxSteps === 1 ? '' : 's'}
            </span>
          </div>
        </Row>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
        <span>{loaded ? 'Changes save as you make them.' : 'Loading…'}</span>
        <button type="button" onClick={reset} className="underline hover:text-slate-700">
          Reset to defaults
        </button>
      </div>

      <p className="mt-6 text-xs text-slate-400">
        Defaults: {ARCHITECTURE_LABELS[DEFAULT_SETTINGS.architecture]}, automatic tier, smart
        routing on, {DEFAULT_SETTINGS.maxSteps} steps. To measure these choices against each
        other rather than guess, use the{' '}
        <Link href="/dev/compare" className="underline">developer tools</Link>.
      </p>
    </div>
  );
}
