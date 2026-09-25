# Handoff point (Claude Code)

Context: these documents summarize a planning session from 21 Sep 2026. The project skeleton was created the same day (step 0 of `07-plan-v1.md`). The project moves forward one step at a time, with the reason for each step. Code, comments, tests, UI and docs in English.

## Read in order
`00-overview.md` → `01-decisions.md` → `02-data-model.md` → `03-risks.md` → `04-roadmap.md` → `07-plan-v1.md`.

## Where we are
- Structural requirements settled: Imperial first (corridors, rooms, doors), a single Z in V1, .esp as the source of truth, connection types per face, Chromium SPA without backend, on-demand bake for the NavMesh (phase 3).
- Still to decide: the "Still to decide for V1" table in `01-decisions.md` (V1–V14) and the "Proposed" rows.

## Chosen stack
TypeScript + Vite + Svelte 5 + three.js (V11), Vitest for tests. Parsers and geometry in pure TypeScript, framework-independent. Skeleton: `src/lib/{binary,format,catalogue,grid,fs,render,editor}`, test pages in `poc/`, Python scripts in `tools/`. See `README.md` and `CLAUDE.md`.

## Suggested next action
Follow `07-plan-v1.md`: step 1 (R5) done on the 5 V1 sub-kits on 21 Sep 2026
(D51, D53, D54 decided; D52, D55 proposed). Step 2 (R3) done the same day: mesh analysis
is proven (D12), 15 groups over 304 faces. Step 3 (R14a) done and validated in Chrome on
21 Sep 2026. Step 3b (R15, MO2 virtual Data view) done and validated
against MO2. Step 4 (R14b) done and validated in Chrome.
Step 5 (R14c) done and validated on 22 Sep 2026
(identical round trip, added REFR accepted by xEdit and the CK). Step 6 (R10) done and validated on 22 Sep 2026:
**phase 0 complete** (only R2, manual and specific to phase 3, remains open). Step 8 done and checked in the app (111 structural
pieces out of 525 Imperial STATs). Phase 1 complete on 22 Sep 2026: Imperial catalogue built
in the browser and validated (105 tiles, annotations in `data/annotations/imperial.json`).
Step 11 done the same day (working plugin opened in the app, cell loaded:
205 tiles recognized). Step 12 done on 23 Sep 2026 (three.js rendering of the cell, 0.3 s). Step 13 done on 23 Sep 2026 (editing: add, move, rotate, delete,
undo/redo). Step 14 done on 24 Sep 2026 (assistant: open faces, compatible pieces,
junctions judged on their profiles (D60), slope levels (D59), shared cells).
Step 15 done on 24 Sep 2026 (in-place save, timestamped copy, refusal if the file has
changed on disk). Steps 16 (V1 criterion) and 17 (ergonomics) done: **V1 complete on 24 Sep 2026**, published on
GitHub with CI, CodeQL, security analysis, single-file build and Docker image. Next, to be chosen:
14b (textures), R16 (deep junction check), seeing Z, phases 3 to 6.
