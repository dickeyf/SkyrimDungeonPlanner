# 4. Catalogue

The catalogue is the only data the tool owns (D10, D12, D13): the kit's pieces, where they sit on
the grid, and which of their faces connect to which. It is **computed from the user's own game
files** (D46), then corrected by committed human annotations; no game data is distributed.

## Model (`catalogue/types.ts`)

- **Kit**: name and grid module, measured per kit (`Kit.module`, 128 × 128 for the Imperial
  kit, D51, D53).
- **Piece**: EditorID, FormKey, model path, category (hall, room, door), `pivot` (the NIF
  origin relative to the min corner of the piece's cell (0,0,0) at rotation 0), `cells` (the
  grid cells it occupies at rotation 0), `faces`.
- **Face**: the cell behind it, a direction (`+X`, `-X`, `+Y`, `-Y`), a connection type
  `conn`, optional `extraConn` (composites, D56) and `inset` (see below). One face per cell: an
  opening two cells wide is two faces with the same direction and type.
- **ConnectionType**: id and `mate`, the type it joins with (itself when the profile is
  symmetric, else its mirror type).
- **PieceOverlap**: two pieces allowed to share cells in one relative placement (annotations).

Cell `z` is the level relative to the NIF origin's slice (D55, D59): a piece spans every level
between its openings, so a ramp occupies both levels it joins.

## Pipeline

1. **Kit STATs** (`extract.ts`, `build.ts`): the STAT records of `Skyrim.esm` whose model lies
   in the kit's folders, classified by model sub-folder and EditorID (525 Imperial STATs, 111
   structural pieces). Cached in IndexedDB, keyed on the master's size and date.
2. **Mesh analysis** (`analyze.ts` over `mesh/*`), per piece: read the NIF through the Data view,
   weld, find openings, compute the footprint and the face profiles.
3. **Grouping**: all face profiles of the kit are grouped into connection types.
4. **Annotations**: the committed human decisions are applied.

The analysis of the Imperial kit takes about ten seconds in the browser and is cached.

## Mesh analysis (`mesh/`)

### Welding and open edges (`geometry.ts`)

Vertices are merged by position (quantum 0.1 unit), so UV or normal seams do not split the
surface. An **open edge** is an edge used by a single triangle: it outlines where a mesh stops,
which is exactly where a neighbouring piece must continue it.

### Openings (`openings.ts`)

On each of the four sides of the bounding box, candidate planes are the coordinates (quantised
to 0.5) near the box edge that carry enough vertices, nearest first (decor just inside an
opening can be denser than its rim). A plane is an **opening** when its vertices:

- span floor to ceiling (a closed side only carries ceiling trim);
- lie mostly on open edges (a rendered wall in that plane has shared edges instead);
- are at least `MIN_OPEN_WIDTH` wide at floor level (narrower rims are wall ends).

### Footprint (`footprint.ts`)

- **Grid phase** per horizontal axis: the offset of the grid relative to the NIF origin, taken
  from the opening planes (they must agree within `GRID_TOL` = 4 units).
- **Cells**: the bounding box, shifted by the phase, covers a cell when it overlaps it by more
  than a quarter module. Cells are indexed from the min corner (D52), on every level between the
  lowest and highest opening (D59).
- **Pivot**: the NIF origin relative to that min corner; `pivot.z` = 0 (the origin defines the
  Z slice, D55).
- **Opening cells, level and inset**: the cells an opening covers along its side; its level
  (`round(zMin / zModule)`); its **inset**, how far its plane lies inside the cell boundary.
  Two facing openings stand `insetA + insetB` apart.

### Face profiles (`profiles.ts`)

A profile is the set of open edges lying on the opening's plane (within 1 unit), in face-local
coordinates: `u` to the right of a viewer standing outside the piece, origin at the centre of
the cells the opening covers; `v` = height above the opening's level. Segments are quantised to
0.5, collinear pieces merged and put in a canonical order. A profile is the drawing of the
opening's outline: floor line, jambs, lintel, arch.

### Grouping into connection types (`signatures.ts`)

- Each profile is **sampled** every 2 units along its segments.
- **Coverage** of A by B: the share of A's samples within `MATCH_TOL` (8 units) of a segment of
  B. The **score** of a pair is the smaller of the two coverages, or 0 when a coarse check fails
  (width, height or floor within 12 units).
- Pairs scoring at least `EXACT` (0.97) are joined with a union-find: each group is a
  connection type. Pairs between 0.8 and 0.97 are kept as **near matches** for a human to
  decide.
- Two faces that look at each other see the same geometry **mirrored**: a type's **mate** is the
  group matched by its mirror image (itself when symmetric).

`MATCH_TOL` is loose on purpose (kit authors modelled the two jambs of a door up to 6 units
apart); junctions are therefore judged again, strictly, on the actual profiles (see
[Assistant and junctions](06-assistant-and-junctions.md)).

## Annotations (`annotations.ts`, D12, D46, D56, V9)

Human decisions only, never game data: everything geometric is recomputed from the user's
installation. Stored in `data/annotations/<kit>.json`, edited on the Validation page and written
into the repository in development. Types are never named by hand: they are designated by one
of their faces, `EditorID:dir`, which stays valid across analysis runs.

- **Merges**: a near match decided "same type" joins the two groups (union-find); "distinct"
  records a refusal.
- **Stable ids**: a final type is named after the smallest face key among its faces.
- **Composites** (D56): every face of an outer type also accepts an inner type (a wide door
  frame around a narrower hall); stored in `Face.extraConn`.
- **Pieces**: validated, excluded (with a reason) or re-categorized.
- **Accepted overlaps** (D61): see [Grid and editing](05-grid-and-editing.md).

Faces or pieces that no longer exist are reported as issues, never as errors, so an annotation
file survives a game update.
