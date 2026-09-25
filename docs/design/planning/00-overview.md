# Skyrim Dungeon Planner – overview

Working title. A 2D (top-down) level design tool to assemble Skyrim SE dungeons from the modular
kits, then generate a basic NavMesh. Standalone tool, publishable independently of any mod.

Status: planning finished for the structuring requirements (21 Sep 2026). Project skeleton in place
(same day); step plan toward V1 in `07-plan-v1.md`. See `06-handoff.md`.

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
reproduces the layering of mod folders (later, with custom pieces).

## V1 scope
- Imperial kit only: corridors, rooms, doors.
- A single Z level.
- Read an existing cell, add/move/delete tiles, write back to the plugin.
- Contextual assistant: click on an open face → compatible pieces.

## Documents
- `01-decisions.md` – decisions made and open questions
- `02-data-model.md` – data structures (V1 and planned)
- `03-risks.md` – risks and proofs of concept
- `04-roadmap.md` – phases
- `05-ideas.md` – ideas for later
- `06-handoff.md` – handoff point for Claude Code
- `07-plan-v1.md` – detailed steps toward V1 (Imperial kit, single Z)
