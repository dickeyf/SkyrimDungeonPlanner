# V1 implementation plan (Imperial kit, single Z)

Breaks phases 0 to 2 of `04-roadmap.md` down into deliverable steps, in the proposed order of
execution. Each step states **why** it comes at that point, what it produces, and when it is
done. One step = one short work session, ended with `npm test` and `npm run check` green when
there is code.

V1 success criterion (V14): *a 30-tile Imperial dungeon on one Z in under 10 minutes, opened in
the CK with no error and no visible gap.*

V1 goal (24 Sep 2026): *once finished, V1 is useful and usable (polished ergonomics and UX), and
makes it easy and quick to build dungeons with the Imperial kit.* Something simple, but that
brings real value. The criterion above is its quantified measure.

## Assumptions made for this plan

The recommendations of `01-decisions.md` (then "Still to decide for V1") were taken as is: V1 editing
of existing cells only, V2 STAT door frames only, V3 real untextured meshes, V4 90° rotation +
undo/redo, V5 explicit save, V6 ESL refused, V7 Python prototyping then TS port, V8 validation
in the same SPA, V9 annotations by EditorID, V10 anchoring by best fit, V12 static pages.
The "Proposed" rows D15, D21–D23, D43–D47 are also assumed settled. Each step states when one
of these assumptions becomes binding; that is the moment to challenge it if needed.
How each one ended up is in `01-decisions.md`, "Settled for V1 (release 0.1.0)": all held
except V1, revised by D62 (the tool also creates plugins and cells).

Code convention: code, comments, tests, UI and these docs in English (the docs were written in French and translated when the project was published, 24 Sep 2026).

## Step 0 – Skeleton (done on 21 Sep 2026)

Vite + Svelte 5 + TypeScript + three.js + Vitest, ESLint, Prettier, IntelliJ config.
`src/lib/binary` (tested little-endian reader/writer), catalogue and grid types
(`src/lib/catalogue`, `src/lib/grid`), module stubs, `poc/` and `tools/`.
BSA extractor in Python (`tools/bsa.py`, `tools/bsa_extract.py`) tested on the real
installation.

---

## Phase 0 – Proofs of concept

Order: cheapest to most expensive, and the R5 results feed everything else.

### Step 1 – R5: module and pivots of the Imperial kit (Python) — DONE (21 Sep 2026)
Results in `03-risks.md` (R5) on the 5 sub-kits: 105 tiles out of 113 fit the 128 module
(D51 decided), pivot always at the centre (D52), the z of the faces goes into the profile
(D55). The `door/` folder = DOOR objects, outside the tile catalogue.

- **Why first**: the whole data model (`pivot`, `cells`, grid module) rests on measurements
  nobody has made yet. Without them, the grid, deriving a cell (R10) and the catalogue are
  blocked.
