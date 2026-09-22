/// <reference types="vitest/config" />
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Proof-of-concept pages (phase 0): every `poc/*.html` is an extra build entry.
 * In dev, Vite serves them directly at `/poc/<name>.html`.
 */
function pocPages(): Record<string, string> {
  const dir = resolve(import.meta.dirname, 'poc');
  const entries: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.html')) entries[`poc-${name.replace(/\.html$/, '')}`] = resolve(dir, name);
  }
  return entries;
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: { $lib: resolve(import.meta.dirname, 'src/lib') },
  },
  build: {
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), ...pocPages() },
    },
    target: 'es2023',
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
