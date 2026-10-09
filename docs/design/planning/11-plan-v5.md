# V5 implementation plan (release 0.5.0)

V5 builds on V4 (0.4.0, D63). It adds the **Dwemer kit** (the ruins of Skyrim.esm,
`meshes/dungeons/dwemer/`), the third of the base interior kits 1.0.0 requires, chosen on 7 Oct
2026, and three things asked after V4:

- the **objects placed in the Creation Kit** (furniture, clutter, lights, markers...): shown,
  selected and moved with the tiles, instead of only passing through untouched;
- the **Nordic families left out at V4 step 1** (temple, pits, shafts, platforms, bridges,
  chambers), judged one by one;
- **help for a designer new to a kit**: the sets of pieces that fill a wide open face, and the
  piece that closes one, from what the game builds.

Each step says **why** it comes at that point, what it produces and when it is done. As before,
a step is done only when `npm test` and `npm run check` pass, and the risky parts are proven
before they are built on. The user decides the order of the steps.

**Why Dwemer, not caves or mines**: the Dwemer kit is built on a grid like the Imperial and
Nordic kits, so V4's machinery (several kits, fine grid, Vanilla check, game pairs, walkable
analysis, 3D review) should carry over with measurements rather than new concepts; mines are
half kit, half cave, and caves (837 green and 605 ice pieces, angles other than 90°, D7) are the
largest piece of work left before 1.0.0, best started once the editor handles the other objects
of a cell and the deep junction check is the main tool. Set aside for now: caves, mines.

**Why the other objects now**: building a dungeon does not end with the tiles. Moving a room
after it is furnished and lit, in the tool, left its furniture, lights and markers behind, to be
moved one by one in the CK; and the objects, drawn over the tiles, get in the way. Until now the
tool never edited anything but tiles (D22, the "tiles only" limit): D71 changes that rule.

Success criterion of V5: _a Dwemer dungeon on two levels (halls, a large room, stairs or a
ramp) is built with the assistant, its NavMesh baked and finalized in the app, and joined by a
load door to a Nordic cell, an NPC following the player there and back in game; a furnished and
lit room (furniture, clutter, lights, markers placed in the CK) is moved in the tool with its
contents, which stay in place in the room, in the CK and in game._

## Decisions to confirm during V5

- D71 (new): **the other objects of a cell are editable**: every reference of the working
  plugin's cell is shown by category, and may be selected and moved with the tiles; the
  categories can be hidden, faded and made unselectable. The masters' references stay
  read-only, as the tiles' (D22: only the plugin's own FormIDs are modified). Why: see above. Options set aside: moving the tiles and offering to "carry"
  the objects found inside them on save (hidden and surprising); leaving the objects to the CK
  (the current rule, the friction the user met).
- D72 (new): **what an object belongs to**: when tiles move, the objects that move with them are
  those the user selected (a rectangle selects both), never guessed; a single object is moved on
  its own. Why: an object near a wall may belong to either room; guessing it from its position
  would sometimes carry the wrong one, and a selection is visible before the move.

## Phase A – Proofs of concept: the Dwemer kit

The Dwemer meshes have never been read by the tool. As for the Nordic kit (R19, R20), their
module, pivots, faces and collision are measured before anything is built on them.

### Step 1 – R21: the Dwemer kit's module, pivots and faces
- **Why**: the module and the footprint rule decide everything else (grid, faces, assistant).
  The Dwemer kit has more families than the others (`smrooms`, `lgrooms`, `smhalls`, `bghalls`,
  `lghalls`, `walls`, `pipes`, `platforms`, `roads`, `facades`...), some of which may not be
  tiles at all.
- **What**: the analysis run on the Dwemer families: the XY and Z module, the pivots, the
  openings and their profiles; the families that are tiles, and those left out with the reason.
  The Vanilla check (V4 step 5) on the game's Dwemer CELLs measures the same thing from what
  Bethesda built: the share of pieces on one grid, the offsets, the angles.
- **Done when**: the module and fine step are known (kit data, D53), most pieces of the chosen
  families sit on the grid of the game's CELLs, and the families left out are noted with their
  reason (roadmap).
