/// <reference types="vitest/config" />
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Two builds of the same app:
 * - `vite build` (dist/): regular files, served by any web server (the Docker image);
 * - `vite build --mode singlefile` (dist-single/): one self-contained `index.html` with every
 *   script and style inlined, to download and open directly from disk.
 * The proof-of-concept pages of phase 0 (`poc/*.html`) are served by the dev server only.
 */
/** The single-file build has no `public/` next to it: the favicon goes inline too. */
function inlineFavicon(): Plugin {
  return {
    name: 'inline-favicon',
    transformIndexHtml(html) {
      const svg = readFileSync(resolve(import.meta.dirname, 'public/favicon.svg'), 'utf-8');
      const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      return html.replace(/href="\/favicon\.svg"/, `href="${uri}"`);
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [svelte(), ...(mode === 'singlefile' ? [viteSingleFile(), inlineFavicon()] : [])],
  publicDir: mode === 'singlefile' ? false : 'public',
  resolve: {
    alias: { $lib: resolve(import.meta.dirname, 'src/lib') },
  },
  build: {
    outDir: mode === 'singlefile' ? 'dist-single' : 'dist',
    target: 'es2023',
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
}));
