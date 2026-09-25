# Risks and proofs of concept

Goal: be able to test the concept before investing in the tool. Each risk has a minimal test and a success criterion. Order = suggested order of the tests.

## Blockers for V1

### R5 – Module and pivots of the Imperial kit
The real module (XY and Z) is unknown; bounds do not give the footprint (cornice/baseboard overhangs, e.g. `impfreewall01`: 384 core, +22 at each end); pivots are not at the center.
- **Test**: script (pynifly outside Blender) on the Imperial hallways/rooms/doors: bounds, pivot position, floor extent.
- **Success**: a consistent XY module emerges and each piece is described by `pivot` + `cells`.
- **Result (21 Sep 2026, `smallhall`, 25 pieces, `tools/r5_module_pivots.py`): success.**
  Since pynifly cannot be installed outside Blender, a home-made NIF reader (`tools/nif.py`).
  - Base tile 256 × 256 (XY), NIF origin at the **center** of the tile, floor at z = +8,
    ceiling at z ≈ 307 (interior height ≈ 300). No exotic offset: 23 pieces out of 25
    have exactly this pivot, the other 2 are the descending variants (floor at -56 / -120).
  - Openings: a single profile, 194 wide (198 on two +X faces of `3way01`/`4way01`),
    299 high (z 8 → 307), centered on the side of the tile. Closed face = no geometry
    on the plane, except a cornice at z 210 → 310 (never mistaken for an opening).
  - Variants: `128l/r` shift the exit by ±128 in X (piece spanning 3 cells of 128),
    `64l/r` by ±64; `128u/d` and `64u/d` shift the exit by ±128 / ±64 in Z;
    `128short` / `64short` are 128 / 64 long (openings at ±64 / ±32); the stairs
    are 2 tiles long and rise by **256**.
  - Fit to the module: 256 → 19/25, **128 → 22/25** (only the 3 "64" variants
    do not fall on it), 64 → 25/25. The opening planes are on the grid within ±4 units.
  - Overhangs outside the cell (cornices, wall returns): ≤ 6 units, except `128l/r` (up to
    24 units short of the 3rd cell); the `cells` computation tolerates a quarter module.
  - Opening heuristic reusable for R3: the vertices of an opening lie on open
    edges (measured share 0.23 → 1.00), those of a rendered wall never do (0.00).
  - Decision taken: D51 (module 128), D53 (module per kit), D54 (transitions); D52 (pivot) proposed.
- **Result on the other V1 sub-kits (21 Sep 2026, module 128)**:
  | Sub-kit | Tile | Cells | Pivot (XY) | Floor (NIF z) | Opening profiles (width × height, floor z) | Fit |
  |---|---|---|---|---|---|---|
  | `smallhall` | 256 × 256 | 2 × 2 | center | +8 | 194 × 299 @ +8 | 22 / 25 (3 "64" variants) |
  | `largehall` | 512 × 512 | 4 × 4 | center | -8 | 447 × 476 @ -8; stairs 1024 long, +512 | 28 / 31 (3 "64" variants) |
  | `smallroom` | 256 × 256 | 2 × 2 | center | +2 / -3 | 256 (full side, room-to-room), 225 (side with wall, offset by 16), 194 × 299 @ +8 (door to hallway) | 21 / 22 (`brace01` = prop) |
  | `largeroom` | 512 × 512 (`doorl`: 512 × 726, 4 × 6) | 4 × 4 | center | -34 | 512 / 414 × 770 (two storeys), 194 × 299 @ +8 (door to hallway, 42 above the room floor) | 34 / 35 (`pillar01` = prop) |
  | `door` | — | — | — | — | none: these are the DOOR objects (wooden doors, trapdoors, buttons, cages), not tiles | 0 / 14 (props) |
  - **Summary: 105 structural tiles out of 113 fit the 128 module**; the other 8 are
    the 6 "64" variants (out of V1 per D51) and 2 props. All tiles have their pivot at the
    XY center of the tile.
  - **The Z of a face belongs to the connection profile, not to the cell**: the floor of the
    openings varies by family (+8 hallways, -8 large hallways, +2/-3 small rooms,
    -34 large rooms) and a large room tile has a room face at -34 and a door face
    at +8. Cells stay 128 in Z; the R3 signature includes the profile z.
  - **Catalogue category `door` = the tiles with a doorway** of the hall/room sub-kits
    (`imphalldoor*`, `improomdoor*`, `implroomdoor*`), which carry the 194 × 299 profile. The
    `door/` folder contains the DOOR objects, which stay in the CK (V2 confirmed).

