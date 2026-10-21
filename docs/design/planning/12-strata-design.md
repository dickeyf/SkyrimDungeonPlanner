# Strata: pieces the game stacks in the same space (design, in progress)

Status: **idea under study, not decided** (20 Oct 2026). Opened during V5 step 8 (the Nordic
temple). Nothing is coded yet. This note keeps the reasons, the idea and every measurement so the
work can resume from a fresh context.

## 1. Where it comes from

V5 step 8 added the Nordic `temple`, `pits`, `bridges` and `chambers` families to the kit. The
assistant recall harness (`rc`, a game neighbour removed then offered again) gave:

- pits: 75 % (2018 / 2686);
- temple and chambers: 19 % (105 / 543), or 53 % (150 / 281) without the temple's "layer"
  pieces: `NorTmpHallBg1wayCover01`, `NorTmpHallBg1wayShadowCap01/02/Ex01`,
  `NorHallOfStoriesArch01`.

These pieces are put by the game **on top of another structure piece, on the same footprint**.
The tool refuses them: they share cells with their base (an occupancy conflict, D58), and their
faces are judged against the base's neighbours.

Two ways were offered to the user:

1. treat them as **objects** (D71 objects: placed freely, not on the grid, not judged);
2. treat them as **structure**: a full model of pieces sharing space.

The user chose **2**: "a complete solution that treats structures as structure and not as
objects... I want to think it through to reach complete software." Option 1 is set aside for that
reason: these pieces belong to the build (walls, ceilings, walkways), the assistant must offer
them and the junction checks must see them.

## 2. Measurement 1: shared grid cells (harness `ly`)

`tools/measure/ly.test.ts.txt`. Method: every game CELL with 15+ validated tiles of a kit, grid
derived as the editor does (`deriveGrid`, `layoutFromGrid`), pairs of tiles whose footprints share
cells, grouped by pair and relative placement (`relativePlacement`), kept when seen twice or more.

| Kit | Tiles | Tiles sharing cells | Pairs seen 2+ | Nature |
|---|---|---|---|---|
| Imperial | 2827 | 123 | 7 | level designers' duplicates (door into wall, mid into wall) |
| Nordic | 12424 | 396 | 45 (33 sharing half or more) | temple layers; rooms stacked on themselves (`NorRmBgMid02` twice); catacomb crossings (~5 %) |
| Dwemer | 1916 | 99 | few | mostly `DweFacadeTowerArch01` crossing (17 %) |

Temple detail: `Cover01` over `Wall01/02/03`, `ToHallBg01`, `Entrance01`, `StairsDown` (offset 0
or close, 100 % of the cells); `ShadowCap01/02/Ex01` on walls and at the end of a `Cover`,
offset about 4 to 5 cells.

**Limit found by the user**: this only sees pieces already in the kits (shafts, platforms and
Dwemer families left out are absent), only grid cells (a piece inside a tall room's empty volume
can share none), and no caves. The user expected stacking to be common in multi-level dungeons
with walkways (Nordic, Dwemer, caves).

## 3. Measurement 2: real bounds, all families (harness `ns`)

`tools/measure/ns.test.ts.txt`. Method: every STAT under `meshes/dungeons/{nordic,dwemer,caves}`
(families left out included), clutter under 96 units dropped. Each REFR's OBND box is turned by
its heading (tilt ignored) and scaled. For each pair of same-kit REFRs in a CELL whose boxes
overlap by 16+ units on every axis (A the larger by volume, B the smaller):

- `inPlan` = share of B's plan under A; `planRatio` = B's plan / A's plan; `zIn` = share of B's
  height inside A's;
- **layer**: `inPlan > 0.8`, `planRatio > 0.6`, `zIn > 0.5`;
- **nested**: `inPlan > 0.8`, `zIn > 0.8`, `planRatio < 0.6`; split by B walkable (collision
  triangles facing up, normal z > 0.7, area > 64²) and raised (B's bottom 96+ above A's);
- **partial**: `inPlan > 0.3`; otherwise ignored.

The classes are rough; rubble, vines and boulders (dressing) add a lot of noise.

STAT counts under `dungeons/`: caves 1546, nordic 779, imperial 525, mines 498, dwemer 428,
riften 145, ship 89.

### Nordic (771 pieces, 40077 REFRs)

- **Layers beyond the temple**: `NorRmBgMidCeilingOnlyLow01` (a low ceiling) on `NorRmBgMid02`
  142, `NorRmBgWallSide01` 71, `CorInL01` 42, `WallFront01` 41, `CorInR01` 40 (about 340).
  Temple `temple > temple` 75. Façade-like `exterior > exterior` 174.
- **Nested walkable pieces** (the `platforms` family, left out at V4, and raised floors): on the
  floor `NorRmBgMid02 > NorPlatWallStair01` 67, `> NorPlatWall01` 46,
  `NorTmpHallBg1wayCover01 > NorRmSmFloorRaised01` 48; raised `Cover01 > NorPlatBgFloorRaised01`
  27, `> NorPlatWall01` 18, `NorExtWallBg1WayCurve01 > NorTmpExtPlatFloorRaised01` 22.
- **Pits and shafts**: `NorPitWallSide01 > NorPitWallSideEnclosure01` 19,
  `NorRmShaftMidStair01 > NorRmShaftMidStairDeck01` 18.
