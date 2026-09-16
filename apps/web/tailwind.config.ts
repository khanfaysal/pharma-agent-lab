import type { Config } from 'tailwindcss';

/**
 * Two colour languages, deliberately kept apart.
 *
 *   navy + slate  -- the directory. Calm, clinical, what a health site is
 *                    expected to look like. Everything defaults to this.
 *   agent         -- violet-to-cyan, used ONLY on surfaces the agent touches:
 *                    its orb, its reasoning trace, the border of its answer
 *                    card. If it appears anywhere else it stops signalling
 *                    "this part was generated" and becomes decoration.
 *
 * Ratios below are measured against #F7F9FC (page) or #ffffff (card):
 *   >= 4.5  any text      >= 3.0  large text, borders, fills      < 3.0  decorative only
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Wired up in layout.tsx via next/font.
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['var(--font-body)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },

      colors: {
        /** Page ground. Near-white with a cool cast, not pure white. */
        canvas: '#F7F9FC',

        /** Primary. Headers, links, primary actions. */
        navy: {
          50: '#eef4fb', 100: '#d8e6f5', 200: '#b3cbe9', 300: '#7fa8d7',
          400: '#4a80c0',
          500: '#2a63a5',
          600: '#1E4E8C',  //  8.32 on white -- primary actions, links
          700: '#123C6B',  // 11.14 on white -- headings, hover
          800: '#0f3159', 900: '#0d2846', 950: '#071a2e',
        },

        /** Body copy and chrome. */
        slate: {
          50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',  // 4.51 on canvas -- the muted-text floor
          600: '#475569',  // 7.18 on canvas -- body
          700: '#334155', 800: '#1e293b', 900: '#0f172a',
        },

        /**
         * The agent's signature. `from`/`to` are the gradient stops and are
         * NOT text-safe -- cyan is 1.81 on white, which fails badly. `ink` and
         * `inkAlt` exist for anything that carries words.
         */
        agent: {
          start: '#7C5CFC',  // 4.38 -- fills, borders, large text
          end:  '#22D3EE',   // 1.81 -- DECORATIVE ONLY. Never text.
          ink:  '#6D28D9',   // 7.10 -- agent text on white
          inkAlt: '#0E7490', // 5.36 -- cyan-flavoured text when needed
          tint: '#f5f3ff',   // wash behind agent cards
          tintEdge: '#ddd6fe',
        },

        /**
         * Safety states. In a pharma UI these have to be scannable before
         * they are readable, so each is a fill + border + text triplet.
         */
        safe:     { fg: '#047857', bg: '#ecfdf5', br: '#a7f3d0' },  // 5.21
        caution:  { fg: '#b45309', bg: '#fffbeb', br: '#fde68a' },  // 4.84
        critical: { fg: '#b91c1c', bg: '#fef2f2', br: '#fecaca' },  // 5.91

        /** Retained so /dev keeps working; the directory does not use these. */
        ink: {
          50: '#f6f7f9', 100: '#eceef2', 200: '#d5d9e2', 300: '#b0b8c9',
          400: '#8591ab', 500: '#657390', 600: '#505c77', 700: '#424b61',
          800: '#394052', 900: '#333947', 950: '#22252e',
        },
        brand: {
          50: '#eef4fb', 100: '#d8e6f5', 200: '#b3cbe9', 300: '#7fa8d7',
          400: '#4a80c0', 500: '#2a63a5', 600: '#1E4E8C', 700: '#123C6B',
          800: '#0f3159', 900: '#0d2846',
        },
        ok:   { fg: '#047857', bg: '#ecfdf5', br: '#a7f3d0' },
        warn: { fg: '#b45309', bg: '#fffbeb', br: '#fde68a' },
        err:  { fg: '#b91c1c', bg: '#fef2f2', br: '#fecaca' },
        route: {
          sql: '#2563eb', rag: '#b45309', hybrid: '#0f766e', none: '#475569',
        },
      },

      keyframes: {
        /** The agent's "thinking" pulse. One shared timing, so every live
         *  indicator on the page breathes together. */
        breathe: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '.65', transform: 'scale(.94)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
      },
      animation: {
        breathe: 'breathe 1.8s ease-in-out infinite',
        shimmer: 'shimmer 2.2s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
