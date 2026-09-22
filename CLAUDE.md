# CLAUDE.md

## Project

Browser SPA (Chromium, no backend) to assemble Skyrim SE dungeons from modular kits and write
them back into a plugin. V1 = Imperial kit, single Z level. Design docs are in `docs/` (French);
read them in order `00` -> `06`, then `07-plan-v1.md` for the current step plan.

## Language

- Code, comments, identifiers, tests, commit messages and UI text: **English**.
- `docs/*.md` and conversation with the user: **French**.

## Stack and layout

TypeScript + Vite + Svelte 5 (runes) + three.js + Vitest. No SvelteKit.

- `src/lib/binary`, `src/lib/format/*`, `src/lib/grid`, `src/lib/catalogue`: pure TypeScript,
  no framework or DOM dependency, unit-tested with Vitest (`*.test.ts` next to the source).
- `src/lib/render`: imperative three.js, outside Svelte.
- `src/lib/editor` and `.svelte` files: UI only; logic lives in `grid/`.
- `poc/*.html`: throwaway proof-of-concept pages, auto-registered by `vite.config.ts`.
- `tools/`: Python + pynifly scripts for mesh analysis prototypes.

## Rules

- The .esp is the source of truth; never keep a parallel level document.
- Never commit game files (`*.esp`, `*.esm`, `*.bsa`, `*.nif`); tests use tiny synthetic
  fixtures built in code.
- Back up a plugin before writing it; refuse ESL-flagged plugins in V1.
- The grid module is per-kit data (`Kit.module`, D53). Never hard-code 128 or any module in
  code, tests excepted; every grid computation takes the module from the kit.
- Work one step at a time and state the reason for each step; the user decides the order.
- Before `npm test` / `npm run check` pass, a step is not done.

## Commands

`npm run dev`, `npm test`, `npm run check`, `npm run lint`, `npm run format`, `npm run build`.
