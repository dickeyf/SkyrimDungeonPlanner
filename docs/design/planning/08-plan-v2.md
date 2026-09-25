# V2 implementation plan (release 0.2.0)

V2 builds on V1 (0.1.0, D63), still on the Imperial kit and a single Z level. It adds three things,
chosen on 25 Sep 2026:

1. **Texture continuity** at junctions (step 14b of `07-plan-v1.md`), optional.
2. **Deep junction check** (R16, phase 2b of the roadmap): detect the visible leaks the profiles
   cannot see.
3. **Basic NavMesh** (phase 3): bake a NavMesh on the tiles, on request.

Each step says **why** it comes at that point, what it produces and when it is done. As for V1, a
step is done only when `npm test` and `npm run check` pass, and the risky parts are proven before
they are built on.

Success criterion of V2: *the 30-tile Imperial dungeon of the V1 test gets a NavMesh baked by the
tool in one click; the CK finalizes it without errors, an NPC walks from one end of the dungeon to
the other in game; the leaks and texture breaks of the working cell are flagged.*

## Decisions to confirm during V2

The NavMesh decisions still "Proposed" become binding here; each step says when:

- D35: "tile without NavMesh" = a geometric test on the existing triangles (step 12).
- D36: one NAVM record per baked batch; the tool only deletes the NAVMs it created (steps 1, 12).
- D37: "locked" flag per cell once in the finishing phase (step 12).
- D38: walkable polygons per tile, union, triangulation, canonical boundary vertices (steps 4, 10).
- Where to store the tool's own state (the NAVMs it created, the lock): postponed from V1
  (`02-data-model.md` §3); decided at step 12.

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

### Step 3 – R1: write a valid NAVM for one tile
- **Why**: the core risk. If the CK or the game rejects a generated NavMesh, the whole phase
  changes (fallback: generate only a guide for the CK).
- **What**: by code, the NavMesh of ONE hallway tile (triangles drawn by hand in the test,
  adjacencies, edge flags, search grid computed), added to a copy of the plugin next to it. Open
  in the CK, Finalize, have an NPC walk on it in game.
- **Done when**: the CK accepts it without errors, Finalize succeeds, the NPC moves around; what
  Finalize adds or rewrites is recorded (the tool may leave those parts to it).
- **Commits to**: R1.

### Step 4 – R4: walkable polygon of a tile
- **Why**: the NavMesh of a level is assembled from per-tile walkable polygons (D38); their
  quality decides the quality of the bake.
- **What**: read the tile's collision from the NIF (`bhk*` blocks; the render mesh's upward-facing
  triangles as a fallback), keep the upward-facing surfaces, project, union, then erode against
  the walls by the actor radius. Prototype on three tiles: a hallway, a room corner, a door.
- **Done when**: clean polygons with few vertices, comparable to what a designer would draw,
  shown over the tile in a test page.
- **Commits to**: R4, D38.

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

## Phase C – NavMesh

### Step 8 – Walkable polygons in the catalogue
- **Why**: every tile needs its polygon before a level can be baked; the analysis must be checked
  by a human like the connection types were.
- **What**: step 4's algorithm on every tile of the kit, stored in `Piece.walkable` (the field
  exists since V1, `null` so far); a Validation tab to view them over the tile and exclude or
  correct a bad one (annotations).
- **Done when**: every validated Imperial tile has a polygon, reviewed.

### Step 9 – Selection of several tiles
- **Why**: the partial bake works on a selection (D32); V1 selects one tile at a time.
- **What**: Shift+click to add or remove a tile, a rectangle drag with a modifier key, select all;
  delete and move apply to the selection too (the V4 wish of V1).
- **Done when**: a selection can be built, extended and cleared; group move and delete are undone
  in one step.

### Step 10 – Bake: from tiles to triangles
- **Why**: the heart of the NavMesh: turn a set of tiles into one clean mesh.
- **What**: `navmesh/bake.ts` (pure): the placed walkable polygons of the selected tiles, union
  (R11: an opening narrower than the neighbour's edge, obstacles near the boundary), canonical
  vertices forced at the junctions according to the connection type (so batches baked separately
  meet on the same vertices), constrained triangulation, adjacencies and edge flags, search grid.
- **Done when**: unit tests on synthetic tiles (straight, corner, T junction, ramp); the triangles
  of a real cell drawn in the scene for inspection.
- **Commits to**: D38, R11.

### Step 11 – Writing the NavMesh into the plugin
- **Why**: turns a bake into NAVM records, with step 3's recipe.
- **What**: one NAVM per baked batch (or step 1's fallback), written with the same safe save as
  the tiles (backup, stamp check); door triangles left to the CK. The tool records which NAVMs
  it created.
- **Done when**: a baked batch opens in the CK, Finalize succeeds, an NPC walks on it.
- **Commits to**: D36.

### Step 12 – Bake tools in the editor
- **Why**: the designer's workflow (D30–D34, D37): bake on request, redo, fill what is missing.
- **What**: "Bake selection", "Fill" (selects the tiles without NavMesh by the geometric test of
  D35), "Clear the tool's NavMesh" (only the NAVMs it created), a per-cell "locked" flag with a
  warning before any destructive bake; the tool's own state stored as decided then. Stitching to
  NavMesh already in the cell attempted (D33), otherwise left to the CK's Finalize.
- **Done when**: bake, fill, clear and lock work on the working cell, undo included where it
  applies.
- **Commits to**: D32–D37.

## Step 13 – V2 milestone
- **What**: the success criterion above, on the V1 test dungeon and on the working cell: bake
  everything, Finalize in the CK, NPC walk through the whole dungeon in game, check the leak and
  texture marks. Frictions noted, fixed, then documentation (user guide, architecture) updated.
- **Done when**: the criterion is met; the release version is proposed and confirmed (D63),
  tagged, and published.