- **Result (7 Oct 2026, the analysis and the Vanilla check with a provisional `DWEMER_KIT`)**:
  428 STATs under `dungeons/dwemer/` in 14 families. There is no small hall family: the small
  halls are in `facades` (`DweFacadeHallSm...`), with the towers, lifts, bridges, balconies and
  partitions. Families taken: halls `bghalls`, `lghalls`, `facades`; rooms `smrooms`,
  `lgrooms` (181 pieces). Left out: `animated` (the observatory and repository chambers, set
  pieces), `platforms` (the exterior platforms of Blackreach and the ruins' outside), `roads`
  (Blackreach's curved roads, 45-degree pieces), `pipes`, `walls`, `partitions`, `rubble`,
  `clutter`, the root folder (chandeliers, sconces): props or set pieces, never joined by an
  opening.
  - **Module 128 x 128 confirmed**: the 82 pieces with openings all sit on the 128 grid, every
    opening on an integer level; the 99 others (bridges, balconies, tower roofs and spacers,
    partitions, shaft bottoms, shelves) have none and stay out of the catalogue on their own.
    Opening widths: big halls 704 (768 x 768 pieces), large halls 448, small halls 300, small
    rooms 384 and 512, large rooms 608 and 768, the large room's long walls 1,984; ramps rise
    two levels (256); the large room's top (`DweRmLgMidTop01`) opens 7 levels up, a gallery.
  - **The game's CELLs**: in the 37 ruins (Markarth's interiors, built with the kit scaled by
    0.75 or 0.5, and the caves and mines that borrow a few pieces, set apart), 2,774 kit
    pieces: **54 % on the main grid**, 5 % in sections offset from it by free amounts (not on
    the 16 step), and about **29 % turned by angles other than 90°**: whole parts of
    Avanchnzel, Bthardamz, Raldbthar, Mzinchaleft and Alftand turned by 45, 135, but also 74,
    164 or 254 degrees. The fine step stays 16 (as for the other kits): it serves the tool's
    own building; the game's free offsets and angles stay opaque.
  - **Junctions**: where the game's pieces are read, 0 seams and 87 mismatches, spread over
    pairs used twice or three times (half small room walls against room middles, a small room
    against a large room 48 lower): the analysis agrees with the game.
  - For the next steps: (1) the turned parts of the ruins are lost to the Vanilla check, so to
    the game's pairs; reading each turned part on its own grid would bring them back (step 3,
    if the pairs are too few); (2) which `facades` pieces are tiles (the towers and their
    arches are outside pieces) is decided at validation (step 3).

### Step 2 – R22: Dwemer collision and walkable floor
- **Why**: the NavMesh comes from the collision; the Dwemer pieces have pipes, grates, gears and
  stairs the walkable rules have never met (risers, soffits and arches were all found on the
  Nordic kit only by baking).
- **What**: the walkable floor of every Dwemer tile, reviewed in the Walkable tab in plan and in
  3D; the cases the rules get wrong fixed, or the piece marked without NavMesh. Measured as in
  V4: how many floors change on the other kits for each rule change (none should, or each change
  is reviewed).
- **Done when**: every Dwemer tile's floor is reviewed or set aside, and the Imperial and Nordic
  floors are unchanged.
- **Result (8 Oct 2026)**: R22 is settled for the reading: every collision of the 82 Dwemer
  catalogue pieces is read (the same Havok chain as the other kits), with no code change, so the
  Imperial and Nordic floors are untouched. The walkable floors, measured as the share of a
  level they cover: the small halls 82 to 100 %, the small rooms 62 to 100 %, the big halls 57 to
  98 % (two of them with two holes), the large rooms 61 to 100 % (the floor 28 below the opening,
  a sunken centre); to look at in the review: the large halls cover only 42 to 75 % (side
  channels, or a floor cut too far?), the lifts (`DweFacadeLift...`) are 4 small parts (8 %),
  and 16 pieces have no floor at all: the towers and their partitions (outside pieces), the free
  doorway `DweFacadeFreeExBg01` and the large room's top (`DweRmLgMidTop01`, a ceiling with a
  gallery opening). As for the Nordic kit (V4 step 2), the review itself moves to step 3, where
  the Validation page shows the kit's floors in plan and in 3D.

## Phase B – Building with the Dwemer kit

### Step 3 – Kit definition, annotations and game pairs
- **Why**: the editor offers a kit once it is defined, analysed and validated (D68, D69).
- **What**: the Dwemer kit definition (families, categories, module, fine step); its annotations
  validated on the Validation page (`data/annotations/dwemer.json`); the game's pairs from the
  Vanilla check (`data/vanilla/dwemer.json`).
- **Done when**: the editor offers the Dwemer pieces, and the junctions the game builds are not
  flagged.
