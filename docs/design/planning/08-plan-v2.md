# V2 implementation plan (release 0.2.0)

V2 builds on V1 (0.1.0, D63), still on the Imperial kit and a single Z level. It adds three things,
chosen on 25 Sep 2026:

1. **Texture continuity** at junctions (step 14b of `07-plan-v1.md`), optional.
2. **Deep junction check** (R16, phase 2b of the roadmap): detect the visible leaks the profiles
   cannot see.
3. **Basic NavMesh** (phase 3): bake a NavMesh on the tiles, on request.
4. **NavMesh editing and Finalize in the app** (added on 30 Sep 2026, D65): edit the cell's
   NavMeshes by triangle, edge and vertex, merge NAVMs, and finalize (door links and the `NAVI`
   record; cover later), so the designer no longer goes back and forth with the CK.

Each step says **why** it comes at that point, what it produces and when it is done. As for V1, a
step is done only when `npm test` and `npm run check` pass, and the risky parts are proven before
they are built on.

Success criterion of V2: *the 30-tile Imperial dungeon of the V1 test gets a NavMesh baked by the
tool in one click; the CK finalizes it without errors, an NPC walks from one end of the dungeon to
the other in game; the leaks and texture breaks of the working cell are flagged.*

## Decisions to confirm during V2

The NavMesh decisions still "Proposed" become binding here; each step says when:

- D35: "tile without NavMesh" = a geometric test on the existing triangles: **decided with D64**.
- D36: ~~one NAVM record per baked batch~~ **decided at step 1: one NAVM per cell** (R2 fallback).
- D37: "locked" flag per cell once in the finishing phase (step 12).
- D38: walkable polygons per tile, union, triangulation, canonical boundary vertices (steps 4, 10).
- D64 (29 Sep 2026): a bake never touches a tile that already has triangles, unless the user
  confirms replacing them; no record of the tool's own triangles is needed. Where to store the
  lock (D37): decided at step 12.

## Phase A – Proofs of concept

The NavMesh is the biggest technical risk of the project (R1), and nothing of it is proven yet: it
comes first, before any interface work.

### Step 1 – R2: two NAVMs in one cell (manual, CK)
- **Why**: decides D36 (one NAVM per baked batch, so a partial bake never rewrites the rest)
  before any code depends on it. No code, cheap.
- **What**: in the CK, a test cell with two separate NavMeshes whose edge vertices coincide;
  Finalize; check the edge links and an NPC's pathing across the seam.
- **Done when**: continuous pathing → D36 confirmed. Otherwise the fallback of R2: a single NAVM
  per cell, the partial bake rewrites it while keeping the triangles outside the selection.
- **Commits to**: D36.
- **Result (25 Sep 2026)**: no edge link between the two NAVMs after Finalize (xEdit). Step 2
  then found 812 same-cell edge links in 80 interior cells of Skyrim.esm: the game supports
  them. Decided: one NAVM per cell, batches welded on shared vertices, no edge links (D36).

### Step 2 – NAVM reader and round trip
- **Why**: writing a valid NAVM (R1) starts with reading the ones the CK writes; a byte-identical
  round trip proves the format is understood before generating one.
- **What**: `format/esp/navm.ts`: decode the `NVNM` data of Skyrim SE NavMeshes (version, parent
  cell, vertices, triangles with their edge links and flags, cover triangles, edge links to other
  NavMeshes, door triangles, the search grid), and encode it back. Tested on synthetic fixtures;
  checked on the NavMeshes of the working cell (decode, re-encode, compare).
- **Done when**: every NAVM of the working cell re-encodes byte for byte; unit tests on the
  fields.
- **Commits to**: D45 (targeted parsers).
- **Result (26 Sep 2026)**: `format/esp/navm.ts` and the `poc/navm-roundtrip.html` page; all
  15,966 NAVMs of Skyrim.esm and those of the working plugin re-encode byte for byte, no unknown
  bytes, indices consistent (triangle flag bits 0-2 mark an edge as an edge link).

### Step 3 – R1: write a valid NAVM for one tile
- **Why**: the core risk. If the CK or the game rejects a generated NavMesh, the whole phase
  changes (fallback: generate only a guide for the CK).
- **What**: by code, the NavMesh of ONE hallway tile (triangles drawn by hand in the test,
  adjacencies, edge flags, search grid computed), added to a copy of the plugin next to it. Open
  in the CK, Finalize, have an NPC walk on it in game.
- **Done when**: the CK accepts it without errors, Finalize succeeds, the NPC moves around; what
  Finalize adds or rewrites is recorded (the tool may leave those parts to it).