- Classes: partial 54907 pairs, dressing 3439, nested on the floor 4972, nested raised 2030,
  layer 2419 (rubble dominates each).

### Dwemer (385 pieces, 27456 REFRs)

- **Walkways are mostly pipes**: `DwePipe1way01/2way01` raised inside large rooms and halls
  (`DweRmLgWall01` 184 + 80, `DweRmLgCorIn01` 126 + 99, `DweRmLgMid01` 54 + 39,
  `DweHallLg4way01` 58, `DweHallLgEndCap01` 60...), about 1800 in all; `lgrooms > pipes` 1323.
  They have a walkable floor.
- **Platforms** in large rooms: `DweRmLgCorIn01 > DwePlatWall01` 31, `DweRmLgWall01 >` 28.
- **Layers**: `DweFacadeBridgePar4way01/2way01/3way01` exactly on `DweHallLg4way01/2way01/3way01`
  (19, 12, 7); `DwePtnWallCap01` on partition walls.
- Classes: nested on the floor 3142, partial 28598, nested raised 4824, dressing 3735, layer 696.

### Caves (1519 pieces, 39398 REFRs)

Almost all free rock: boulders, mounds, cliffs overlapping each other with no grid
(`CaveGBoulderL02 > CaveGBoulderL02` 1768...), a few `Balcony` pieces. A different kind of kit,
sculpted rather than modular; **kept out of this design**, to be studied on its own.

## 4. The idea: strata

Geometrically a "layer" (a ceiling on a room tile) and a "nested network" (pipes through a
large room) are the same thing: pieces sharing the volume of others. What differs is the
**behaviour**:

- a layer is **attached** to one structure piece: always at the same offset (`Cover01` on its
  wall), it follows its base when moved, it connects to nothing but other layers;
- a pipe **belongs to no room**: a chain of `DwePipe1way01` crosses several room tiles (`Wall`,
  `Mid`, `CorIn`) at varied places and heights; it connects to other pipes, not to the room;
  moving one room tile must not drag a pipe, or the chain breaks.

Proposed model: every piece belongs to a **stratum**:

| Stratum | Examples | Attached to a host? |
|---|---|---|
| structure | rooms, halls, doors (today's tiles) | no |
| dressing (layer) | `Cover`, `ShadowCap`, `CeilingOnlyLow`, `FacadeBridgePar`, `PtnWallCap` | yes, at a placement learned from the game |
| inner network | Dwemer pipes, Nordic and Dwemer platforms, raised floors | no |

Rules:

- **occupancy and junctions are judged within one stratum**: a pipe never conflicts with the
  room it crosses, but does with another pipe; a `Cover` end mates with another `Cover` or a
  `ShadowCap`, never with the wall next to it. This allows 3+ pieces in one cell, one per stratum
  (or more);
- **a stack is not limited to two pieces**: the temple has `Wall01` + `Cover01` + a `ShadowCap`
  at the `Cover`'s end; a Nordic room has `NorRmBgMid02` + `CeilingOnlyLow01` + a `FloorRaised`;
- a **dressing** piece is attached to its structure piece (pairs host / guest / relative
  placement learned from the CELLs, like the junction pairs in `data/vanilla/<kit>.json`): it
  moves, turns and is deleted with its host; the assistant offers it at that exact place;
- an **inner network** piece has its own faces and is joined by the usual junction judgement,
  possibly on a fine Z grid; it brings walkable floor at another height, so it touches Z levels
  and multi-storey NavMesh.

Questions still open (to settle with the user before a decision):

- how a piece's stratum is known: learned from the game (a piece almost always placed inside
  another), per family in the kit definition, or annotated;
- whether stacks larger than two exist often enough to matter (measurement 3 below);
- how the editor shows and selects pieces in a stack (a click takes the visible one; the info
  panel lists the stack);
- whether the inner network is its own step or milestone (it brings back `platforms` and the
  Dwemer pipes, and needs Z work).

Options already set aside:

- **objects** (option 1 above): refused by the user, the pieces are structure;
- **a merged composite piece** (Wall + Cover as one): the game combines them freely (`Cover` on
  five bases, `ShadowCap` at several offsets); a merge would freeze the combinations;
- **hand annotation piece by piece**: the user does not want to validate piece by piece, and the
  game data gives the answer;
- **two separate concepts** (layer pairs only, then a "nested network" later): the user pointed
  out they are geometrically the same; strata cover both with one rule.

## 5. Next measurement (harness 3, to do)

1. **Stack depth**: per grid cell (or per box overlap cluster), how many pieces share it, per
   kit and per family; how often 3 or more.
2. **Attached or free**: for pipes and platforms, how varied their placement is relative to the
   room tile they sit in (distinct offsets and rotations per host piece). Few placements per host
   = attached (dressing); many = free (inner network).
3. Then a decision (`D73`) in `01-decisions.md`, with the reasons and options from this note.

## 6. How to rerun the harnesses

The harnesses are throwaway Vitest files kept as `tools/measure/*.test.ts.txt` (not run by
`npm test`). To run one: copy it to `src/<name>.test.ts`, then
`DIAG_OUT=<output file> npx vitest run src/<name>.test.ts`; delete the copy afterwards. They read
the game data at `C:/games/Game Root/Data` (`Skyrim.esm`, `Skyrim - Meshes0/1.bsa`); change
`DATA` for another install. Game files are never committed.