- **Changed (8 Oct 2026, the user's request)**: no review piece by piece; **the pieces the game
  uses are the ones validated**. The Vanilla check now counts how many times the game places
  each piece at its own size (`VanillaReport.used`; the scaled pieces, Markarth's interiors
  built with the kit at 0.75, are not counted), and `validateUsed` validates the pieces placed
  at least twice (`MIN_VANILLA_COUNT`, as for the game's pairs) and excludes the others with the
  reason; the other annotations are kept. A dev button on the Vanilla check page writes the
  kit's file ("Validate the pieces the game uses"). Why: a designer new to a kit cannot judge each
  piece, what the game builds is right (V4 step 9b), and a piece the game never uses (a set or
  outside piece, a snow variant) would only clutter the palette. Set aside: validating every
  piece with openings (the palette would offer pieces never seen in a ruin).
- **Result (8 Oct 2026)**: **63 of the 82 Dwemer pieces validated**, the 19 others excluded: the
  snow and ice variants (the interiors never use them), `DweRmLgWallMidWall02` and `03`, the
  towers 3x3 to 5x3, `DweFacadeTowerArchXtnd128`, and three pieces placed once. **635 game
  pairs** (`data/vanilla/dwemer.json`). The kit is in `KITS`: the editor offers it. The walkable
  floors are not reviewed one by one either: they are checked by building (step 4).

### Step 4 – A Dwemer test dungeon
- **Why**: as for the Nordic kit (V4 step 10), building is where the analysis is really tested:
  the assistant, the junction checks, textures, levels, NavMesh and Finalize, all on the new kit.
- **What**: a Dwemer cell on two levels built with the assistant; what goes wrong noted, fixed,
  and recorded with its reason.
- **Done when**: an NPC follows the player up and down between the two levels in game.

## Phase C – The other objects of a cell (D71, D72)

Until now a cell's objects other than tiles are drawn in grey (or faded, or hidden), all
together, and never edited.

### Step 5 – Objects by category
- **Why**: showing, hiding and selecting objects needs to know what they are; the base record
  type tells it.
- **What**: every reference of the cell given a category from its base record: furniture
  (`FURN`), containers (`CONT`), lights (`LIGH`), clutter (`MISC`, `STAT` and `MSTT` outside the
  kits, `ACTI`...), markers (`XMarker`, idle and patrol markers, `TXST` decals...), actors
  (`NPC_`, `ACHR`), doors (`DOOR`), sounds, and other. Pure TypeScript, tested on synthetic
  records.
- **Done when**: the categories of the test cells match what the CK shows, every reference has
  one, and none is lost on save.

### Step 6 – Show, fade, hide and lock by category
- **Why**: the objects, drawn over the tiles, get in the way; the user wants each kind visible,
  faded or hidden, and selectable or not.
- **What**: a panel with one line per category: visible, faded (very transparent) or hidden, and
  a "selectable" checkbox; remembered per browser. Objects drawn with their mesh (textured view
  too), markers with a small symbol, lights with their radius on demand.
- **Done when**: the user can bring out only the lights, or hide the clutter, in a furnished
  test cell.

### Step 7 – Select and move objects with the tiles
- **Why**: the friction itself: moving a furnished room.
- **What**: the selection (click, Shift+click, Shift+drag rectangle, Ctrl+A) takes the
  selectable objects as well as the tiles; a group move carries them by the same offset; a
  single object can be moved and turned on its own (Z rotation; other angles kept). Undo and
  redo as for tiles; saving writes their new positions (their FormIDs kept); the masters'
  objects stay read-only (D22). Risk R23. A door's teleport: when a door moves, the other door's
  destination (its `XTEL`) points at the old place, and is updated or flagged (to be measured).
  The NavMesh under a moved room is marked stale (the existing Replace bakes it again).
- **Done when**: the criterion's furnished room moves in the tool with its contents and stays
  right in the CK and in game.

## Phase D – The Nordic families left out

### Step 8 – Temple, pits, shafts, platforms, bridges, chambers
- **Why**: set aside at V4 step 1 to keep V4 within reach; 1.0.0 needs every family, and their
  pieces appear in the game's Nordic CELLs.
- **What**: each family measured (on the grid or not, openings that join the kit's halls,
  floors) with the Vanilla check and the analysis; those that fit become tiles, the others are
  left as objects (now editable, phase C), with the reason.
- **Done when**: each family is in, or out with its reason, and the Nordic test cells still
  check clean.

## Phase E – Help for a designer new to a kit

### Step 9 – Sets for a wide face, and the piece that closes one
- **Why**: asked on 7 Oct 2026: the long open face of `NorRmSmWallFrontExBg01` takes three
  `NorRmSmMid01` side by side, or one `NorRmSmWallSideExBg01`, which a designer new to the kit
  does not guess; the assistant offers one piece at a time, each fitting only part of the face.
- **What**: for an open face, the sets of pieces that fill it together (side by side, each
  fitting its part), and the pieces that close it (a cap, a wall), ranked by what the game
  builds there (the Vanilla pairs: the pieces the game puts in front of this piece, and with
  which neighbours). Shown in the assistant's list as one entry each, placed in one step.
- **Done when**: on the two cases above, the assistant offers the set and the closing piece,
  and the user builds a Nordic room without searching the palette.

## Step 10 – V5 milestone
- **What**: the success criterion above, on a new Dwemer test dungeon joined to a Nordic cell,
  and a furnished room moved with its contents. Frictions noted, fixed, then documentation
  (user guide, architecture) updated.
- **Done when**: the criterion is met; the release version is proposed and confirmed (D63),
  tagged, and published.
