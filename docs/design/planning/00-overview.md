# Skyrim Dungeon Planner – overview

A 2D (top-down) level design tool to assemble Skyrim SE dungeons from the modular
kits, then generate a basic NavMesh. Standalone tool, publishable independently of any mod.

Status: **V1 done and released as 0.1.0 (beta) on 25 Sep 2026** (D63), published on GitHub
(`dickeyf/SkyrimDungeonPlanner`, GPL v3). The V1 steps and their results are in
`07-plan-v1.md`; where the work stands is in `06-handoff.md`. The NavMesh is not started yet
(phase 3).

## Goal
- Make building a dungeon fast: the tool knows the pieces and only offers those that fit the
  clicked face.
- Lay down a basic NavMesh that allows moving everywhere and that connects automatically from one
  tile to the next.
- The designer then goes back to the CK for clutter, obstacles, lighting, and NavMesh finishing.
- Underlying objective: minimize manual adjustments.

## Principles
1. **The .esp is the source of truth for the level.** The tool reads and writes the cell's refs; it
   does not keep a parallel design document in V1.
2. **The tool's own data = the piece catalogue**: footprint, pivot, and connection type of each
   face.
3. **"Bake" on demand**: generated outputs (NavMesh, later others) are produced, erased and redone
   on demand, on everything or on a selection.
4. **Plan wide, ship narrow**: the data structures provide for Z, props and obstacles; V1 only
   implements a subset.
5. **Prove before building**: each technical risk has a proof of concept (see `03-risks.md`).

## Platform
Browser SPA, no backend, for modders. Chromium only (File System Access API). In-house ESP / BSA /
NIF parsers. WebGL rendering; the 2D view is an orthographic camera on the 3D scene. The catalogue
is built on the user's machine from their installation. MO2: the tool reads `modlist.txt` and
reproduces the layering of mod folders (needed from V1, D49, D50).

## V1 scope (release 0.1.0)
- Imperial kit only: corridors, rooms, doors.
- A single Z level (ramps and stairs work, heights are not shown).
- Read an existing cell, or create a plugin and cells (D62); add/move/rotate/delete tiles,
  undo/redo, write back to the plugin with a backup.
- Contextual assistant: click on an open face → pieces that fit every neighbour; snapping onto
  open faces.
- Junction checks on the pieces' face profiles: seams, mismatches, shared cells (D60, D61).

## Versions (D63)
V1 is release 0.1.0, a beta. The project stays in 0.x until 1.0.0: every interior kit of the
base `.esm` files, the deep junction check (R16), texture continuity, Z levels.

## Documents
- `01-decisions.md` – decisions made, how the V1 questions were settled, open questions
- `02-data-model.md` – data structures (V1 and planned)
- `03-risks.md` – risks and proofs of concept
- `04-roadmap.md` – phases
- `05-ideas.md` – ideas for later
- `06-handoff.md` – where the work stands, where to resume
- `07-plan-v1.md` – the V1 steps (Imperial kit, single Z), with their results
- `08-plan-v2.md` – the V2 steps: texture continuity, deep junction check, basic NavMesh