- **What**: `tools/r5_module_pivots.py` on the `dungeons\imperial\` NIFs extracted from the BSA
  (halls, rooms, doors). Per piece: bounds, pivot position, floor extent, extreme vertices in
  X/Y. CSV/JSON output in `tools/out/`.
- **Done when**: a consistent XY (and Z) module emerges, and each tested piece is described by
  `pivot` + `cells`. The values are carried over into `02-data-model.md` (Kit section) and into
  a decision D51.
- **Depends on**: Python + pynifly (`tools/README.md`). The NIFs are extracted with
  `tools/bsa_extract.py` (done on 21 Sep 2026: 435 Imperial NIFs, a BSA v105 reader in Python
  that will serve as the reference for the TypeScript port of step 4).

### Step 2 – R3: face signatures (Python) — DONE (21 Sep 2026)
Result in `03-risks.md` (R3): 15 groups over 304 faces, kit structure recovered, tolerance of 8
units, decals and decor excluded. Two cases for human validation (step 10): 512 sides of the
large rooms, `implhalldoor*` tiles.

- **Why**: decides whether the catalogue is built automatically (mesh analysis) or by hand
  (fallback). The fallback remains viable, but the catalogue architecture depends on it.
- **What**: `tools/r3_face_signatures.py` on 10–15 pieces of known compatibility: open edges on
  each junction plane (within ± tolerance of the cell edge measured in step 1), normalised
  polylines, grouping with tolerance, mirror tested.
- **Done when**: compatible pairs = same group, incompatible = different groups, closed faces =
  empty. The chosen tolerance and the number of groups are recorded.
- **Depends on**: step 1 (module, position of the junction planes).

### Step 3 – R14a: disk access from the browser — DONE (21 Sep 2026)
`src/lib/fs` (case-insensitive path resolution, ranged reads, atomic write, handles in
IndexedDB, permissions, recognition of the game folder) with 16 tests on fake handles and
`fake-indexeddb`; page `poc/r14a-fs.html` validated in Chrome: handle restored with `granted`
permission without a click, ranged read 0.8 ms, write 67 ms.
Result in `03-risks.md` (R14a). D42 and D43 confirmed.

- **Why**: first browser building block, the least risky, and a prerequisite for the next two.
  Also checks that the plugin can be written in place.
- **What**: `poc/r14a-fs.html` + `src/lib/fs`: pick the Data folder, keep the handle in
  IndexedDB, read it back in the next session, write a test file in place (atomic write via
  `createWritable`).
- **Done when**: no folder re-pick after reload; file written and read back.
- **Commits to**: D42, D43.

### Step 3b – R15: MO2 "virtual Data" view — DONE (21 Sep 2026, validated against MO2)
- **Why now**: the reference installation is a stock "Game Root" + MO2, a very common setup among modders; the
  DLCs and the working plugin are in `mods/*`. Without this view, the tool finds neither the
  masters nor the plugin to write (D49 revised).
- **What**: `src/lib/vfs`: reading the MO2 instance (`ModOrganizer.ini` → profile,
  `modlist.txt` → enabled mods by priority, `plugins.txt`/`loadorder.txt` → load order),
  ordered overlay of the mod folders on `Data` (no copy), archive order. 9 tests on a fake
  instance. Page `poc/r15-mo2.html`.
- **Done when**: the page shows the right profile, the mod order **matches MO2's left
  panel** (checks the assumption "first in `modlist.txt` = highest priority"),
  `Dawnguard.esm` and the working plugin are found in their mod folder, and the archive list
  starts with `Skyrim - Misc.bsa` and ends with those of the last plugins.
- **Commits to**: D42 (completed), D49 (revised), D50.

### Step 4 – R14b: BSA + NIF + WebGL display — DONE (21 Sep 2026, validated in Chrome)
`src/lib/compress/lz4.ts` (blocks + frames), `src/lib/format/bsa` (tables read in one targeted
read, files by targeted read, LZ4), `src/lib/format/nif` (node tree, BSTriShape, shape merging,
bounding box): ports of `tools/bsa.py` and `tools/nif.py`. 18 tests on synthetic fixtures
generated by `tools/make_fixtures.py` (no game file in the repository). Page
`poc/r14b-bsa-nif.html`: looks up the mesh in the virtual Data view (loose file, otherwise the
last archive in the load order that contains it) and displays it in three.js, orthographic
top-down camera, 128 grid. Measured for `imphall1way01`: 2230 vertices, 256 × 256 × 307.5, box
from -128 to 128 in XY, LZ4 1.9 ms, parsing 1.1 ms.
Result in `03-risks.md` (R14b). D45 and D46 confirmed for reading.

- **Why**: the catalogue is built in the browser (D46) and rendering uses the real meshes (V3).
  If this building block fails, extraction switches to a local utility and the plan changes.
- **What**: `src/lib/format/bsa` (v105 header, folders/files, sliced reading of a single file,
  LZ4), `src/lib/format/nif` (header, blocks, BSTriShape → vertices and triangles),
  `poc/r14b-bsa-nif.html` that displays an Imperial tile in three.js with a grid at the module
  measured in step 1.
- **Done when**: the tile displays at the right scale, without loading the whole BSA.
- **Tests**: tiny synthetic BSA and NIF built in code (no game files in the repository).
- **Commits to**: D45, D46.

### Step 5 – R14c: ESP round trip, then adding a REFR — DONE (22 Sep 2026, validated in xEdit and the CK)
`src/lib/format/esp`: opaque records and groups (group sizes recomputed), subrecords with
`XXXX`, compressed records (zlib via `DecompressionStream`), TES4 (HEDR, masters, ESL refused),
CELL/REFR decoded, `Plugin.addRefr` / `moveRefr` / `deleteRefr` limited to records owned by the
plugin (D22) with `nextObjectId` and `numRecords` kept up to date, FormKey ↔ FormID. 12 tests on
a synthetic plugin (`testPlugin.ts`). Page `poc/r14c-esp.html`: round trip compared byte for
byte on the real plugin, then adding a REFR (copy of an existing tile raised by 512) written
into a **copy** `<plugin>.r14c.esp` to open in xEdit and the CK.

- **Why**: this is the building block that makes the whole thing useful: without reliable
  plugin writing, no V1. Merges R6.
- **What**, in two stages:
  1. `src/lib/format/esp`: TES4, GRUP tree, opaque records; identical byte-for-byte rewrite on
     a copy of the working plugin.
  2. Decoding of CELL (interior) and REFR; adding a REFR to a cell's "temporary children"
     group; updating group sizes, the record counter and the HEDR `nextObjectId`; refusing
     ESL plugins.
- **Done when**: 1) empty binary `diff`; 2) the modified plugin opens in xEdit and the CK
  without error and the REFR appears at the right place.
- **Commits to**: D21, D22, D47, V6.

### Step 6 – R10: deriving the grid of an existing cell — DONE (22 Sep 2026, validated on the working mod's cell)
`src/lib/grid/derive.ts` (ref classification: unknown base / scale / tilt / rotation not a
multiple of 90° / off grid; footprint corner = position − R·pivot; anchoring by the residue
modulo the module shared by the most refs, set on the lowest corner; rotated footprints;
overlaps) with 8 tests. Rotation convention: the Skyrim heading (0 = +Y, positive = clockwise
seen from above) becomes −rz in counter-clockwise quarter turns, to be confirmed on the real
cell. `src/lib/format/esp/scan.ts` reads a single top-level group of `Skyrim.esm` by targeted
read (STAT 2.9 MB, CELL 35 MB); `stat.ts` decodes EDID/MODL/OBND.
Provisional catalogue = Imperial STATs of `Skyrim.esm` joined with the R5 measurements
(`poc/data/imperial-pieces.json`, 111 tiles, `tools/export_r5_catalogue.py`). Page
`poc/r10-grid.html`: working plugin cell or vanilla cell filtered by EditorID, count of
recognised / opaque tiles by reason, most frequent unknown bases, 2D map of the footprints.

- **Why**: V1 edits existing cells (V1); we need to know what share of the refs will be
  recognised as tiles and how the grid anchors.
- **What**: `src/lib/grid/derive.ts` (ref → `{cell, rotation}` or opaque, anchoring by best
  fit) + `poc/r10-grid.html`: for a vanilla Imperial cell and a cell of the working mod, table
  of recognised / opaque refs and reason.
- **Done when**: the vast majority of structural tiles is recognised; the rest is displayed as
  opaque without getting in the way.
- **Depends on**: steps 1 (pivots of a few pieces, entered by hand) and 5 (reading REFRs).
- **Commits to**: D23, V10.

### Step 7 – R2: two NAVMs in one cell (manual, CK)
- **Why here**: off the V1 critical path (NavMesh = phase 3), but free in code and to do while
  the CK is open anyway (step 5). Can be done at any time before phase 3.
- **Done when**: continuous NPC pathing across the seam after Finalize, or fallback recorded in
  `03-risks.md`.

**Phase 0 milestone — reached on 22 Sep 2026**: R5, R3, R14a, R15, R14b, R14c and R10 proven
(`03-risks.md`), decisions D51 to D57 made. Only R2 (manual test of two NavMeshes in the CK)
remains open; it only concerns phase 3.

---

## Phase 1 – Imperial catalogue

### Step 8 – Extracting the Imperial STATs from Skyrim.esm — DONE (22 Sep 2026)
First application structure (no longer a test page): `src/App.svelte` with hash navigation,
`src/pages/{Home,Setup,Catalogue}Page.svelte`, session in Svelte 5 runes
(`src/lib/session/session.svelte.ts`) on top of the virtual Data view moved to
`src/lib/session/dataView.ts`. Catalogue: `src/lib/catalogue/kits.ts` (definition of the
Imperial kit, module 128 as data), `extract.ts` (classification by subfolder and name:
hall / room / door / other, props recognised by name), `build.ts` (targeted read of the STAT
group of `Skyrim.esm`, IndexedDB cache keyed on the master's size + date). Catalogue page:
counters by category and by subfolder, filter, table EditorID / subfolder / category / bounds
/ model. **Measured in the app**: 9720 STATs in `Skyrim.esm`, 525 Imperial, extracted in
110 ms; **111 structural pieces** = 48 hall + 35 room + 28 door (`largeroom` 34,
`largehall` 31, `smallhall` 25, `smallroom` 21), exactly the 111 tiles measured by R5;
414 "other" (exteriorice 154, clutterkits 110, exterior 91, tower 19, stablekit 15,
exteriorhelgen 9, jail 6, portcullis 6, door 1). `largeroom` has 36 STATs for 35 NIFs: two
base objects share a mesh, hence indexing by FormKey.

- **Why**: this is the reference list of pieces; the rest of the phase consumes it.
- **What**: STAT decoding (EDID, MODL, OBND) in `src/lib/format/esp`; filter by model path
  `dungeons\imperial\`; `hall` / `room` / `door` / `other` classification by subfolder and
  EditorID suffixes (to be corrected in step 10). `door` = the `*door*` tiles of
  `smallhall`/`largehall`/`smallroom`/`largeroom`; the `door/` subfolder (DOOR objects) and the
  `brace`/`pillar` are props, outside V1.
- **Done when**: the list displays in a SPA page with counters by category; the number of
  pieces is recorded in the docs.

### Step 9 – TypeScript port of the mesh analysis (R5 + R3) — DONE (22 Sep 2026, checked in the app)
`src/lib/mesh`: welded geometry and open edges (`geometry.ts`), opening detection
(`openings.ts`), footprint, grid phase, normalised cells and pivot (`footprint.ts`), face
profiles in local coordinates (`profiles.ts`), comparison with tolerance, mirror and grouping
(`signatures.ts`): faithful ports of `tools/kit_geometry.py`, `r5_module_pivots.py` and
`r3_face_signatures.py`, tested on a synthetic hall (9 tests). `src/lib/vfs/archiveIndex.ts`
finds each mesh (loose file, otherwise last archive in the load order).
`src/lib/catalogue/analyze.ts` orchestrates: reading the 111 structural NIFs, analysis,
signature groups → `ConnectionType`, `Piece` with `pivot`, `cells` and `faces` per cell (one
face per covered cell, same type; left/right half-profiles will come in step 10 if useful).
Catalogue page: "Analyze meshes" with progress, connection types, "near" matches, per-piece
table, and **automatic comparison with the Python measurements**
(`poc/data/imperial-pieces.json`). The catalogue is saved in IndexedDB (`catalogue:Imperial`).
**Measured in the app**: 111 pieces analysed, 0 failures, 304 faces in 15 connection types,
384 "near" matches, in 9.2 s (Python: 17 s); **111 footprints and pivots out of 111 identical
to the Python measurements**, same groups and same mirrors as R3. Catalogue saved in
IndexedDB. The catalogue is therefore built entirely in the browser (D46 validated).

- **Why**: the algorithms are proven in Python (V7); they must run in every user's browser
  (D46).
- **What**: `src/lib/catalogue/analyze.ts`: NIF → `pivot`, `cells`, face profiles → signature
  groups → proposed `ConnectionType` (exact = automatic, near = to validate). Checked against
  the Python outputs of `tools/out/` on the same pieces.
- **Done when**: same results as the Python scripts on the R3 sample.
- **If R3 failed**: this step becomes "manual entry assisted by EditorID" and the next one
  grows.

### Step 10 – Catalogue validation page — DONE (22 Sep 2026)
Split into 4 deliveries: 1) annotation format and engine, 2) read-only validation page with
profile preview, 3) editing, 4) writing to the repository and validation pass.
**Delivery 1 done (22 Sep 2026)**: `src/lib/catalogue/annotations.ts`; file
`data/annotations/imperial.json` (empty). Keys = EditorID and `EditorID:dir`, never the G's of
the analysis; type names via a representative face, merges of "near" matches, extra types of
composite faces (`Face.extraConn`, D56, taken into account by `facesMate`), exclusion /
category / validation per piece; problems reported (unknown faces or pieces, name conflicts)
without failing; sorted serialisation for readable diffs.
7 tests.

**Delivery 2 done (22 Sep 2026)**: read-only Validation page (`src/pages/ValidationPage.svelte`),
shared catalogue store with analysis cache (`src/lib/session/catalogueStore.svelte.ts`),
review data (`src/lib/catalogue/review.ts`: one type per group, "near" matches aggregated per
pair, composite faces by contour inclusion), SVG preview of the profiles
(`src/components/ProfileView.svelte`, overlay wide cyan / thin magenta). Checked in the app:
15 types, 3 "near" pairs (G9/G10, G9/G12, G10/G12), 2 composite faces.

**Delivery 3 done (22 Sep 2026)**: editing on the Validation page, **without naming the
types** (decision of 22 Sep: connection types are internal, the designer handles pieces by
EditorID and never sees the types). Each type gets a computed stable identifier
(`Kit/<smallest face EditorID:dir>`), never stored. Annotations contain only human decisions,
referenced by face: "near" matches settled (same type / different), composite faces
(`{ face, accepts }` at the type level, D56), pieces validated, excluded or recategorised.
Tested pure operations (`annotationEdits.ts`), store `annotationStore.svelte.ts` (unsaved
changes, undo, download the JSON).

**Delivery 4 done (22 Sep 2026)**: "Save to repository" button, in development mode only,
that writes `data/annotations/imperial.json` directly into the working copy (project folder
picked once, recognised by its `package.json`, handle remembered;
`src/lib/fs/projectFolder.ts`). First validation pass recorded: the 3 "near" pairs of the 512
sides of the large rooms declared **different**, the 2 composite faces of the `ImpLHallDoor*`
accepted. Pass completed the same day: the 6 "64" variants excluded (128 grid kept for V1,
re-evaluation in phase 4), **105 pieces validated**.

- **Why**: the analysis proposes, a human decides (D12); without validation, the contextual
  assistant will propose wrong pieces.
- **What**: SPA page (V8): list of pieces, three.js thumbnail, faces with proposed type,
  overlay of the two profiles for "near" matches, naming of types, manual correction,
  `validated` marking. Export of the **annotations** (by EditorID, V9) in a JSON shipped with
  the tool; the full catalogue stays local.
- **Done when**: Imperial halls, rooms and doors validated; V1 `catalogue.json` generated and
  reloaded without re-analysis.
- **Commits to**: D46, V8, V9.

**Phase 1 milestone — reached on 22 Sep 2026**: Imperial catalogue built in the browser
(111 pieces analysed in ~9 s, then cached in IndexedDB), validated by hand: 105 tiles,
15 connection types (including 3 distinct 512 sides of large rooms and 1 composite profile),
annotations versioned in `data/annotations/imperial.json`.

---

## Phase 2 – V1 editor

Order designed to have something visible early, then editable, then written.

### Step 11 – Setup and loading a cell — DONE (22 Sep 2026)
Format-independent level store (`src/lib/level/store.ts`, D57) and its `.esp` backend
(`espStore.ts`: interior cells and REFRs by FormKey, plugin ownership vs master override);
`loadCell.ts` derives the grid with the validated catalogue (analysis + annotations);
`summary.ts` for the counts. Editor state (`src/lib/editor/editorStore.svelte.ts`); choice of
the working plugin in Setup (remembered); Editor page: list of cells, loading, tiles by
category, non-editable objects by reason and by base, SVG map of occupied cells.
5 tests. **Checked in the app** on the working mod's cell: 586 references, 205 tiles on the
grid (as in R10), 381 non-editable objects, 8 shared cells tolerated, anchor
(−384, −128, −512).

- **Why**: entry point of the tool; directly reuses steps 3, 5 and 6.
- **What**: setup screen (Data folder, plugin, remembered); list of the plugin's interior
  cells; loading → `TilePlacement[]` + `OpaqueRef[]` + grid anchoring. Editor state model
  (`src/lib/editor`) in Svelte 5 runes. Plugin access goes through a "level store" interface
  (D57) whose first backend is `.esp`, to plug in Spriggit in phase 6 without touching the
  editor.
- **Done when**: the working mod's cell loads and the list of recognised / opaque refs is
  displayed.

### Step 12 – Rendering: grid, tiles, pan/zoom — DONE (23 Sep 2026)
`src/lib/render`: `transform.ts` (Skyrim placement → three.js matrix, tested against the grid
derivation for the 4 rotations), `meshCache.ts` (one mesh per model, read once via the Data
view), `sceneObjects.ts` (tiles in category colour, master tiles in purple, other objects in
grey or as a marker if their model is unknown), `CellScene.ts` (orthographic top-down camera,
kit grid anchored like the derivation, pan/zoom without rotation, on-demand rendering,
selection on click without drag). `CellView.svelte` component in the Editor page, selection
panel (EditorID, cell, rotation, master override). Known limitation: only Imperial kit objects
have a known model; the others (markers, non-kit clutter, custom pieces) are markers until the
STATs of all masters are read.
**Checked in the app**: the tiles join exactly on the grid; 311 meshes (44 distinct models)
and 275 markers loaded in **0.3 s**, after adding a cache of folder listings in the Data view
(`Overlay`, each folder of each MO2 layer read once; 14 s before). "Other objects" setting:
visible / very transparent / hidden, remembered.

- **Why**: the designer must see the level before modifying it.
- **What**: `src/lib/render`: three.js scene, orthographic top-down camera, grid at the module,
  real untextured shaded meshes (V3) loaded from the BSA with a per-model cache, opaque refs in
  grey, mouse pan/zoom, selection by click (raycast).
- **Done when**: the working mod's cell displays legibly, 60 fps on 100 tiles.
- **Commits to**: D44, V3.

### Step 13 – Editing: add, move, delete, rotate, undo/redo

**DONE, checked in the app** (10 tiles, undo all, redo all). `src/lib/grid/edit.ts` (immutable
layout, add, move, rotation around the min corner, delete, refusal of new conflicts (D58),
master tiles read-only, undo/redo history), tested. Editor page: palette, green/red ghost, drag
the selected tile, R / Shift+R, Del, Esc, Ctrl+Z / Ctrl+Y, counter of unsaved changes (writing
in step 15).
- **Why**: core of the tool; pure logic in `src/lib/grid` testable without DOM.
- **What**: cell occupancy, overlap detection (refusal + highlight), 90° rotation, drag move
  with snap, delete, command-based undo/redo stack, piece palette filtered by category.
- **Done when**: unit tests on occupancy/overlap/rotation; manual scenario: build 10 tiles,
  undo all, redo all.
- **Commits to**: V4.

### Step 14 – Contextual assistant: click on an open face

**DONE, checked in the app (23-24 Sep 2026).** `src/lib/grid/assist.ts` and `joints.ts`,
tested:
- an opening is a contiguous run of faces with the same direction and the same type; open
  faces (orange) = openings whose outer cells are free;
- candidates = openings of a compatible type (`facesMate`, composites included), rotated to
  face each other, centred (a narrower opening within a wider one), without overlap; a ramp is
  proposed going up or down;
- levels: a face carries the level of its opening and a piece occupies all levels between its
  openings (D59); without this, junctions of slopes looked open;
- junctions judged on their two overlaid profiles (D60): exact or included pass, seam in
  yellow with the gap in units, incompatible or opening against a wall in red; the type
  tolerance (8 units) let through seams visible up close;
- cells shared by two tiles in magenta (the R10 detection, tolerated by D58);
- panel: compatible pieces with the drawing of their profile, ghost on hover, placement on
  click; for a marked junction, the two overlaid profiles.
Checked on the working mod's cell: known seams in yellow, one unknown seam discovered, no more
false positives. Annotations corrected along the way: pair
`ImpLRoomDoor01:-Y` / `ImpLRoomDoor03:+Y` merged (profile actually symmetric).
- **Why**: this is the main promise of the tool ("only proposes what fits").
- **What**: free open faces = `conn` faces whose neighbouring cell is empty; highlight; on
  click, list of pieces with a `mate` face that can be placed there (all rotations tested),
  ghost preview on hover, placement on click.
- **Idea kept (22 Sep 2026)**: in the list of compatible pieces, show the drawing of the
  profile of the junction concerned (`ProfileView` component from step 10), to see at a glance
  which opening the proposed piece presents.
- **Done when**: on an empty cell, you chain hall → corner → room → door without ever picking
  an incompatible piece; unit tests on the candidate search.

### Step 14b – Texture continuity at junctions
- **Why**: an identical profile does not guarantee a continuous texture. Observed on
  24 Sep 2026: a symmetric room piece placed the wrong way round joins without a seam, but its
  texture is interrupted; rotated by 180°, it becomes continuous.
- **What**: read from the NIFs the vertex UVs and the texture file of each shape
  (`BSShaderTextureSet`); along the open edges of a junction, compare on each side the file
  and the texture coordinate (continuous up to a whole number of repeats); a "discontinuous
  texture" verdict in another colour, with the cause (different file or offset join); the
  assistant first proposes the rotation that keeps the texture continuous.
- **Limits**: only the junction edges are compared; some pieces may be designed with a slight
  offset, threshold to tune on the working mod's cell.
- **Option** (decided on 24 Sep 2026): **optional check, disabled by default**, enabled by a
  "Texture continuity check" checkbox; without it, proposals and marks remain those of the
  profiles.
- **When**: later (refinement, not essential for writing the plugin). Observed during the test
  of step 15b: 4 pieces fit without a seam, but their texture is not always continuous.
- **Done when**: the wrongly rotated room piece is flagged, and no longer after rotation; unit
  tests on the UV comparison.

### Step 15 – Saving in place into the plugin

**DONE, checked in the app (24 Sep 2026):** changes are saved into the plugin.
`src/lib/level/edits.ts` (grid changes → edits: add, move, delete by FormKey),
`EspLevelStore.applyEdits` (all or nothing: refusal if a ref belongs to a master (D22) or if
the base comes from a plugin that is not a master), `level/save.ts` (refusal if the file
changed on disk since loading, timestamped copy
`DungeonMakerBackups/<name>.<YYYYMMDD-HHMMSS>.esp.bak` next to the plugin, atomic write, byte
for byte read-back). Editor page: "Save to plugin" button (Ctrl+S) with a CK warning on the
first save, "Reload plugin", browser warning when closing with unsaved changes; after saving
the cell is reloaded and the history restarts from the file.
- **Why**: without it, nothing reaches the CK. Last because it is the most destructive.
- **What**: explicit button (V5); timestamped backup copy (D47); existing refs kept (FormID),
  new refs created, deleted refs removed; "close or reload the CK" warning; refusal if ESL
  plugin.
- **Done when**: cycle load → modify → save → reload → identical; the plugin opens in the CK,
  the tiles are in place, no gap.
- **Commits to**: D21, D22, D47, V5.

### Step 15b – Assistant: only propose what fits with all neighbours
- **Why**: requested on 24 Sep 2026. When clicking a piece's open face, the proposals only take
  that face into account; a proposed piece may not fit with the other pieces it will touch once
  placed.
- **What**: for each candidate, simulate the placement and judge all its junctions with the
  existing pieces (D60): discard a candidate that creates an incompatible junction or puts an
  opening against a wall; flag (without discarding) one that creates a seam.
  Measure and reduce the 1 to 2 s delay observed after each modification.
- **Done when**: in an L-shaped configuration, only pieces that fit with both neighbours are
  proposed; a modification displays without perceptible delay.

**DONE (24 Sep 2026)**: `checkCandidates` (`src/lib/grid/assist.ts`) simulates the placement
of each candidate and judges all its junctions (`jointsOfTile`): incompatible or opening
against a wall = discarded, seam = kept and flagged. **L case checked in the app.** Delay:
profile verdicts cached per pair of pieces and relative position; measurements in the console
(`junctions checked in`, `scene updated in`). Measured in the app: ~300 ms on the first
computation (empty cache), then 2 to 6 ms for the junctions and 1 to 6 ms for the scene on
each modification, instead of 1 to 2 s.

### Step 16 – V1 milestone: testing the success criterion

**Prerequisite added (24 Sep 2026), DONE, checked in the CK and in game**: creating a plugin
and cells (D62). Setup: "New plugin" (name, MO2 mod folder or new mod folder, "Reload MO2
profile" after enabling it in MO2). Editor: "New cell..." (EditorID), empty cell with a grid
around the origin.
- **What**: time the construction of a 30-tile dungeon from an empty cell duplicated in the
  CK; open in the CK; record the frictions in `05-ideas.md`.
- **Done when**: < 10 minutes, no CK error, no gap. Otherwise: list of fixes, and we iterate on
  12–15.

**DONE (24 Sep 2026).** Test done by the author: "very fast; limited, but fast, faster than
with the CK anyway. Good for a V1." Frictions found and handled right away:
- picking a cell required "Load cell": the chosen cell now loads by itself, and the last one
  opened is remembered per plugin (and reopened when the plugin is opened);
- the list of compatible pieces proposed pieces with a seam: discarded; the list now has its
  title, its search and its type filter, and the general palette disappears while a face is
  selected; the technical details of the face are collapsed;
- after "Save to plugin", tiles reappeared duplicated, offset: two scene updates interleaved,
  and a layout was drawn for an instant with the anchor of the new cell; fixed (atomic scene
  update, layout tied to its cell).
Left for step 17: the presentation (UX).

### Step 17 – End-of-V1 ergonomics: simple onboarding and interface

**DONE (24 Sep 2026): V1 declared finished.** Part 1 done: Editor / Settings top bar, Settings
with a left panel (Folders and plugin, Catalogue, Validation, Developer in development),
three-step Getting started page, direct opening of the editor once configured.
Part 2 done: simplified toolbar (main Save with the number of changes), transient messages,
short help and collapsed shortcuts, legend of the marks, dark-themed controls. Added: smart
snapping of pieces (new and moved) onto the open faces they fit, since not all pieces are
aligned on the raw grid.
- **Why**: the V1 goal (useful and usable). To do at the very end of V1, when the features are
  stable.
- **What**: a simple "Getting started" flow; "Setup" becomes "Settings", with Catalogue and
  Validation as sub-pages in a left panel; simplify and make more understandable what you see
  in the editor.
- **Done when**: someone discovering the tool configures it and builds their first tiles
  without explanation.

---

## After V1

**Publication (24 Sep 2026)**: GitHub repository `dickeyf/SkyrimDungeonPlanner`, GPL v3
licence. Continuous integration: CI (formatting, lint, types, tests, build), CodeQL (static
analysis), Security (npm audit + Trivy: vulnerabilities, secrets, configurations), "single
file" build (a standalone `SkyrimDungeonPlanner.html`, attached to `v*` releases), minimal
nginx Docker image serving the app on port 8080 (GHCR, scanned by Trivy).

Phases 3 (NavMesh), 4 (Z), 5 (props), 6 (Spriggit mode, D57): see `04-roadmap.md`. Nothing in
the steps above must close these doors: `cells` stays 3D, `Piece.walkable` / `obstacle` /
`ConnectionType.navEdge` stay in the format even if they are `null`.