- **Commits to**: R1.
- **Result (28 Sep 2026)**: R1 proven. `navmesh/build.ts` builds the NVNM data (adjacencies,
  flags, search grid) following rules measured on the 1,526 interior NavMeshes of Skyrim.esm;
  `Plugin.addNavm` writes it. The `poc/navm-tile.html` page covers the grid cells of one tile or
  of every tile of a cell (no hand placement), at the grid level's floor. The CK loads it,
  Finalize keeps it unchanged and adds a `NAVI` record; a hostile NPC chased the player through
  the dungeon in game. As expected from whole cells, the mesh lies a little under the floor and
  runs under the walls: step 4 gives the real surface.

### Step 4 – R4: walkable polygon of a tile
- **Why**: the NavMesh of a level is assembled from per-tile walkable polygons (D38); their
  quality decides the quality of the bake.
- **What**: read the tile's collision from the NIF (`bhk*` blocks; the render mesh's upward-facing
  triangles as a fallback), keep the upward-facing surfaces, project, union, then erode against
  the walls by the actor radius. Prototype on three tiles: a hallway, a room corner, a door.
- **Done when**: clean polygons with few vertices, comparable to what a designer would draw,
  shown over the tile in a test page.
- **Commits to**: R4, D38.
- **Result (29 Sep 2026)**: R4 proven. `format/nif/collision.ts` decodes the collision mesh;
  `navmesh/walkable.ts` samples it on the tile's footprint, keeps floors with headroom and a
  ceiling, grows them from the openings (so cavities and floors enclosed under stairs stay out),
  erodes them by the actor radius except at the footprint edge, then traces and simplifies the
  outline. Parameters tuned with the user: sample 4, radius 16, height 96, step 64, slope 50
  degrees, tolerance 6. On the 111 Imperial tiles: 101 single outlines of 14.6 vertices on
  average; see `03-risks.md` for the exceptions.

### Step 5 – R16: deep junction check, proof of concept
- **Why**: the profiles missed a real seam (`ImpLRoomDoor02` / `ImpLHallDoor02`: door frame and
  floor that do not join) and a threshold was tuned by hand; the deep check must be proven on
  the known cases before it drives any mark.
- **What**: the two pieces placed side by side; (1) exact check: free borders of each mesh near
  the junction, exact distance to the other piece's surface, gaps wider than a threshold;
  (2) visibility: three.js renders from player viewpoints close to the junction, front faces,
  back faces and void in distinct colours, at a real screen resolution. Verdict: a gap that is
  also visible is a leak.
- **Done when**: the known seam is detected, and the room pieces around `ImpLRoomMid02` (no seam in
  game) are not; timing measured per pair.
- **Commits to**: R16.
- **Result (29 Sep 2026)**: R16 proven. `grid/leaks.ts` (pure) finds the free borders of either
  render mesh running along the junction plane, farther than 0.5 unit from the tiles facing the
  opening (all of them together); `poc/leaks.html` looks at each candidate from six standing
  points on the passage axis, drawing every tile within 1,536 units. The known seam (rebuilt by
  the editor in a test cell) is a leak from both sides; the 681 junctions of the working cell
  give none. About 10 to 25 ms per junction, the first read of a mesh up to 150 ms.

## Phase B – Junctions: deep check and textures

### Step 6 – Deep check in the editor
- **Why**: brings R16 to the designer; the profiles stay the fast filter, the deep check confirms.
- **What**: `grid/leaks.ts` (pure) and a render helper; results cached locally per pair of pieces,
  pair of faces and relative placement (IndexedDB, never committed: derived from game files); a
  "leak" verdict and mark, with the leak's position drawn in the junction panel; the compatible
  pieces drop placements with a leak once the pair has been checked.
- **Done when**: the working cell's known leaks are marked, no false positive on the checked
  junctions; a first check of a new pair within a second, then instant.
- **Commits to**: R16, D60 (a verdict added after the profile ones).
- **Result (29 Sep 2026)**: done. `grid/leaks.ts` gives the junctions of a layout and their key
  (pieces and relative placement, turn included); `render/leakViews.ts` the views;
  `editor/leakChecker.svelte.ts` checks them in the background and keeps verdicts in memory and
  IndexedDB (`leak:v1:<key>`). The editor marks leaks in violet, details them in the junction
  panel, and `checkCandidates` drops placements with a known leak. The known seam is marked, the
  working cell shows none, a second opening is instant, and the assistant no longer offers the
  leaking door pair.

### Step 7 – Texture continuity (14b, optional)
- **Why**: identical profiles do not guarantee a continuous texture (a symmetric room piece placed
  the wrong way round). Chosen for V2; optional because some kits may offset textures on purpose.
- **What**: read the vertex UVs and each shape's texture set (`BSShaderTextureSet`) from the NIFs;
  along a junction's open edges, compare the texture file and the texture coordinates on both
  sides (continuous up to whole repeats); a "texture break" verdict in its own colour, with its
  cause (different file, offset); the assistant offers first the rotation that keeps the texture
  continuous. A "Texture continuity check" checkbox, **off by default**.
