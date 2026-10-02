# V3 implementation plan (release 0.3.0)

V3 builds on V2 (0.2.0, D63), still on the Imperial kit. It adds three things, chosen on 1 Oct
2026, in the order the user chose:

1. **A camera viewport**: the top-down view stays the editing view; a square inset in the top
   right corner (a third of the screen) shows the view of a camera placed, moved and turned in
   the top-down view.
2. **Textured rendering**: show the pieces with their diffuse textures, to see the level better.
3. **Z levels** (phase 4 of the roadmap): build, see and check a dungeon on several levels, the
   NavMesh included (R7). The viewport and the textures come first: they help most to find one's
   way once there are several levels.

Each step says **why** it comes at that point, what it produces and when it is done. As for V1
and V2, a step is done only when `npm test` and `npm run check` pass, and the risky parts are
proven before they are built on.

Success criterion of V3: _a two-level Imperial dungeon (rooms below, halls above, joined by
stairs and a ramp) is built in the tool, seen textured, and walked through with the viewport's
camera; its NavMesh is baked per level, stitched at the stairs and finalized in the app; an NPC
follows the player up the stairs and back down in game._

## Decisions to confirm during V3

- D67 (new): **two viewports**: the top-down view, where everything is edited, and an inset
  camera view for looking only; the camera is drawn in the top-down view as simple shapes, moved
  in x, y and z and turned around z only (steps 1, 2).
- D66 (new): **textures are a display option**, off by default; the untextured shaded view stays
  the fast one (step 4).
- D3 / D44: Z through **slices**: an active level, the levels below dimmed (or hidden), the
  levels above hidden; slices are clipping planes on the 3D scene (step 5).

## Phase A – Camera viewport

### Step 1 – The inset viewport
- **Why**: a top-down view alone does not show what a room looks like from inside, nor, later,
  where stairs lead.
- **What**: a square viewport in the top right corner, a third of the screen, drawing the same
  scene (same meshes, marks optional) from a perspective camera, at its own frame rate, with one
  renderer and two cameras (R18); it can be collapsed. It shows every level (no clipping). The
  camera stands at eye level above the floor under it by default.
- **Done when**: the inset shows the working cell from a fixed camera, without slowing the
  top-down view down.
- **Result (1 Oct 2026)**: done; the user found the top-down view as fluid as before.

### Step 2 – The camera in the top-down view
- **Why**: the camera is placed where the designer works, not in a separate tool.
- **What**: the camera drawn in the top-down view as simple shapes (a disc for its position, a
  wedge for its field of view); dragged to move it in x and y; a handle on the wedge turns it
  around z; its z changed with the wheel over it, or by keys, and shown in figures; the inset
  follows live. Dropping the camera puts it at eye level above the floor there.
- **Done when**: the camera is walked through the working cell from the top-down view (along the
  halls, into the rooms, up a ramp), and the inset follows smoothly.
- **Result (1 Oct 2026)**: done, tested by the user.

## Phase B – Textured rendering

### Step 3 – Textures, proof of concept
- **Why**: Skyrim's textures are DDS files in `Skyrim - Textures*.bsa` (BC1, BC3, BC5, BC7);
  WebGL has the BC1–BC3 formats on desktop (S3TC) and BC7 through an extension, not always. The
  memory and time of a textured cell must be known before the editor depends on it (R17).
- **What**: a DDS reader (header, DX10 header, mip levels) and a texture lookup in the BSA and
  loose files (the overlay, MO2 included); a proof of concept page drawing one tile textured,
  with a software decoder for a format the GPU lacks; the time and memory of a full test cell
  measured.
- **Done when**: an Imperial tile is drawn with its textures, and a 200-tile cell loads them in
  an acceptable time (target: a few seconds), within a memory budget written down.
- **Result (2 Oct 2026)**: done (`poc/textures.html`, `format/dds`, `render/textureCache.ts`).
  The user's GPU has S3TC, BC7 (BPTC) and BC5 (RGTC). The 435 models under
  `meshes/dungeons/imperial/` use only 37 distinct diffuse textures, BC1 and BC3: all read,
  parsed and uploaded in 0.6 s, 31.5 MB of GPU memory, compressed data sent as is. A cell reuses
  them, so its size hardly matters. Budget written down: under 64 MB and 2 s per kit. Three paths
  referenced by clutter models of the folder exist in no archive (dead references in the game
  files); those parts keep their plain colour. The textured tiles look right to the user.

### Step 4 – Textured view in the editor
- **Why**: the option itself (D66), in both viewports.
- **What**: a "Textures" toggle; a texture cache shared by the pieces (one texture loaded once);
  the mip level chosen by zoom; alpha-tested parts (decals, grates); the selection, marks and
  ghosts still readable over textures (outline instead of tint where needed); the inset
  textured as well.
