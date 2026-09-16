import type { Metadata } from 'next';
import './globals.css';
import { HealthBanner } from '@/components/HealthBanner';
import { Nav } from '@/components/Nav';

export const metadata: Metadata = {
  title: 'Pharma Agent Lab',
  description: 'Ask about brands, generics, dosing and prices — grounded in a real catalog.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <Nav />
          <HealthBanner />

          <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>

          <footer className="mx-auto max-w-7xl px-6 pb-10 text-xs text-ink-400">
            Reference data only. Not medical advice — always confirm with a qualified
            professional before acting on anything here.
          </footer>
        </div>
      </body>
    </html>
  );
}