- **Done when**: the wrongly turned room piece is flagged, and no longer once turned; unit tests
  on the UV comparison.
- **Result (29 Sep 2026)**: done. The NIF reader gives vertex UVs and each shape's diffuse texture
  (shader UV offset and scale applied); `grid/textures.ts` compares, along the edges of both
  sides lying on the junction plane within the opening's grid level, the texture file and the
  coordinates (same file, the same whole number of repeats all along). The editor's optional
  check marks breaks in cyan, explains them in the junction panel and ranks the assistant's
  placements, texture-continuous first. The original wrongly turned piece could not be
  identified any more; on the working cell, the flagged junctions are the breaks seen in game
  (slight, but real), the others show nothing. Comparing at every height was tried and dropped:
  the pieces' outer shells meet on the plane too and flag almost every junction.

## Phase C – NavMesh

### Step 8 – Walkable polygons in the catalogue
- **Why**: every tile needs its polygon before a level can be baked; the analysis must be checked
  by a human like the connection types were.
- **What**: step 4's algorithm on every tile of the kit, stored in `Piece.walkable` (the field
  exists since V1, `null` so far); a Validation tab to view them over the tile and exclude or
  correct a bad one (annotations).
- **Done when**: every validated Imperial tile has a polygon, reviewed.
- **Result (29 Sep 2026)**: done. The catalogue analysis (cache version 4) computes each tile's
  walkable polygons from its collision into `Piece.walkable`; the annotation `walkable:
  reviewed | none` records the review (`none` empties it). The Validation page's Walkable tab
  draws each tile's cells, polygons and openings, with a "mark all remaining reviewed" button:
  the 105 validated Imperial tiles are reviewed, none left without NavMesh.

### Step 9 – Selection of several tiles
- **Why**: the partial bake works on a selection (D32); V1 selects one tile at a time.
- **What**: Shift+click to add or remove a tile, a rectangle drag with a modifier key, select all;
  delete and move apply to the selection too (the V4 wish of V1).
- **Done when**: a selection can be built, extended and cleared; group move and delete are undone
  in one step.
