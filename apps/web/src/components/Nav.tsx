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
  { href: '/', label: 'Ask' },
  { href: '/dashboard', label: 'Dashboard' },
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
    <header className="border-b border-ink-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
        <Link href={inDev ? '/dev' : '/'} className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tracking-tight">Pharma Agent Lab</span>
          {inDev && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
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
                  ? 'bg-ink-100 font-medium text-ink-900'
                  : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <Link
          href={inDev ? '/' : '/dev'}
          className="ml-auto rounded-md border border-ink-200 px-2.5 py-1 text-xs text-ink-500 hover:bg-ink-100 hover:text-ink-800"
        >
          {inDev ? 'Exit dev tools' : 'Developer tools'}
        </Link>
      </div>
    </header>
  );
}
