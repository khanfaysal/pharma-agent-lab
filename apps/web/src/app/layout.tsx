import type { Metadata } from 'next';
import { Space_Grotesk, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { HealthBanner } from '@/components/HealthBanner';
import { Nav } from '@/components/Nav';

/**
 * Space Grotesk carries the technical edge in headlines; Plus Jakarta Sans is
 * a humanist face that stays readable through long clinical prose. Both are
 * self-hosted by next/font, so there is no layout shift and no request to
 * Google at runtime.
 */
const display = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});

const body = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'MedIndex — medicine directory with an AI assistant',
  description:
    'Search brands, generics, dosing and prices across a verified catalog, and ask an assistant that shows its sources.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="font-sans">
        <div className="flex min-h-screen flex-col">
          <Nav />
          <HealthBanner />

          <main className="flex-1">{children}</main>

          <footer className="mt-16 border-t border-slate-200 bg-white">
            <div className="mx-auto max-w-6xl px-6 py-8 text-xs leading-relaxed text-slate-500">
              <p className="font-medium text-slate-600">
                Reference information only — not a substitute for professional medical advice.
              </p>
              <p className="mt-1 max-w-3xl">
                Always confirm dosing, interactions and contraindications with a qualified
                pharmacist or physician before acting on anything shown here. Prices and pack
                sizes change without notice.
              </p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
