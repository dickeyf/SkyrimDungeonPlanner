# 6. Assistant and junctions

The promise of the tool: **only offer what fits**. Everything here is pure logic in
`grid/assist.ts` and `grid/joints.ts`, computed from the layout and the catalogue.

## Openings and open faces

An **opening** is a contiguous run of a piece's faces with the same direction, type and plane
(the catalogue stores one face per cell). In the level, an opening is turned with its tile; its
**outside cells** are the cells just beyond it. An **open face** (orange) is an opening whose
outside cells are all free.

## Compatible pieces (`candidatesFor`, `checkCandidates`)

For an open face, every opening of every validated piece is tried:

1. **Rotation**: the one that turns the opening to face the open face (a direction fixes it).
2. **Type**: the two faces must mate (`facesMate`: one's type, or a composite `extraConn`,
   has the other as `mate`).
3. **Alignment**: the two openings are **centred** on each other (profiles are centred on their
   cells): same width, or a narrower opening inside a wider one through a composite. Odd width
   differences cannot be centred and are skipped. Levels are part of the cells, so a ramp is
   offered going up (by its low end) or down (turned, by its high end).
4. **Room**: no overlap with another tile (accepted overlaps excepted).
5. **Every neighbour**: the placement is simulated in a copy of the layout and **all** its
   junctions are judged, not only the clicked one. A placement is kept only if every junction
   is exact or included: a seam, a mismatch or an opening against a wall drops it.

## Junction verdicts (`joints.ts`, D60)

Connection types group profiles within a loose tolerance (8 units). A junction is judged again,
strictly, on the two profiles themselves:

1. **Same frame**: the facing opening's profile is redrawn in this opening's frame. Seen from
   the other side, it is mirrored (`u → −u`), then shifted by the offset between the centres of
   the two openings along the face, and by the difference of their levels.
2. **Distances**: for each profile, the distance from its samples to the other profile; the
   **spread** is the distance within which 97 % of the samples lie (robust to a few stray
   points).
3. **Verdict**:
   - **exact**: both spreads within `SEAM_TOL` (0.5 unit);
   - **included**: one profile lies within the other (one spread within `SEAM_TOL`): the extra
     geometry on one side (a ceiling detail, a wide door frame around a narrower hall) closes on
     nothing visible;
   - **seam** (yellow): they only coincide within the loose tolerance; the gap is shown;
   - **mismatch** (red): they do not coincide, or the opening faces a wall.
4. **Depth**: the opening planes may stand apart even when their shapes match; the gap between
   them is `insetA + insetB`. Over `DEPTH_TOL` (0.5 unit), an exact or included junction becomes
   a seam; a negative gap is an overlap that hides the joint.

The thresholds were measured on a real cell: seamless junctions give 0.0, a visible seam 1.0 (a
piece 1 unit off). When a profile is missing, the verdict falls back to the connection types.

**Cache**: a verdict depends only on the two pieces, their faces and their relative placement,
which repeat across a level; verdicts are cached per catalogue geometry, so rechecking all the
junctions of a 200-tile cell after an edit takes a few milliseconds instead of a second or two.

## Marks

| Mark | Meaning | Source |
| --- | --- | --- |
| orange | open face: click for compatible pieces | `openFaces` |
| yellow | seam, with its gap in units | `badJoints` |
| red | mismatch, or an opening against a wall | `badJoints` |
| magenta | cell shared by two tiles (not an accepted overlap) | `sharedCells` |

A selected tile lists all its junctions (`jointsOfTile`) with their verdict, both distances and
the depth gap, and draws the two profiles overlaid.

## Snapping (`snapPlacement`)

Pieces do not all span whole multiples of an opening, so the plain grid may leave a piece one
cell off the face it should join. While placing a piece (from the palette, or dragging an
existing tile, which is then taken out of the layout for the computation), the open faces within
`SNAP_RANGE` (2 modules) of the pointer are tried: the placements of **that** piece that fit the
face and every neighbour are scored by the distance from their footprint centre to the pointer,
plus one module when the rotation differs from the chosen one. The best one wins; with none, the
plain grid applies.