- **Done when**: the working cell is seen textured from above and in the inset, the marks stay
  readable, and turning the option off brings back the fast view at once.
- **Result (2 Oct 2026)**: done. A "Textures" toggle over the view (off by default, remembered):
  each piece gets its textured geometry (smooth normals, UVs, one group and material per texture
  range, alpha-tested parts included), materials shared per texture; the inset follows. The user
  found it fast and smooth, and moving around "as easy as in the game".

## Phase C – Z levels

The grid is 3D since V1: cells are `[i, j, k]`, `Kit.module.z` gives the level height (D53), a
face carries the level of its opening and a piece occupies every level between its openings
(D55, D59). The junction checks, leaks and textures work on 3D cells. What is missing is the
view (everything is drawn flattened), the editing of one level at a time, and a NavMesh that
does not merge two stacked floors (R7).

### Step 5 – See the levels
- **Why**: today a tile on level 1 is drawn over the tiles of level 0; nothing else can be built
  before the levels can be told apart.
- **What**: an active level (selector, Page Up / Page Down); the top-down scene clipped above it
  (a clipping plane at the top of the slice); the levels below drawn dimmed, with an option to
  hide them; a tile's level shown in its panel and on hover. Pieces spanning two levels (stairs,
  ramps) are drawn in both. The inset is not clipped; dropping its camera on the active level
  puts it at eye level there.
- **Done when**: on a vanilla two-level cell (Skyrim.esm), each level is seen alone, with the one
  below dimmed, and the stairs show in both.
- **Result (2 Oct 2026)**: done, tested by the user on a cell of the test plugin (the editor opens
  `.esp` files only). A "Level" selector (shown when the layout spans several levels) and Page Up
  / Page Down; a scene object carries the levels it spans (`SceneObject.levels`: a tile's
  footprint cells, another object's height) and `CellScene.setLevel` hides what is above,
  dims (30 %) or hides what is below, and keeps the dimmed pieces from being picked. Per-object
  visibility instead of a clipping plane: a piece spanning two levels shows whole on both. The
  inset shows every level.

### Step 6 – Build on a level
- **Why**: placing, moving and the assistant must work on the active level only.
- **What**: placement on the active level; the open faces and the assistant limited to it, plus
  the faces of a piece spanning the level above or below (its upper opening is offered on the
  upper level); moves and group moves keep the level; overlap and junction checks unchanged (3D
  already). A ramp or stairs placed from its lower level.
- **Done when**: a two-level layout (rooms, stairs, halls above) is built from an empty cell, with
  the assistant offering the stairs' upper continuation on the upper level.
- **Result (2 Oct 2026)**: done, tested by the user. With an active level, a piece from the
  palette goes there (`cellAt(..., level)`: its own level 0 on the active one), the open faces,
  the assistant, snapping and the marks keep to the faces and cells of that level (a stair's
  upper opening is on the level above), moves keep their level; with "all", as before.

### Step 7 – Checks on several levels
- **Why**: the deep leak check and the texture continuity were tuned on one level; stairs and
  stacked floors are new cases (a leak through a floor, a junction at a stair top).
- **What**: run the checks on the two-level test layout; fix the false positives and misses
  found; the leak views follow the active level.
- **Done when**: the two-level test cell has no false mark, and a removed floor piece is flagged.

### Step 8 – R7: NavMesh per level, proof of concept
- **Why**: the bake works in plan (2D clipping per grid cell): two stacked floors would be merged
  or cut. The risk is proven before the editor is changed.
- **What**: a proof of concept page: the walkable polygons split by level (the stairs' slopes
  belong to the levels they join); one bake per level; the levels stitched where a stair or ramp
  meets a floor (shared vertices, as at tile borders). Written as one NAVM (D36) and checked in
  the CK.
- **Done when**: a two-level test bake is valid in the CK and an NPC walks up and down the stairs.

### Step 9 – NavMesh on several levels in the editor
- **Why**: brings step 8 into the tools.
- **What**: Fill, Bake, Replace and Clear per level (the active one, or all); "Edit NavMesh"
  picks on the active level (triangles of the levels below shown dimmed, not picked); the
  coverage test (D35) per level; Finalize unchanged.
- **Done when**: the test dungeon is baked level by level and finalized from the editor.

## Step 10 – V3 milestone
- **What**: the success criterion above, on a new two-level test dungeon and on the working
  cell. Frictions noted, fixed, then documentation (user guide, architecture) updated.
- **Done when**: the criterion is met; the release version is proposed and confirmed (D63),
  tagged, and published.
