# Roadmap

Phases 0–2 were broken down into deliverable steps in `07-plan-v1.md`; they are done: **V1 released as 0.1.0 on 25 Sep 2026** (D63). The project stays in 0.x until 1.0.0 (every interior kit of the base `.esm` files, R16, textures, Z).

## Phase 0 – Proofs of concept
Test HTML pages and throwaway scripts. See `03-risks.md`.
- [x] R5 module and pivots of the Imperial kit
- [x] R3 mesh signatures
- [x] R14a disk access from the browser
- [x] R14b BSA + NIF + WebGL display of a tile
- [x] R14c in-place ESP: identical round trip, then adding a REFR (covers R6)
- [x] R10 grid derivation on existing cells
- [ ] R2 two NAVMs in one cell (manual CK test; moved to phase 3, where it matters)
- [x] Close the remaining open questions (MO2, non-Chromium browsers)

## Phase 1 – Imperial catalogue
- [x] ESM extraction: list of Imperial STATs (corridors, rooms, doors)
- [x] Mesh analysis: `pivot`, `cells`, face signatures → proposed connection types
- [x] Validation tool: correct the types (types are never named, V9), mark as validated
- [x] Catalogue built in the browser from the user's install, with committed annotations (`data/annotations/imperial.json`) instead of a distributed `catalogue.json` (D46)

## Phase 2 – V1 editor (single Z)
- [x] Read a cell from the .esp, derive the grid view, display the opaque refs
- [x] Grid, pan/zoom, tile rendering (walls vs passages)
- [x] Contextual assistant: click on an open face → compatible pieces (rotation included)
- [x] Add / move / delete; overlap detection
- [x] In-place writing into the plugin
- [ ] List of pieces used (free by-product): not done; the cell info only counts tiles

- [x] Also: create plugins and cells (D62), junction checks on profiles (D60), accepted
  overlaps (D61), snapping, getting started and settings pages

**Milestone reached (24 Sep 2026): a single-Z Imperial level built very quickly, opened in the
CK. Released as 0.1.0.**

## Phase 2b – Deep junction check (R16)
- [ ] Proof of concept on the two known cases (door seam, room pieces)
- [ ] Exact free edges + visibility from the inside (GPU rendering), local cache per pair
- [ ] Profiles = fast filter, deep test = confirmation; texture continuity (14b, optional, off by default)
- [ ] Later, with caves and props: where to plug a leak, verified plug

## Phase 3 – Basic NavMesh
- [ ] R1 write a valid NAVM; R4 walkable polygons; R11
- [ ] `walkable` and `navEdge` in the catalogue
- [ ] Bake on selection, "fill" tool (tiles without NavMesh), clear all
- [ ] Stitching to existing batches; locked flag

## Phase 4 – Z
- [ ] At least show a tile's level (see `05-ideas.md`), before the full slices
- [ ] Z slices, active slice, dimmed ghost below, option to hide everything
- [ ] Pieces spanning two slices (stairs, sloped corridors)
- [ ] NavMesh per layer, stitching at stairs (R7)

## Phase 5 – Props and obstacles
- [ ] Prop class, snap helpers; extraction on the working mod's custom NIFs
- [ ] Obstacles in the NavMesh, iteratively: free-standing walls → pillars → clutter → furniture

## Phase 6 – Spriggit mode (D57)
- [ ] "Level store" interface isolated from the format as early as phase 2 (`.esp` backend)
- [ ] Spriggit backend: read the mod's YAML/JSON folder, write the REFRs into it; masters always in binary
- [ ] Check with Spriggit that the modified folder translates into a `.esp` identical to what the tool would have written

## Toward 1.0.0
Every interior kit of the base `.esm` files (Nordic, Dwemer, caves...), with the deep junction
check (R16) and texture continuity, Z levels (phase 4). See D63.

## Later
See `05-ideas.md`: cross-section view, thumbnails, room markers/portals, multiple selection.