- **Result (29 Sep 2026)**: done. `grid/edit.ts` gains `moveTiles` (one offset for the group, its
  tiles free to take each other's cells) and `removeTiles`, each one undo step, refused with a
  master tile. The editor keeps a selection list (`ed.selected` is the single tile, for its
  panel): Shift+click toggles a tile, Shift+drag adds a rectangle, Ctrl+A selects all, Esc
  clears; dragging a selected tile moves the group (green or red preview), Del deletes it. The
  scene highlights every selected tile. Turning a group was not asked for.

### Step 10 – Bake: from tiles to triangles
- **Why**: the heart of the NavMesh: turn a set of tiles into one clean mesh.
- **What**: `navmesh/bake.ts` (pure): the placed walkable polygons of the selected tiles, union
  (R11: an opening narrower than the neighbour's edge, obstacles near the boundary), canonical
  vertices forced at the junctions according to the connection type (so batches baked separately
  meet on the same vertices), constrained triangulation, adjacencies and edge flags, search grid.
- **Done when**: unit tests on synthetic tiles (straight, corner, T junction, ramp); the triangles
  of a real cell drawn in the scene for inspection.
- **Commits to**: D38, R11.
- **Result (29 Sep 2026)**: done. `navmesh/bake.ts` places the tiles' walkable polygons, cuts
  each along the grid cells (`polygon-clipping`), conforms the pieces where they meet, triangulates
  them (`earcut`), welds the vertices and makes each cell Delaunay by edge flips. A full cell is
  two triangles; only the cells along the walls hold small polygons. Tried and dropped on the way:
  one triangulation per tile (long fans along the walls) and one union of the whole selection
  (large slivers across rooms). The editor's "Preview NavMesh" bakes the selection or the whole
  cell and draws it: 222 tiles in about 0.3 s, judged by the user far better than the CK's own
  generation and needing little or no hand work. The first run on the working cell was not a
  valid NAVM (an edge shared by three triangles): tiles overlapping in a cell stacked their
  triangles; the parts of each cell are now merged first, and the flat triangles ear clipping
  left on collinear border points are removed. The working cell then bakes into a valid NAVM
  (222 tiles, 2,722 vertices, 3,666 triangles, about 0.35 s).

### Step 11 – Writing the NavMesh into the plugin
- **Why**: turns a bake into NAVM records, with step 3's recipe.
- **What**: the cell's single NAVM (D36), created or rewritten with the same safe save as the
  tiles (backup, stamp check): the tiles that already have triangles are skipped (D64); the new
  triangles are added and stitched onto the existing ones on shared vertices (both sides' border
  edges split where the other's vertices lie); door triangles left to the CK.
- **Done when**: a baked batch opens in the CK, Finalize succeeds, an NPC walks on it.
- **Commits to**: D36.
- **Result (30 Sep 2026)**: done. The level store reads a cell's NavMeshes and writes a
  `navmesh` edit (an own NAVM's `NVNM` rewritten, other fields kept, or a NAVM added).
  `navmesh/stitch.ts` finds the covered tiles (D35), appends the bake to a NavMesh, splits the
  border edges of both sides where the other's vertices lie, keeps the existing triangles' data
  and lists the new borders left unlinked. A cell made in the CK may hold several NAVMs (the
  working cell has 13): coverage and exclusion use them all, the bake joins the own NAVM it
  touches most, the others stay untouched and the borders along them show in red, to link in the
  CK. The editor's "Write NavMesh" saves it with a backup. Checked in a test plugin: written,
  loaded in the CK, an NPC chases the player across the baked tiles in game. On the working cell
  (preview only): 198 of 222 tiles already covered, 24 baked into the main NAVM, 10 border
  edges to link by hand, a valid NAVM.

### Step 12 – Bake tools in the editor
- **Why**: the designer's workflow (D30–D34, D37): bake on request, redo, fill what is missing.
- **What**: "Bake selection" (tiles without NavMesh only, D64), "Fill" (selects the tiles without
  NavMesh by the geometric test of D35), "Replace" (after an explicit confirmation, deletes every
  triangle of the selected tiles and bakes them anew), "Clear" (the triangles of the selected
  tiles, confirmed), a per-cell "locked" flag with a warning before any destructive bake.
- **Done when**: bake, fill, clear and lock work on the working cell, undo included where it
  applies.
- **Commits to**: D32–D37, D64.
- **Result (30 Sep 2026)**: done. The editor's NavMesh tools: Fill, Bake (selection or whole
  cell), Replace and Clear, each previewed (the cell's NavMeshes as they would be, with a summary)
  before "Write NavMesh" saves every changed NAVM at once, with a backup; a NAVM left without
  triangles is deleted. `navmesh/stitch.ts` gains `trianglesInTiles` and `removeTriangles`
  (renumbering neighbours, door links and cover). The per-cell lock (D37) disables Replace and
  Clear; it is a UI safeguard, kept in the browser. Writing a NAVM the CK saved compressed works.
  Tested by the user in a test plugin. Still to see in game: an NPC crossing from an old NavMesh
  to a bake welded onto it (welded and valid in the preview).

## Phase D – NavMesh editing and Finalize (D65)

Added after step 11: going to the CK for every NavMesh touch-up is tiring. Steps 14 to 16 come
after step 12; the V2 milestone (step 13) closes the version.

### Step 14 – "Edit NavMesh" mode
- **Why**: the base of every NavMesh edit in the app.
- **What**: an editor mode where the selection is the NavMesh, not the tiles: triangle, edge or
  vertex sub-modes; the list of the cell's NAVMs, the chosen one drawn in its own colour; delete
  the selected triangles; wipe a whole NAVM (clean-up). Undo, and the same safe save.
- **Done when**: the working cell's NAVMs are listed, picked and highlighted; triangles are
  selected and deleted, a NAVM wiped, all undone and saved.

### Step 15 – Edit operations
- **Why**: link and repair by hand what the bake leaves (the red borders, a CK cell's many
  NAVMs).
- **What**: merge the selected vertices into one (at their mean); create a triangle from three
  vertices, even of two NAVMs; when a triangle joins two NAVMs, the smaller is merged into the
  larger, one record (D36).
- **Done when**: the working cell's NAVMs can be joined into one, its red borders linked, an NPC
  walks across in game.

### Step 16 – Finalize in the app
- **Why**: the CK's Finalize does door links, cover and the `NAVI` record; doors and `NAVI` are
  needed for NPCs to path through doors and between cells. Cover comes later.
- **What**: a proof of concept first (the `NAVI` format, as R1 was proven for `NAVM`): read and
  write it byte for byte, then add or update the cell's entries. Door links: the triangles
  under each load door linked to it. A "Finalize" button.
- **Done when**: a cell finalized in the app works in game (NPCs path through its doors, to
  another cell), and the CK opens it without errors.

## Step 13 – V2 milestone
- **What**: the success criterion above, on the V1 test dungeon and on the working cell: bake
  everything, Finalize in the CK, NPC walk through the whole dungeon in game, check the leak and
  texture marks. Frictions noted, fixed, then documentation (user guide, architecture) updated.
- **Done when**: the criterion is met; the release version is proposed and confirmed (D63),
  tagged, and published.
