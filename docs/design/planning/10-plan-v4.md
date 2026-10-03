# V4 implementation plan (release 0.4.0)

V4 builds on V3 (0.3.0, D63). It adds the **Nordic kit** (the barrows and crypts of Skyrim.esm,
`meshes/dungeons/nordic/`), the second of the base interior kits 1.0.0 requires, chosen on 3 Oct
2026. Everything V1 to V3 do for the Imperial kit (catalogue, assistant, junction checks, leaks,
textures, levels, NavMesh, Finalize) must work for it, and a cell may hold both kits, joined by
the vanilla transition pieces.

Until now the code assumes one kit in many places: one kit definition (`IMPERIAL_KIT`), one
annotation file (`data/annotations/imperial.json`), a catalogue built for one kit, collision and
walkable rules tuned on Imperial meshes. The grid module, though, is already per kit (D53): no
128 is hard-coded.

Each step says **why** it comes at that point, what it produces and when it is done. As before,
a step is done only when `npm test` and `npm run check` pass, and the risky parts are proven
before they are built on.

Success criterion of V4: _a Nordic dungeon on two levels (halls, a large room, stairs), joined
to an Imperial part by a transition piece, is built with the assistant in one cell, its leaks
and texture breaks flagged, its NavMesh baked and finalized in the app; an NPC follows the
player from the Imperial part through the Nordic one and back, in game._

## Decisions to confirm during V4

- D68 (new): **several kits in one catalogue**: every kit's pieces are analysed and offered; a
  piece knows its kit, a tile its kit's module; the palette filters by kit (step 4).
- D54 (decided in V1): kits meeting at a transition piece show both grids overlaid, each in its
  own colour, during placement (step 7).
- D69 (new): **annotations per kit**, one committed file per kit (`data/annotations/<kit>.json`),
  validated on the Validation page kit by kit (step 3).

## Phase A – Proofs of concept

The Nordic meshes have never been read by the tool: their module, pivots, faces and collision
are unknown. They are measured before anything is built on them.

### Step 1 – R19: the Nordic kit's module, pivots and faces
- **Why**: as R5 did for the Imperial kit, the module and the footprint rule decide everything
  else (grid, faces, assistant). The Nordic kit is known to be larger and less regular (curved
  walls, rubble, pieces off the grid).
- **What**: the catalogue analysis run on `meshes/dungeons/nordic/` (a proof of concept page or
  the analysis with the kit's prefix): bounds, pivots, openings and face profiles of every piece;
  the XY and Z module derived from them; the sub-folders sorted into halls, rooms, doors and
  props; the pieces that fit no grid listed.
- **Done when**: a module is written down with the share of pieces it fits, and the structural
  sub-folders are named.

### Step 2 – R20: Nordic collision and walkable floor
- **Why**: the walkable polygons (V2 step 4) read one Havok shape type
  (`bhkCompressedMeshShape`) and were tuned on Imperial floors (steps, door bevels). Nordic
  pieces may use other shapes (convex lists, MOPP over packed strips) and have rubble and uneven
  floors.
- **What**: list the collision block types of every Nordic piece; read the missing ones; run the
  walkable polygons on the kit and review them (the Walkable tab), adjusting the rules only
  where Nordic floors need it, Imperial results unchanged.
- **Done when**: every Nordic tile has a reviewed walkable polygon, or is marked as having none,
  and the Imperial walkable results are byte for byte the same.

## Phase B – Several kits

### Step 3 – Kit definitions and annotations per kit
- **Why**: the Nordic catalogue needs its own validated annotations (connection types, accepted
  overlaps, walkable reviews) without touching the Imperial ones (D69).
- **What**: `NORDIC_KIT` (prefix, sub-folders, module from step 1); one annotation file per kit;
  the Validation page works kit by kit; the Nordic faces' connection types proposed by the
  analysis and validated by the user.
- **Done when**: the Nordic catalogue is validated and committed in `data/annotations/nordic.json`,
  and the Imperial one is unchanged.

### Step 4 – One catalogue, several kits
- **Why**: a cell may hold both kits; the editor must know each tile's kit and module (D68).
- **What**: the catalogue built from every kit; a piece carries its kit; the grid of a cell is
  derived per kit (a cell's tiles grouped by kit, each on its own grid); the palette filters by
  kit; the module of every grid computation taken from the tile's kit (D53, already the rule).
- **Done when**: a vanilla Nordic cell of Skyrim.esm (opened from a copy in a test plugin) loads
  with its tiles on the Nordic grid, and the Imperial cells behave exactly as before.

## Phase C – Building with the Nordic kit

### Step 5 – Assistant and junction checks
- **Why**: the assistant and the verdicts compare face profiles: the Nordic faces (curved
  arches, uneven sills) may need new tolerances.
- **What**: build a Nordic layout with the assistant; check the verdicts (seams, mismatches),
  the deep leak check and the texture continuity on it; tune what the Nordic faces need, with
  tests built from synthetic profiles.
- **Done when**: a Nordic layout of halls and rooms is built with the assistant with no false
  mark, and a wrong junction is flagged.

### Step 6 – Levels and NavMesh on the Nordic kit
- **Why**: Nordic dungeons rely heavily on stairs and level changes; the bake per level (V3)
  and Finalize must hold.
- **What**: a two-level Nordic layout baked, welded at the stairs, finalized; checked in the CK
  and in game.
- **Done when**: an NPC follows the player up and down a Nordic staircase in game.

### Step 7 – Transitions between kits
- **Why**: real dungeons go from Imperial to Nordic (and back) through transition pieces; the
  two grids are not aligned (D54).
- **What**: the transition pieces found in step 1 marked as such (a face whose mate belongs to
  the other kit); while placing next to one, both grids are shown overlaid, each in its colour;
  the assistant offers the other kit's pieces at a transition face; the bake welds across.
- **Done when**: an Imperial part and a Nordic part are joined in one cell, with the assistant,
  and the NavMesh crosses the transition.

## Step 8 – V4 milestone
- **What**: the success criterion above, on a new mixed test dungeon. Frictions noted, fixed,
  then documentation (user guide, architecture) updated.
- **Done when**: the criterion is met; the release version is proposed and confirmed (D63),
  tagged, and published.
