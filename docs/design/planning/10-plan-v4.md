# V4 implementation plan (release 0.4.0)

V4 builds on V3 (0.3.0, D63). It adds the **Nordic kit** (the barrows and crypts of Skyrim.esm,
`meshes/dungeons/nordic/`), the second of the base interior kits 1.0.0 requires, chosen on 3 Oct
2026. Everything V1 to V3 do for the Imperial kit (catalogue, assistant, junction checks, leaks,
textures, levels, NavMesh, Finalize) must work for it. The game has no transition piece between
the two kits (step 1): they meet in separate cells, joined by load doors.

Until now the code assumes one kit in many places: one kit definition (`IMPERIAL_KIT`), one
annotation file (`data/annotations/imperial.json`), a catalogue built for one kit, collision and
walkable rules tuned on Imperial meshes. The grid module, though, is already per kit (D53): no
128 is hard-coded.

Each step says **why** it comes at that point, what it produces and when it is done. As before,
a step is done only when `npm test` and `npm run check` pass, and the risky parts are proven
before they are built on.

Success criterion of V4: _a Nordic dungeon on two levels (halls, a large room, stairs) is built
with the assistant, its leaks and texture breaks flagged, its NavMesh baked and finalized in the
app; joined by a load door to an Imperial cell, an NPC follows the player from the Imperial cell
into the Nordic one and back, in game._

## Decisions to confirm during V4

- D68 (new): **several kits in one catalogue**: every kit's pieces are analysed and offered; a
  piece knows its kit, a tile its kit's module; the palette filters by kit (step 4).
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
  props; the pieces that fit no grid listed; transition pieces with the Imperial kit looked for.
- **Done when**: a module is written down with the share of pieces it fits, and the structural
  sub-folders are named.
- **First measure (3 Oct 2026, `poc/nordic.html`, object bounds)**: 779 STATs under
  `dungeons/nordic/` in 17 sub-folders. Sizes: 256 most common (small and big rooms, pits,
  bridges), then 512 (big halls, catacombs), 1024, 768 and 384 (secret passages): 128 fits 82 %
  of the xy sizes (within 48 units, cornice overhangs as for Imperial), 256 only 60 %, so the
  XY module is likely 128, as Imperial. Z is measured on the meshes. No transition piece: none of
  the 4,083 STATs under `dungeons/` mixes the two kits (the user expected so); the kits meet
  through load doors, and the transition step was dropped. Structural sub-folders, as proposed:
  halls `smhalls`, `bghalls`, `catacombs`, `secretpass`; rooms `smrooms`, `bgrooms`; doors
  `doors`; `pits`, `shafts`, `platforms`, `bridges`, `chambers`, `temple` judged after the
  analysis; `exterior`, `rubble`, `clutter` are props.
- **Result (3 Oct 2026, mesh analysis with `NORDIC_KIT`)**: module **128 x 128 confirmed**: 166 of
  the 201 structural pieces sit on the 128 grid, every opening on an integer level. Z: small
  stairs rise 128 (one level), big stairs and ramps 256 (two); the big rooms' NIF origin lies 384
  above their floor (openings at level -3), consistently. Opening widths: small halls 224, big
  halls 448, catacombs 308 and 174, small rooms 238, big rooms 208, doorways 158 (ExSm) and 286
  (ExBg). Three things for the next steps:
  1. 35 pieces have no opening detected: the room middles (floor and ceiling only, open on all
     sides), the raised floors and every secret passage. The opening detection must learn them
     (step 3), or they stay out of the catalogue.
  2. Some big room walls join their floor (level -3) to a doorway high up (levels 0 or 3): by the
     rule "a piece occupies every level between its openings" (D59) they fill 4 to 7 levels, which
     would block the cells above. The rule needs a limit for walls (step 3).
  3. 27 profile groups for 387 faces: the connection types to validate (step 3).

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
- **Result (3 Oct 2026, `poc/nordic.html`)**: R20 is a non-issue. The 201 Nordic structural
  pieces use the same Havok chain as the Imperial ones (`bhkRigidBody` or `bhkRigidBodyT`,
  `bhkMoppBvTreeShape`, `bhkCompressedMeshShape`): every collision mesh is read, and all 166
  catalogue pieces get a walkable floor with the Imperial rules unchanged (the Imperial results
  are untouched: no code changed). The review of the Nordic floors moves to step 3, where the
  Validation page works kit by kit.

## Phase B – Several kits

### Step 3 – Kit definitions and annotations per kit
- **Why**: the Nordic catalogue needs its own validated annotations (connection types, accepted
  overlaps, walkable reviews) without touching the Imperial ones (D69).
- **What**: `NORDIC_KIT` (prefix, sub-folders, module from step 1); one annotation file per kit;
  the Validation page works kit by kit, the Nordic walkable floors reviewed there (step 2); the Nordic faces' connection types proposed by the
  analysis and validated by the user.
- **Done when**: the Nordic catalogue is validated and committed in `data/annotations/nordic.json`,
  and the Imperial one is unchanged.
- **Result (3 Oct 2026)**: done. `NORDIC_KIT` in `KITS`; the catalogue store keeps the stats and
  analysis per kit and the annotation store one set per kit, loaded from every
  `data/annotations/*.json`; the Catalogue and Validation pages have a kit picker; the editor
  stays on the Imperial kit until step 4. The Nordic meshes carry 12 to 18 vertices on an open
  side where the Imperial ones carry about 60: the opening threshold became a kit setting
  (`minOpenVerts`, 10 for Nordic, the Imperial default of 20 unchanged), which brought in the room
  middles and secret passages. The tall big-room walls spanning 4 to 7 levels are right (the
  rooms are 1,216 units high): D59 unchanged. Validated by the user: 1 merge, 9 composite faces,
  187 pieces reviewed.

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

## Step 7 – V4 milestone
- **What**: the success criterion above, on a new Nordic test dungeon and an Imperial cell joined to it by a load door. Frictions noted, fixed,
  then documentation (user guide, architecture) updated.
- **Done when**: the criterion is met; the release version is proposed and confirmed (D63),
  tagged, and published.
