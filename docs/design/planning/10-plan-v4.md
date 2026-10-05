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
- D70 (new, 4 Oct 2026): **fine grid, contextual grid**: positions at a fine step, the grid
  shown and the snapping following the selected piece, instead of one 128 grid per CELL (Phase D).
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
- **Done when**: a small Nordic layout is built, saved and reopened on its grid (the editor opens
  `.esp` files only), and the Imperial cells behave exactly as before.
- **Result (3 Oct 2026)**: done, tested by the user. The editor merges every kit's annotated
  catalogue (`catalogue/merge.ts`); connection types are prefixed by their kit, so faces of two
  kits never mate. The two kits share their module (128 x 128): one grid per cell, rather than one
  per kit; `mergeCatalogues` refuses kits whose modules differ. The palette filters by kit.

## Phase C – Building with the Nordic kit

### Step 5 – Vanilla check and junction checks
- **Why**: the user had never built with the Nordic kit and could not tell a false mark from a
  real one; the game's own CELLs, mostly right, are the reference instead.
- **What**: a "Vanilla check" page (Settings): for the chosen kit, the master's CELLs built with
  it are read like the editor reads a plugin; it reports the pieces on a grid and why the others
  are not, the groups of pieces sharing one grid and their offsets, and the bad junctions by
  pair of pieces. The frequent bad pairs are reviewed and, when Bethesda uses them, accepted in
  the annotations.
- **Done when**: the page runs on both kits, and the Nordic pairs Bethesda uses are no longer
  flagged.
- **First run (4 Oct 2026)**: Nordic, 95 CELLs, 13,584 pieces: 79 % on a grid, but only 9,276 on
  the CELL's main grid; 1,455 in 94 groups offset from it, by multiples of 32 in XY and of 16 in
  Z for the most part ((64, 64, 0), (0, 32, 0), (64, 0, 64), (0, 0, -16)...), a few by arbitrary
  amounts ((46, 55, 8)...); a recurring (±17, 0, 0) pair is likely a pivot error of the
  catalogue; 1,995 pieces turned by other angles than 90°, nearly all in caves. Junctions: 0
  seams and 420 mismatches, nearly all on a few pairs (damaged small room walls against room
  middles, corners against secret room walls). Imperial, 50 CELLs: 67 % on a grid, the most
  frequent offset half a level (0, 0, 64); 33 seams and 76 mismatches spread over many pairs.
  This led to D70.

## Phase D – Fine grid (D70)

The game's CELLs place the pieces on a 128 grid but shift parts of a CELL by 16, 32 or 64 units:
one 128 grid per CELL cannot read them, and the assistant cannot offer a piece that fits only
with such a shift. D70: positions are kept at a fine step (16 units), the grid shown and the
snapping follow the selected piece.

### Step 6 – Positions at the fine step
- **Why**: the base of D70; everything else uses it.
- **What**: a kit's fine step (16 in XY and Z for Imperial and Nordic, kit data, D53); a tile's
  position held in fine steps instead of 128 cells; its occupied space computed at that step
  (overlaps and shared cells); reading a CELL places every piece whose corner falls on the fine
  step, the rest stays opaque (shown, not edited); the pivot error behind the (±17, 0, 0) offset
  found and fixed first. Saving unchanged (world positions).
- **Done when**: the Vanilla check finds nearly every Nordic and Imperial piece of the walls and
  floors in one grid (the arbitrary offsets and other angles aside), and the editor opens and
  saves the test cells exactly as before.
- **Result (4 Oct 2026)**: done, in two parts.
  1. The (±17.5, 0, 0) offset was a pivot error: `NorRmBgWallSide01` (and its snow and ice
     variants) has a gallery doorway high in the wall, set 17.5 units into it; the analysis took
     the piece's grid from that doorway. The grid is now set by the openings at the piece's
     floor level, else by a box edge on the grid. Only those three pieces change; every Imperial
     piece is unchanged (pivots and faces compared before and after on the game files).
  2. Fine positions (option B, see D70's reasons): a kit's `fineStep` (16 in XY and Z for both
     kits); `deriveGrid` places a corner off the module grid by a multiple of the fine step at a
     fractional cell index (3.125 for 16 at 128); levels take the floor of the index.
  Measured on the game files: Nordic, 10,911 of the 11,341 pieces that are neither turned by
  other angles, tilted nor scaled (96 %) now on the CELL's grid (9,276 before), 77 left off it;
  Imperial, 2,757 of 2,994 (92 %, 1,724 before), 14 left off it. What remains are a few groups
  shifted by arbitrary amounts ((45.7, 54.7, 8.4)...), placed by hand.

### Step 7 – The contextual grid
- **Why**: the designer works on 128 as before; finer steps appear only where a piece needs them.
- **What**: the grid drawn and the snapping step are 128 by default, on the CELL's main grid;
  selecting a piece shows its own 128 grid, through its corner (a piece shifted by 16 shows a
  grid shifted by 16, and so do the pieces plugged into it); dragging moves by 128 keeping that
  offset; a step selector (and a key) switches to 64, 32 or 16; a piece placed from the palette
  in the void goes on the grid of the last selected piece, else the main grid.
- **Done when**: a 128 + 16-shifted + 128 chain is built and moved, each piece showing its own
  grid when selected.

### Step 8 – The assistant at every offset
- **Why**: at an open face, every piece that fits must be offered, whatever shift it needs.
- **What**: the candidates of a face computed at the exact position the face imposes, in fine
  steps; snapping from the palette onto a face the same way; the junction verdicts, leaks and
  texture continuity working on fine positions.
- **Done when**: the pieces Bethesda joins with a 16 or 32 shift are offered at their face, and
  placing one switches the grid to its offset.

### Step 9 – Levels and NavMesh on the fine grid
- **Why**: levels and the bake used 128 cells: shifted pieces must still be baked and shown on
  the right level.
- **What**: levels stay 128 high for display, a piece's level from its fine Z; the bake still cut
  along the CELL's main 128 grid; coverage (D35) and Fill from the fine positions.
- **Done when**: a layout with shifted parts is baked, welded and finalized, and walked by an NPC
  in game.

### Step 9b – What the game builds is right
- **Why**: the checks still flag pairs of pieces Bethesda puts together everywhere (texture breaks
  that do not show, junction mismatches such as damaged walls against room middles); the user
  cannot tell which flags to trust on a kit they do not know. Asked by the user on 4 Oct 2026, for
  the end of V4.
- **What**: from the Vanilla check, the pairs of pieces (and their relative placement) the game
  joins are recorded per kit; the junction verdicts and the texture continuity do not flag a pair
  the game uses, or flag it as "seen in the game" rather than as an error.
- **Done when**: the Nordic and Imperial false marks of the Vanilla check are gone, and a wrong
  pair the game never uses is still flagged.

## Phase E – Building with the Nordic kit

### Step 10 – Levels and NavMesh on the Nordic kit
- **Why**: Nordic dungeons rely heavily on stairs and level changes; the bake per level (V3)
  and Finalize must hold.
- **What**: a two-level Nordic layout baked, welded at the stairs, finalized; checked in the CK
  and in game.
- **Done when**: an NPC follows the player up and down a Nordic staircase in game.

## Step 11 – V4 milestone
- **What**: the success criterion above, on a new Nordic test dungeon and an Imperial cell
  joined to it by a load door. Frictions noted, fixed, then documentation (user guide,
  architecture) updated.
- **Done when**: the criterion is met; the release version is proposed and confirmed (D63),
  tagged, and published.
