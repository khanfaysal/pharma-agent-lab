import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Stray lockfiles above the repo (e.g. D:\work folder, home dir) make Next guess
  // the wrong workspace root. Pin it to the monorepo root instead.
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  },
};
export default nextConfig;
