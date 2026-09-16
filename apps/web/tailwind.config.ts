import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        ink: {
          50: '#f6f7f9', 100: '#eceef2', 200: '#d5d9e2', 300: '#b0b8c9',
          400: '#8591ab', 500: '#657390', 600: '#505c77', 700: '#424b61',
          800: '#394052', 900: '#333947', 950: '#22252e',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
