'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Two navs, one header.
 *
 * The app has two audiences with incompatible needs. A user wants a search box
 * and an answer. A developer wants traces, cost, retrieval internals and the
 * eval harness. Mixing them makes the product look like a debugger, so the
 * developer surface lives entirely under /dev and the header swaps when you
 * cross that boundary.
 */

const USER_NAV = [
  { href: '/', label: 'Home' },
  { href: '/ask', label: 'Assistant' },
  { href: '/browse', label: 'Medicines' },
  { href: '/dashboard', label: 'History' },
  { href: '/settings', label: 'Settings' },
];

const DEV_NAV = [
  { href: '/dev', label: 'Overview' },
  { href: '/dev/ask', label: 'Ask + trace' },
  { href: '/dev/compare', label: 'Compare' },
  { href: '/dev/search', label: 'Retrieval' },
  { href: '/dev/eval', label: 'Evaluate' },
  { href: '/dev/runs', label: 'Runs' },
];

export function Nav() {
  const pathname = usePathname() ?? '/';
  const inDev = pathname === '/dev' || pathname.startsWith('/dev/');
  const items = inDev ? DEV_NAV : USER_NAV;

  const isActive = (href: string) =>
    href === '/' || href === '/dev' ? pathname === href : pathname.startsWith(href);

  return (
    <header className={`border-b border-slate-200 bg-white ${inDev ? 'border-t-2 border-t-warn-br' : ''}`}>
      <div
        className={`flex flex-wrap items-center gap-x-6 gap-y-2 py-3 ${
          inDev ? 'w-full px-6 2xl:px-10' : 'mx-auto max-w-6xl px-6'
        }`}
      >
        <Link href={inDev ? '/dev' : '/'} className="flex items-baseline gap-2">
          <span className="font-display text-sm font-semibold tracking-tight text-navy-700">
            MedIndex
          </span>
          {inDev && (
            <span className="rounded bg-warn-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warn-fg">
              dev
            </span>
          )}
        </Link>

        <nav className="flex flex-wrap items-center gap-1">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-1.5 text-sm transition ${
                isActive(item.href)
                  ? 'bg-navy-50 font-medium text-navy-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-navy-700'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <Link
          href={inDev ? '/' : '/dev'}
          className="ml-auto rounded-md border border-slate-200 px-2.5 py-1 text-xs text-ink-500 hover:bg-ink-100 hover:text-ink-800"
        >
          {inDev ? 'Exit dev tools' : 'Developer tools'}
        </Link>
      </div>
    </header>
  );
}