### R3 – Reliability of mesh signatures
Hypothesis: two compatible pieces have the same vertices on their junction plane.
- **Test**: on 10–15 pieces whose compatibility is known, compute the face signatures (vertices on the plane ± tolerance, local coordinates, quantized, hashed).
- **Success**: compatible pairs = same signature (or mirror); incompatible = different; closed faces = empty. Identify the tolerance needed.
- **Points to watch**: coordinates local to the face (independent of the piece's position and rotation); left/right mirror effect between two faces looking at each other; rounding before hashing is fragile near a rounding boundary → compare point sets with tolerance, group, then give the group an identifier; "extra" vertices on the plane (door frame, decoration) → if needed compare only the outline of the opening.
- **Preferred signature**: the **open edges** of the mesh (used by a single triangle) lying on the junction plane, as normalized polylines (collinear segments merged). These are exactly the edges that must coincide so that no gap is visible; an extra vertex on a straight segment changes nothing.
- **Approximate matching**: similarity score between two profiles (share of the points/segments of A found in B within tolerance, and the reverse; mirror tested too). Three tiers: exact → same type automatically; close → offered for human validation with the two profiles overlaid, never accepted automatically; far → distinct types. Coarse key (width, height, Z of the opening floor) as a first filter. Comparison done only once, when building the catalogue.
- **Fallback**: manual entry assisted by the EditorID names. The project remains viable.
- **Result (21 Sep 2026, `tools/r3_face_signatures.py`, 4 V1 sub-kits, 111 pieces, 304 faces): success.**
  - Signature = polylines of the open edges on the face plane, in local coordinates
    (u to the right as seen from outside, origin at the center of the covered cells; v = z minus
    the level), compared by sampling with tolerance, mirror tested.
  - Three clean-ups were needed, all anticipated by the "points to watch":
    1. exclude meshes with an alpha property (grime decals, different on each piece);
    2. keep only the main connected components of the open edges (the medallions
       and cornice ends lying in the plane are not part of the junction);
    3. **8-unit tolerance**: the left and right jambs of the same opening are
       modeled with vertices that differ by up to 6 units, and Bethesda connects
       any hallway face to any other.
  - **15 groups**, reflecting the structure of the kit: door profile 194 × 299 (66 faces,
    **shared by `smallhall`, `smallroom` and `largeroom`**, symmetric); large hallway 447 × 476
    (60 faces, symmetric); small room full side 256 (24, symmetric) and offset side with wall 225
    (2 groups of 20, **mirrors of each other**, as D13 anticipated); large room
    414 in two heights (4 groups of 16, two mirror pairs) and 512 (2 mirror groups of 16 + 4
    `mid` faces); `door` tiles of the large hallway (10); "64" variants (2 + 2, out of V1).
  - Compatible pairs = same group or mirror group; incompatible (194 / 447 / 256 / 225 /
    414 / 512) = distinct groups, no confusion; closed faces = no opening (R5).
  - **To be validated by a human ("close" tier)**: the 512 sides of the large rooms
    (3 groups at 0.91 between them, in only 3 pairs of groups; two are exact mirrors
    of each other at 1.00 and the third, the `mid` pieces, is **included** in the other
    two); the two heights 770 / 728 of the 414 sides (the two faces of the same large room
    corner are not mirrors of each other: 0.94).
  - **Composite profiles, an R3 discovery**: the outline of the 447 hallway is 100 % included
    in that of the 10 `implhalldoor*` faces, and their surplus (466 points, u ± 104, v 8 → 307)
    is exactly the 194 × 299 door arch. These tiles are large hallway ends closed
    by a wall pierced with a small door: the same face connects to the 447 hallway (which it
    closes) **and** to the 194 hallway (which it opens). Rule to remember: if the outline of A is
    entirely on the outline of B (coverage 1.00 in one direction), A and B connect without a
    gap; the extra edges of B are its own structure. The `min` score of both directions
    (0.67 here) is not enough; inclusion is a third criterion, offered for human
    validation (D56).
  - Time: 17 s for 304 faces in Python; report `tools/out/r3-<sub-kits>-128.json`
    with the polylines, reusable by the tests of the TypeScript port.

### R6 – Editing the plugin in place
Read/write without losing FormIDs, unknown records, or what the CK produced. Test merged into **R14c** (on a copy of the working plugin). **Settled**: R14c passed (identical round trip), and V1 writes the working plugin in place, verified in the CK and in game (step 15).
- **Note**: the plugin cannot be written while the CK has it open; MO2/VFS – plan for "close or reload the CK". Implemented: the save is refused if the file changed on disk since it was loaded, and warns about the CK (D47).

### R10 – Deriving the grid of an existing cell
Refs slightly offset, rotated off 90°, scaled; grid origin specific to each cell.
- **Test**: on a vanilla Imperial cell and the cell of the working mod, count the kit refs that fall on the grid.
- **Success**: the vast majority of structural tiles are recognized; the rest is displayed as opaque without getting in the way.
- **Result (22 Sep 2026, `poc/r10-grid.html`, cell of the working mod): success.**
  579 REFR → **205 tiles recognized, 374 opaque, all for "unknown base"**: no ref
  off the grid, tilted, scaled or rotated off 90°. The opaque ones are props and
  sub-kits out of V1 (pillars, rubble, beams, chandeliers, markers, prison walls and
  frames, custom pieces of the mod). Anchor found by best fit
  at (−384, −128, −512). Derivation in 1.5 ms; provisional catalogue (9720 STAT from
  `Skyrim.esm` read by targeted reading, 111 tiles joined to the R5 measurements) built in
  130 ms. The 2D footprint map reproduces the dungeon layout.
  - **Bug found and fixed along the way**: R5 indexes cells relative to the NIF
    origin; the catalogue wants them from the min corner (D52). Not normalized, the footprints
    were shifted by one cell depending on the rotation: 122 conflicting cells. Normalized: 8,
    identical in both rotation conventions, hence real level design overlaps.
  - **Rotation convention**: clockwise Skyrim heading (0 = +Y) → −rz in counterclockwise
    quarter turns, consistent with the CK documentation. This cell cannot settle it
    (symmetric pieces); an asymmetric piece rotated by 90° will confirm it in use.
  - Consequence for the editor (D58): existing overlaps are tolerated on
    load; only new placements are refused in case of conflict.

### R9 – Tooling: everything in the browser
Research of 21 Sep 2026: no ready-to-use JS/WASM library to **write** Skyrim plugins; the Rust crates found (esplugin, skyrim-cell-dump) are read-only; a fully in-browser NIF editor exists for Morrowind assets (NIFZER0EDIT), which shows the approach is viable. Consequence: targeted home-made parsers (D45). `pytes5`, Mutagen, Spriggit are no longer on the critical path.

### R14 – Browser stack (new, blocking)
Three building blocks to prove, each with a test HTML page:
- **a. Disk access**: pick the Data folder, read the handle back in the next session, write a file in place. Success: no re-picking of the folder, atomic write.
  - **Result (21 Sep 2026, Chrome, `poc/r14a-fs.html`): success.** After reload, the
    handle is read back from IndexedDB with the permission already `granted` (Chrome keeps the
    granted permission; no "Re-authorize" click was needed). Game root
    recognized by `Data/Skyrim.esm`. 18 archives listed in 6 ms; header of
    `Skyrim - Meshes0.bsa` read with a 36-byte range in 0.8 ms (`BSA`, v105, 978 folders,
    19 443 files); 64-byte write in 67 ms, read back identical, then deleted.
    Module `src/lib/fs`: case-insensitive paths, range reads, atomic write
    via `createWritable`, handles in IndexedDB, 16 unit tests on fake handles.
  - Note: the chosen folder is called "Game Root" and contains only 18 archives, versus
    about a hundred in the Steam `Data` listed earlier (Creation Club included): probably a
    "stock game" copy managed by MO2. To be confirmed with the MO2 question (R15, D50): which
    folder should the tool target by default.
- **b. BSA + NIF**: read an Imperial NIF directly from `Skyrim - Meshes*.bsa` (reading in slices, without loading the whole GB; LZ4 decompression), extract vertices and triangles, display it in WebGL. Success: the tile is displayed at the right scale.
  - **Result (21 Sep 2026, Chrome, `poc/r14b-bsa-nif.html`): success.** `imphall1way01`
    read from `Skyrim - Meshes0.bsa` through the MO2 virtual Data view (71 mods, 11 archives
    open): archive tables (19 443 files) read in 18 ms, LZ4 file 72 060 →
    99 910 bytes decompressed in 1.9 ms, NIF parsed in 1.1 ms; 20 blocks, 4 shapes, 2230
    vertices, 3428 triangles, box -128..128 × -128..128 × 2.5..310, identical to the
    R5 report. Displayed in three.js centered on the origin, untextured; `128l01` spills over 3 × 2
    cells without filling the third (24 units, as measured by R5). TypeScript ports of
    `tools/bsa.py` and `tools/nif.py` in `src/lib/format/{bsa,nif}` + `src/lib/compress/lz4.ts`,
    18 tests on synthetic fixtures. The first access costs ~140 ms because the tables of
    each archive are opened on demand from the end of the load order; the app
    will build a path → archive index at startup.
- **c. ESP in place**: parse a plugin into opaque records, rewrite it; success = byte-for-byte identical file. Then add a REFR to a cell (group sizes, record counter and next ID in the header), open in the CK and xEdit without errors. Watch out for ESL plugins (FormID range) and compressed records.
  - **Result (22 Sep 2026, `poc/r14c-esp.html`, working plugin read from its MO2 mod
    folder): full success.** 276 311 bytes, 13 masters, 1306 nodes, parsed in 1.2 ms;
    **byte-for-byte identical rewrite** in 2.1 ms. Working cell: 579 REFR
    owned by the plugin + 24 placed objects of other types (ACHR, NAVM) that pass through intact.
    Added a REFR (copy of `ImpJailDoor01` raised by 512) written to a copy
    `.r14c.esp`: xEdit loads it without errors, the added REFR is in the Temporary group
    at the right position, the CK shows the floating door. Covers R6.
  - **Note**: the CK's `HEDR numRecords` counter is 1303 for a tree of 1306 nodes;
    the tool therefore applies a delta to the original counter rather than a recount. The CK and xEdit
    accepted either value.
  - `src/lib/format/esp`: opaque records and groups, subrecords (`XXXX`), compressed
    records (zlib), TES4 (ESL refused), CELL/REFR, `addRefr` / `moveRefr` / `deleteRefr`
    limited to records owned by the plugin (D22), FormKey ↔ FormID; 12 tests.
- **Fallback** if b or c fails: a small local extraction utility that produces the catalogue, the editor remaining a SPA.

### R15 – MO2 and files outside Data
The browser does not see the MO2 VFS: mod meshes (custom kits) are in their mod folders. Loose mesh files take precedence over BSAs. Later (D49). Two options:
- **Read `modlist.txt`** of the MO2 profile and overlay the `mods/*` folders in order: no dependency on the VFS, works with Chrome already open. Main option.
  **Became necessary for V1** (21 Sep 2026): stock "Game Root" install + all DLCs and the working plugin in MO2, a very common setup among modders. Implemented in `src/lib/vfs` (D50), test page `poc/r15-mo2.html`. **Result (21 Sep 2026): success.** The mod order matches the MO2 left panel (the first in `modlist.txt` is indeed the highest priority), the profile is the right one, `Dawnguard.esm` and the working plugin are found in their mod folder, `Skyrim.esm` in the game's `Data`, the archives are ordered. No copy on disk.
- **Launch Chrome through MO2**: USVFS hooks the launched process and its children, but if Chrome is already running, the launch is handed to the existing (unhooked) instance → a separate profile would be needed (`--user-data-dir`). Compatibility with the Chrome sandbox unknown. Test: launch this way, open the folder picker on Data, check that a mod file appears there.
- Vortex: deployment by links in Data, so nothing to do.

## Blockers for the NavMesh

### R1 – Writing a valid NAVM (the biggest technical risk)
Triangle adjacencies, edge flags, internal search grid, door links.
- **Test**: generate by code the NavMesh of ONE hallway tile, open in the CK, Finalize, have an NPC walk in game.
- **Success**: the CK accepts it without errors, the NPC moves around.

### R2 – Several NAVMs in an interior cell
Hypothesis: one NAVM record per baked batch, connected by the Finalize edge links.
- **Test (no code)**: in the CK, two separate NavMeshes in a test cell with coinciding edge vertices; Finalize; check the links and the pathing of an NPC across the seam.
- **Success**: continuous pathing. **Fallback**: a single NAVM per cell, the partial bake rewrites the record while preserving the triangles outside the selection.

### R4 – Walkable polygon from collision
- **Test**: on 3 tiles (hallway, room corner, door): upward-facing collision triangles → projection → union → erosion against the walls.
- **Success**: clean polygon, few vertices, comparable to what a designer would draw. Manual correction possible in the catalogue.

### R11 – T junctions
Opening narrower than the neighbor's edge; neighbor's obstacle within a margin of the boundary. Planned answer: union then triangulation (D38) rather than template variants. To be confirmed together with R4.

## Later

### R7 – Stacked volumes
The 2D union does not tolerate two stacked floors: handle per layer, connect at the stairs. The UX of Z slices and of pieces straddling two slices remains to be designed.

### R12 – Obstacles in the NavMesh
Footprints of props/clutter/furniture; movable objects (Havok) to ignore; volume of data to produce.

### R13 – Distribution
Settled by D46: each user builds the catalogue from their own install, in their browser; we distribute only our annotations. The annotations are indexed by EditorID (V9). The app itself is distributed as a single HTML file per release and a Docker image (V12).

### R16 – Deep junction check (visible leaks)
Idea of 24 Sep 2026. The profiles (D60) only see the open edges in the junction
plane: a door frame or a floor that does not connect slightly set back escapes them
(case `ImpLRoomDoor02` / `ImpLHallDoor02`). Proposed hybrid method, on the two pieces
placed side by side:
1. **Exact check**: around the junction, the free borders of each mesh (edges
   of a single triangle); exact distance to the surface of the other piece; a border neither rejoined nor
   covered within a threshold (~0.5 unit, to be tuned) is a candidate gap, with its
   width. Deterministic: no thin gap slips between two samples.
2. **Visibility from inside** (the level editors' leak test): GPU rendering
   (three.js) from viewpoints where the player can stand, close to the junction,
   at a real screen resolution, front faces / back faces / void in
   distinct colors. A back face or the void = visible leak. Rules out candidate gaps
   hidden behind an overlap, a common practice of kit authors.
Verdict: candidate gap AND visible = defect. Limit: geometry only; a gap of a
fraction of a unit can let light through, threshold to be validated on known cases.
Cost: much slower than the profiles; the profiles serve as a fast filter, the deep test
confirms the likely cases. Result cached locally (pair of pieces, pair of
faces, relative position → fits, valid rotations, leaks), recomputed if the pieces
change; outside the repository (data derived from the game files). The same pass can cover
texture continuity (step 14b). For caves and props: say where a leak must
be plugged (rock, column) and confirm that a placed plug covers it.
**Proof of concept**: the `ImpLRoomDoor02` / `ImpLHallDoor02` seam is detected; the
room pieces around `ImpLRoomMid02`, with no seam in game, are not.

## Project risk

### R8 – Ambition
The full plan is very ambitious. Mitigation: narrow V1 (one kit, one Z, no NavMesh), structures designed broad, proofs of concept first. **So far**: V1 was built and released as 0.1.0 in four days (21–24 Sep 2026), every blocker for V1 proven first.
