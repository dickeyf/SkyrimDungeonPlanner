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
- [x] R2 two NAVMs in one cell (manual CK test, 25 Sep 2026): disproved, one NAVM per cell (D36)
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

## Phase 2b – Deep junction check (R16) – V2, see `08-plan-v2.md`
- [x] Proof of concept on the two known cases (door seam, room pieces), 29 Sep 2026
- [x] Exact free edges + visibility from the inside (GPU rendering), local cache per pair (29 Sep 2026)
- [x] Profiles = fast filter, deep test = confirmation; texture continuity (14b, optional, off by default), 29 Sep 2026
- [ ] Later, with caves and props: where to plug a leak, verified plug

## Phase 3 – Basic NavMesh – V2, see `08-plan-v2.md`
- [x] R1 write a valid NAVM (28 Sep 2026, NPC chase in game)
- [x] R4 walkable polygons (29 Sep 2026, all Imperial tiles reviewed)
- [ ] R11
- [x] `walkable` in the catalogue, reviewed (29 Sep 2026); `navEdge` with the bake
- [x] Bake of a selection into one mesh, previewed in the editor (29 Sep 2026)
- [x] Writing the NAVM, welded to the existing NavMesh (30 Sep 2026)
- [x] "Fill" tool (tiles without NavMesh), replace, clear, lock (30 Sep 2026)
- [x] "Edit NavMesh" mode: select, delete, wipe (30 Sep 2026)
- [x] NavMesh edits: merge vertices, create triangles, join two NAVMs (1 Oct 2026)
- [x] Finalize in the app: door links and NAVI entries, no cover (1 Oct 2026)
- [x] Stitching to existing batches; locked flag (30 Sep 2026)
- [ ] Cover (Finalize's third part), later

**Milestone reached (1 Oct 2026): the test dungeon baked in one click, finalized in the app, an
NPC follows the player through it in game. V2.**

## Phase 4 – Z – V3, see `09-plan-v3.md` (done 2 Oct 2026, with textures and a camera view)
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

## Nordic kit – V4, see `10-plan-v4.md` (done 7 Oct 2026, released as 0.4.0)
- [x] R19 module, pivots and faces; R20 collision and floors
- [x] Several kits in one catalogue, annotations per kit (D68, D69)
- [x] Vanilla check: the game's CELLs measured with the tool's checks (4 Oct 2026)
- [x] Fine grid, contextual grid (D70)
- [x] Assistant, checks, levels and NavMesh on the Nordic kit
- [ ] NPCs across a drop (a high exit into a lower hall): the NavMesh has no link there and an
  NPC does not follow; find how the game handles it. Noted on 7 Oct 2026.
- [x] ~~Transitions between kits (D54)~~: none in the game, the kits meet through load doors

## Dwemer kit and the other objects – V5, see `11-plan-v5.md`
- [ ] R21 module, pivots and faces; R22 collision and floors
- [ ] Kit definition, annotations, game pairs; a Dwemer test dungeon
- [ ] The other objects of a cell: categories, show / fade / hide / lock, selected and moved
  with the tiles (D71, D72, R23)
- [ ] The Nordic families left out at V4 (temple, pits, shafts, platforms, bridges, chambers)
- [ ] Help for a designer new to a kit: sets for a wide face, the piece that closes one

## Toward 1.0.0
Every interior kit of the base `.esm` files (Nordic, Dwemer, caves...), with the deep junction
check (R16) and texture continuity, Z levels (phase 4). See D63.
- [ ] The sub-folders left out of each kit's tiles, judged one by one (on the grid or not,
  openings that join the kit's halls): Nordic `temple`, `pits`, `shafts`, `platforms`,
  `bridges`, `chambers` (set aside at V4 step 1, planned in V5); Imperial, the structural pieces outside
  `smallhall`, `largehall`, `smallroom` and `largeroom`, and the pieces left out by name
  (pillars, braces, beams...). Not in V4.
- [ ] Openings toward another piece of the world: pieces such as Nordic `NorExSmFree01` (a
  doorway frame on its own, one opening) lead into a cave or another kit; the assistant should
  offer what goes on their other side. Find the other pieces that work this way. Noted on
  4 Oct 2026, after V4.
- [ ] Join two pieces: select two pieces and let the tool find the pieces (one or a short
  chain) that link them cleanly, moving the second piece if needed (never turning it). Asked on
  6 Oct 2026: going from `NorHallSm1way01` to `NorRmBgWallFrontExSm01` needs
  `NorHallSm1wayEndExSm01` between them, at one exact distance the designer cannot guess.
- [ ] Help for a designer new to a kit (planned in V5): an open face wider than any one piece (the long face of
  `NorRmSmWallFrontExBg01`) takes several pieces side by side (three `NorRmSmMid01`), or one
  piece the designer does not think of (`NorRmSmWallSideExBg01`). Offer such sets and "the piece
  that closes this", ideally from what the game builds there (the Vanilla pairs). Asked on
  7 Oct 2026, after V4.

## Later
See `05-ideas.md`: cross-section view, thumbnails, room markers/portals, multiple selection.
