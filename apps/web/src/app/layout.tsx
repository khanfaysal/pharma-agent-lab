import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { HealthBanner } from '@/components/HealthBanner';

export const metadata: Metadata = {
  title: 'Pharma Agent Lab',
  description: 'Compare single-model and multi-model agentic RAG over SQL + pgvector.',
};

const NAV = [
  { href: '/', label: 'Ask' },
  { href: '/compare', label: 'Compare' },
  { href: '/search', label: 'Search' },
  { href: '/eval', label: 'Evaluate' },
  { href: '/runs', label: 'Runs' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <header className="border-b border-ink-200 bg-white">
            <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
              <Link href="/" className="flex items-baseline gap-2">
                <span className="text-sm font-semibold tracking-tight">Pharma Agent Lab</span>
                <span className="hidden text-xs text-ink-400 sm:inline">
                  agentic RAG over SQL + vectors
                </span>
              </Link>
              <nav className="flex items-center gap-1">
                {NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-md px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-100 hover:text-ink-900"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </header>

          <HealthBanner />

          <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>

          <footer className="mx-auto max-w-7xl px-6 pb-10 text-xs text-ink-400">
            Reference data only. Not medical advice — this lab exists to measure agent
            architectures, not to answer clinical questions.
          </footer>
        </div>
      </body>
    </html>
  );
}
