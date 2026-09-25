# 5. Grid and editing

## Frames and rotations (`grid/rotation.ts`, `grid/derive.ts`)

The tool keeps Skyrim's frame: Z up, X east, Y north, game units. A tile placement is a grid
**cell** (the corner point of the piece's cell (0,0,0) at rotation 0) plus a **rotation** in
quarter turns counter-clockwise, 0 to 3.

- Skyrim stores a **heading** that turns clockwise seen from above, so quarter turns are minus
  the heading (`headingSign` = -1, established by R10 by counting overlaps on a real cell).
- A footprint cell (the square `[i, i+1] × [j, j+1]`) rotates about the corner of cell (0,0):
  `r = 1` maps `(i, j)` to `(-j-1, i)`. Face directions turn with it (`+X → +Y → -X → -Y`).
- Corner and NIF origin: `corner = pos − R·pivot`, `pos = corner + R·pivot`.

## Grid view of a cell (`grid/derive.ts`, R10, D23, V10)

A reference is a **tile** when its base is a catalogue tile, it is neither scaled nor tilted, its
heading is a multiple of 90°, and its footprint corner lands on the grid. Everything else stays
an **opaque** reference, shown but never edited (D22), with its reason (unknown base, off grid,
non-quarter rotation, scaled, tilted).

The **grid anchor** is found by best fit: the corners' residues modulo the module are binned
(within 2 units), the most common offset wins and is refined by averaging, then placed at the
lowest tile corner so existing tiles get small non-negative indices. With no tile (a new
cell), the anchor is the world origin. Cells claimed by several tiles are listed as overlaps:
tolerated in a loaded level (D58), refused for new placements.

## Layout and editing (`grid/edit.ts`)

A **layout** is an immutable map of tiles (`key`, piece, cell, rotation, `own`, and for
existing tiles the reference as loaded). Existing tiles are keyed by their REFR FormKey, new
ones `new:<n>`. Every edit returns a new layout or a refusal with its reason:

- `addTile`, `moveTile`, `rotateTile` (keeps the footprint's min corner in place), `placeTile`
  (move and turn in one edit), `removeTile`;
- refused when the new footprint would share a cell with another tile (`conflict`), or when the
  tile belongs to a master (`read-only`, D22);
- **untouched tiles keep their stored position and angles exactly** (`tileWorldPlacement`): only
  new and moved tiles are placed on the grid, so loading and saving a cell never drifts it.

`changes(original, current)` lists added, moved and removed tiles; the **history** is a pair of
stacks of layouts around the present one (undo, redo; a new edit clears redo).

## Accepted overlaps (`grid/overlaps.ts`, D61)

Some pieces share cells on purpose: a door frame nested into its neighbour to hide the joint. A
human marks such a pair from the editor; the annotation stores the two pieces and the **relative
placement** of the second in the first one's frame:

```
offset   = rotate(cornerB − cornerA, −rotationA)     (lattice point rotation)
rotation = rotationB − rotationA   (mod 4)
```

This is independent of where the pair sits and how it is turned in the level, so one annotation
covers every occurrence. The accepted set holds both orders (B seen from A, and A seen from B:
`r' = −r`, `offset' = rotate(−offset, r')`). An accepted pair is not flagged as a shared cell,
not judged as a junction, may be placed, and may be offered by the assistant; any other overlap
of the same pieces is still refused.

## Placing from the palette (`cellAt`)

Without a nearby open face, the piece is centred on the pointer: its rotated footprint's centre
is aligned with the pointer and the corner rounded to the grid. Near an open face, placement
snaps instead (see [Assistant and junctions](06-assistant-and-junctions.md)).
