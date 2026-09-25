# Roadmap

Phases 0–2 broken down into deliverable steps: `07-plan-v1.md`. Project skeleton (step 0) done on 21 Sep 2026.

## Phase 0 – Proofs of concept
Test HTML pages and throwaway scripts. See `03-risks.md`.
- [ ] R5 module and pivots of the Imperial kit
- [ ] R3 mesh signatures
- [ ] R14a disk access from the browser
- [ ] R14b BSA + NIF + WebGL display of a tile
- [ ] R14c in-place ESP: identical round trip, then adding a REFR (covers R6)
- [ ] R10 grid derivation on existing cells
- [ ] R2 two NAVMs in one cell (manual CK test, cheap, do it early)
- [ ] Close the remaining open questions (MO2, non-Chromium browsers)

## Phase 1 – Imperial catalogue
- [ ] ESM extraction: list of Imperial STATs (corridors, rooms, doors)
- [ ] Mesh analysis: `pivot`, `cells`, face signatures → proposed connection types
- [ ] Validation tool: name the types, correct, mark as validated
- [ ] `catalogue.json` V1

## Phase 2 – V1 editor (single Z)
- [ ] Read a cell from the .esp, derive the grid view, display the opaque refs
- [ ] Grid, pan/zoom, tile rendering (walls vs passages)
- [ ] Contextual assistant: click on an open face → compatible pieces (rotation included)
- [ ] Add / move / delete; overlap detection
- [ ] In-place writing into the plugin
- [ ] List of pieces used (free by-product)

**Milestone: build a single-Z Imperial level very quickly, open it in the CK.**

## Phase 2b – Deep junction check (R16)
- [ ] Proof of concept on the two known cases (door seam, room pieces)
- [ ] Exact free edges + visibility from the inside (GPU rendering), local cache per pair
- [ ] Profiles = fast filter, deep test = confirmation; texture continuity (14b)
- [ ] Later, with caves and props: where to plug a leak, verified plug

## Phase 3 – Basic NavMesh
- [ ] R1 write a valid NAVM; R4 walkable polygons; R11
- [ ] `walkable` and `navEdge` in the catalogue
- [ ] Bake on selection, "fill" tool (tiles without NavMesh), clear all
- [ ] Stitching to existing batches; locked flag

## Phase 4 – Z
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

## Later
See `05-ideas.md`: cross-section view, other kits, thumbnails, room markers/portals.
