# Skyrim Dungeon Planner

2D top-down level design tool for assembling Skyrim SE dungeons from modular kits, running
entirely in the browser (Chromium only, no backend). V1 targets the Imperial kit on a single
Z level; see `docs/` (French) for the design and `docs/07-plan-v1.md` for the step plan.

## Stack

TypeScript, Vite, Svelte 5 (runes), three.js, Vitest. Binary parsers (ESP / BSA / NIF) and
grid logic are framework-free under `src/lib`.

## Commands

```bash
npm install
npm run dev          # Vite dev server; PoC pages at /poc/<name>.html
npm test             # Vitest, single run
npm run check        # svelte-check + tsc
npm run lint         # ESLint
npm run format       # Prettier
npm run build        # production build to dist/
```

## Layout

```
docs/          design notes (French)
poc/           proof-of-concept HTML pages (phase 0)
tools/         Python + pynifly analysis scripts (R5, R3)
src/lib/binary     BinaryReader / BinaryWriter
src/lib/format     esp/, bsa/, nif/ parsers
src/lib/catalogue  catalogue types (pieces, connection types, kits)
src/lib/grid       rotations, placements, grid derivation
src/lib/fs         File System Access API + IndexedDB handles
src/lib/render     three.js scene
src/lib/editor     editor state and commands
```
