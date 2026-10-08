# Decisions

Statuses: **Decided** (settled), **Proposed** (suggested, to be confirmed), **Open**.

## Scope
| # | Decision | Status |
|---|---|---|
| D1 | Imperial kit first; corridors, rooms and doors to begin with | Decided |
| D2 | V1 on a single Z | Decided |
| D3 | Z will come later, through "slices" to stay in top-down 2D; the UI renders what lies below the active slice transparent/dimmed, with an option to hide everything | Decided |
| D4 | Cross-section view to see the structure of the floors: later, but must remain possible | Decided |
| D5 | Free overlapping volumes eventually (not only connected floors) | Decided |
| D6 | Free pieces (pillars, free-standing walls) to be supported, in addition to structural tiles; not in V1 | Decided |
| D7 | Caves out of initial scope (they do not snap cleanly). **Revised on 25 Sep 2026**: out of V1 (0.1.0), but part of 1.0.0, which supports every interior kit of the base `.esm` files (D63); caves will rely on the deep junction check (R16) to show where a leak must be plugged | Decided (25 Sep 2026) |

## Data
| # | Decision | Status |
|---|---|---|
| D10 | The .esp is the source of truth for the level; the tool only manages the pieces' fitting data | Decided |
| D11 | The piece list is extracted from the ESM (STAT records: EditorID, model, bounds), filtered by model path | Decided |
| D12 | Fitting rules are not in the ESM: a database maintained by the tool, filled by mesh analysis (profile signatures at the faces) + manual validation | Decided (mesh analysis **proven** by R3 on 21 Sep 2026: 15 groups over 304 faces, tolerance 8 units) |
| D13 | Compatibility is stored as a **connection type per face**, not as a piece-to-piece table; "A fits with B" is derived | Decided |
| D14 | Not the whole structure in V1, but the V1 format must not block Z, props or the NavMesh | Decided |
| D15 | Two object classes: **Tile** (snapped, occupies cells, typed faces) and **Prop** (free transform, outside compatibility, optional snap aids) | Proposed |

## Relationship with the CK
| # | Decision | Status |
|---|---|---|
| D20 | Export + reading back an existing cell | Decided |
| D21 | Plugin modified **in place**: keep the FormIDs of existing refs, never regenerate the cell | Decided (validated by R14c on 22 Sep 2026) |
| D22 | The tool only touches the tile refs it recognizes; everything else (lights, clutter, markers) passes through intact. Implemented: `Plugin` only modifies REFRs whose FormID belongs to the plugin, never master overrides | Decided (validated by R14c) |
| D23 | A ref that does not fall on the grid or whose base is unknown is displayed as an opaque, non-editable object | Decided (validated by R10: 374 opaque out of 579, all due to unknown base) |

## NavMesh and bake
| # | Decision | Status |
|---|---|---|
| D30 | The NavMesh is only generated on explicit request | Decided |
| D31 | General concept of "bake" on demand; the NavMesh is one example. Erasing everything and starting over must be possible | Decided |
| D32 | Partial bake: NavMesh of the selected tiles only; a "fill" tool selects the tiles without NavMesh | Decided |
| D33 | Connection to the existing NavMesh: attempted automatically; otherwise the designer connects it in the CK | Decided |
| D34 | Manual finalization in the CK only happens at the very end; the tool does not try to preserve or merge manual touch-ups | Decided |
| D35 | "Tile without NavMesh" determined by a geometric test (a triangle whose center falls within the tile's volume), not by internal tracking | Decided (29 Sep 2026, with D64) |
| D36 | **One NAVM record per cell**: a bake is merged into the cell's NavMesh, its boundary vertices welded onto the neighbours' (canonical junction vertices, D38), so a partial bake rewrites the single NAVM and keeps the triangles outside the selection. No edge links between the tool's own batches or pieces: the game supports them inside a cell (812 in 80 interior cells of Skyrim.esm) but the CK's Finalize did not create them in the R2 test, and welding is simpler and matches most vanilla cells; edge links stay the fallback if welding fails. Which triangles a bake may replace: see D64 | Decided (26 Sep 2026) |
| D37 | "Locked" flag per cell once in the finishing phase: Replace and Clear are disabled while it is on. A UI safeguard, kept in the browser per plugin and cell (not in the .esp) | Decided (30 Sep 2026) |
| D38 | NavMesh templates = **walkable polygons** per tile (not triangles); at bake: union → subtraction of obstacles → triangulation; canonical vertices forced at the boundaries according to the connection type | Proposed |
| D39 | Taking obstacles into account in the NavMesh in iterations: free-standing walls → pillars → clutter → furniture. Later, but the architecture must allow it | Decided |

## Audience and platform
| # | Decision | Status |
|---|---|---|
| D40 | Target audience: modders (published tool) | Decided |
| D41 | Browser SPA, **no backend**, no installation | Decided (subject to R14) |
| D42 | Configuration: game root folder + plugin to work on; the tool remembers them from one session to the next. **Completed (D49 revised)**: + MO2 instance and profile, optional; without MO2 (Vortex or vanilla), the Data view = the `Data` folder alone. The profile is chosen in the tool and remembered (localStorage): a global MO2 instance does not have its `ModOrganizer.ini` in the instance folder, so MO2's active profile is not readable | Decided |
| D43 | Disk access through the File System Access API (Chromium: Chrome/Edge). Folder handles are kept in IndexedDB, not in localStorage; localStorage for simple preferences | Decided (validated by R14a on 21 Sep 2026) |
| D44 | WebGL 3D rendering in the canvas; the top-down 2D view = orthographic camera on the 3D scene; Z slices = clipping planes; cross-section view = orthographic side camera | Decided (implemented at step 12, 23 Sep 2026: orthographic top-down camera on the 3D scene) |
| D45 | Targeted in-house parsers rather than full libraries: ESP (opaque records, only STAT/CELL/REFR/NAVM decoded), BSA v105 + LZ4, NIF SSE (nodes, BSTriShape, collision) | Decided (BSA + LZ4 + NIF validated by R14b, ESP validated by R14c) |
| D46 | The catalogue is built **in the user's browser** from their installation; only our annotations (type names, validations) are distributed | Decided (validated by step 9 on 22 Sep 2026: 111 pieces analyzed in 9 s, identical to the Python measurements) |
| D47 | Backup copy of the plugin before any write: timestamped copy in `DungeonMakerBackups/` next to the plugin (`.bak` extension, ignored by the game and the CK); the write is refused if the file changed on disk since it was loaded | Decided (24 Sep 2026) |
| D48 | Chromium limitation accepted; degraded mode (file import/export) later, if it can be added | Decided |
| D49 | ~~Custom pieces / MO2 VFS: after good coverage of the base game~~ **Revised on 21 Sep 2026**: the MO2 "virtual Data" view is needed from V1, because the DLCs and the working plugin live in `mods/*`, not in the game's `Data` (stock "Game Root" installation + MO2). Custom pieces remain for later | Decided |
| D50 | For MO2, main approach: the tool reads the profile's `modlist.txt` and resolves the priority of the mod folders itself (ordered layering), without depending on the VFS. Launching Chrome through MO2: ruled out unless needed. **Implemented** (`src/lib/vfs`, 21 Sep 2026): no copy on disk, just an in-memory lookup table; a write goes directly into the mod's folder. Plugin order read from `plugins.txt` / `loadorder.txt`, archive order = base archives from Skyrim.ini then each plugin's archives. Checked in `poc/r15-mo2.html` against the MO2 panel: the first mod in `modlist.txt` has the highest priority | Decided |

## Grid (from R5, 21 Sep 2026)
| # | Decision | Status |
|---|---|---|
| D51 | Grid module **XY = 128, Z = 128**: half of the 256 × 256 × 256 base tile. A standard corridor occupies 2 × 2 cells, an opening covers exactly 2 cells (left / right profile, mirrors of each other, which D13 provides for with `mate`). The kit's "64" variants (3 pieces out of 25 in `smallhall`: `64short`, `64u`, `64d`; `64l/r` fit) are outside V1. Alternative: module 64, everything fits (25/25) but 4 × 4 cells per corridor and 3–4 sub-faces per opening | Decided (21 Sep 2026) |
| D52 | A piece's pivot is the **NIF origin**, the point around which the CK positions and rotates the ref; the tool does not choose it, it records where it falls relative to the cells (`pivot` field). Measured: at the XY center of the tile for 101 tiles out of 105; the 4 `implroomdoorl*` (512 × 726) have the origin at the center of their 512 square and a door annex outside it. The catalogue's `pivot` and `cells` are read as-is from the R5 report (`tools/out/r5-<subkit>-128.json`), not entered by hand | Decided (21 Sep 2026) |
| D53 | The module is a **property of each kit** (`Kit.module`), never a code constant: each kit can have its own. The editor automatically adopts the module of the current kit; in V1 a cell uses a single kit. Moving a kit to a finer module = rerun R5 and revalidate its connection types, without touching the levels (the .esp is in world units, D10) | Decided |
| D54 | Transition pieces between kits: to be supported (after V1). When two kits with different modules coexist in a cell, the editor shows **both grids overlaid, each in its own color**, to show each kit's cells while placing the transition. Implies one grid (module + anchor) per kit in a cell, not a single grid | Decided |
| D55 | A **face's z is part of its connection profile** (R3 signature), not of the grid: opening floors vary by family (+8, -8, +2, -34 depending on the sub-kit) and the same tile can carry two z values. Cells stay 128 in Z; a tile's `pivot.z` = NIF origin relative to the floor of its slice, read from the R5 report. Two faces at different z do not fit (visible gap): level changes happen inside a piece (stairs, steps in a room), never at the junction | Decided (21 Sep 2026) |
| D56 | A face can carry **several connection types** (`conn` becomes a list): composite profiles (wall pierced by a door at the end of a large corridor, `implhalldoor*`) connect to each profile they contain. Compatibility by **inclusion** (outline of A entirely on that of B) is offered at the "almost" tier of validation, never accepted automatically. **Implemented**: `composites` annotation at the type level (`Face.extraConn`), 2 accepted for the `ImpLHallDoor*` | Decided (22 Sep 2026) |
| D57 | **Spriggit mode** (after V1): the working mod can be read and written in its Spriggit form (YAML/JSON, one file per record) instead of the `.esp`, because some mods are versioned in git without an `.esp`, generated only at build time. Masters (`.esm`/`.esp`) are still read in binary. Immediate consequence: from step 11, the editor goes through a "level store" interface (list cells, read refs, add/move/delete a REFR, save) whose `.esp` backend is the first implementation and Spriggit the second | Decided (22 Sep 2026) |
| D58 | **Existing overlaps** in a loaded cell are tolerated and simply flagged; the tool only refuses an overlap for a **new** placement or move. Measured: 8 conflicting squares in the working mod's cell, intended by the level designer | Proposed (R10) |
| D59 | A **face carries the Z level of its opening** (relative to the slice of the NIF origin), and a piece **occupies all levels between its openings**: a ramp or staircase occupies both levels it connects. Found at step 14: without this, the junctions of sloped pieces (`…D01`, `…U01`, `…R01`, stairs) appeared open | Decided (23 Sep 2026) |
| D60 | A **junction is judged on its two profiles** overlaid (the opposite one flipped and offset), not on the connection types, whose grouping tolerance (8 units) lets through seams visible up close: **exact** (within 0.5 unit; measured: 0.0 without seam, 1.0 with), **included** (one profile contained in the other; the surplus on one side, a ceiling detail or frame around a narrower corridor, is tolerated), **seam** (only at the wide tolerance, in yellow with the gap) or **incompatible** (in red). The types are still used by the assistant to suggest pieces | Decided (23 Sep 2026) |
| D61 | An **intended overlap** is marked from the editor (click on a magenta shared cell): the pair of pieces is recorded in the annotations by EditorID, with its exact relative position (corner offset and rotation of the second piece in the frame of the first, independent of the pair's orientation). Wherever this combination appears, it is no longer flagged, its placement is accepted and the assistant can suggest it. List and removal in Validation, "Accepted overlaps" tab | Decided (24 Sep 2026) |
| D62 | V1 **also creates plugins and cells** (extends the assumption "editing existing cells only"): new empty plugin (HEDR 1.71, first id 0x800, masters = Skyrim.esm + the plugins that provide catalogue pieces) in an enabled MO2 mod folder or a new mod folder (to be enabled in MO2); new minimal interior cell (EditorID, interior flag, default lighting) filed in its block / sub-block, written immediately with a backup copy. The actual lighting is set in the CK | Decided (24 Sep 2026) |
| D64 | **A bake never touches a tile that already has NavMesh triangles** (D35's test), whoever made them (the CK or the tool): complete and partial bakes skip such tiles and stitch the new triangles onto the existing ones. Replacing them needs the user's explicit confirmation; the tool then deletes every triangle of those tiles and bakes them anew. So the tool keeps no record of its own triangles (the .esp stays the only source of truth) | Decided (29 Sep 2026) |
| D65 | **NavMesh editing and Finalize in V2** (added on 30 Sep 2026): an "Edit NavMesh" mode (triangle, edge and vertex selection, NAVM list with highlight, delete, wipe a NAVM), vertex merge and triangle creation (joining two NAVMs merges them into one record, D36), and a Finalize doing door links and the `NAVI` record; cover is left for later. Done after the bake tools (step 12), before the V2 milestone | Decided (30 Sep 2026) |
| D63 | **Versions**: the planning's "V1" is release **0.1.0**, a minimal but functional and useful beta ("V1" was a working name). The project stays in beta (0.x) until **1.0.0**, the first version supporting every interior kit of Skyrim's base `.esm` files, with the deep junction check (R16), texture continuity (14b), Z levels, etc. The version is set in `package.json` only (the app reads it); a release is the tag `v<version>` | Decided (25 Sep 2026) |
| D66 | **Textures are a display option** (V3): off by default; the untextured shaded view stays the fast one | Decided (2 Oct 2026, V3 step 4) |
| D67 | **Two viewports** (V3): the top-down view, where everything is edited, and a square inset in the top right corner (a third of the screen) showing a perspective camera; the camera is drawn in the top-down view as simple shapes, moved in x, y and z and turned around z only | Proposed (1 Oct 2026) |
| D68 | **Several kits in one catalogue** (V4): every kit's pieces are analysed and offered; a piece knows its kit and a tile its kit's module; the palette filters by kit. Kits sharing a module share a cell's grid | Decided (3 Oct 2026, V4 step 4) |
| D69 | **Annotations per kit** (V4): one committed file per kit (`data/annotations/<kit>.json`), validated kit by kit | Decided (3 Oct 2026, V4 step 3) |
| D70 | **Fine grid, contextual grid** (V4, 4 Oct 2026, from the Vanilla check): the game's CELLs shift parts of a CELL by 16, 32 or 64 units from the 128 grid. Tile positions are kept at a kit's fine step (16 units in XY and Z for Imperial and Nordic) in one frame per CELL, with no "sections" (several grids per CELL, considered and set aside as too complex). The UI keeps 128 cells and levels: the grid drawn and the snapping step are 128 by default; a selected piece shows its own 128 grid through its corner (so the pieces plugged into a 16-shifted piece share its shift); dragging keeps that offset; a step selector gives 64, 32 or 16. At an open face the assistant offers every piece that fits, at the position the face imposes, whatever the shift. Pieces off the fine step (arbitrary offsets, about 2 %) and turned by other angles than 90° (caves) stay opaque. **Why**: the Vanilla check showed the game's offsets to be multiples of 16 for the most part, so one fine frame reads nearly every CELL; sections (one grid per group of pieces) would need overlaps, junctions and the bake across grids, for the same result. **How (option B)**: a tile keeps its 128 cells and gets a fractional cell index for its shift (3.125 = 16 at 128, exact in binary), rather than 16-unit cells (option A), which would multiply the cells by 512 (a small hall: 4 cells → 2,048) and slow every grid computation; tiles of the same shift share their indices and behave as before, dragging by whole cells keeps the shift | Decided (4 Oct 2026) |
| D71 | **The other objects of a cell are editable** (V5): every reference of the working plugin's cell is shown by category (furniture, containers, lights, clutter, markers, actors, doors...), and may be selected and moved with the tiles; each category can be shown, faded or hidden, and made unselectable. The masters' references stay read-only (D22). **Why**: building does not end with the tiles; moving a furnished, lit room in the tool left its contents behind for the CK, one by one, and the objects drawn over the tiles got in the way. Set aside: carrying the objects found inside moved tiles on save (hidden, surprising); leaving them to the CK (the friction met after V4). Revises D22's "everything else passes through" for the plugin's own references | Proposed (7 Oct 2026, V5) |
| D72 | **What moves with the tiles** (V5): the objects the user selected (a rectangle selects tiles and objects alike), never guessed from their position; a single object moves on its own. **Why**: an object by a wall may belong to either room; a guess would sometimes carry the wrong one, a selection is seen before the move | Proposed (7 Oct 2026, V5) |

## Settled for V1 (release 0.1.0)
The questions opened for V1 and how each was settled (24 Sep 2026, V1 released as 0.1.0, D63).

| # | Question | Outcome |
|---|---|---|
| V1 | Cell creation | **Revised by D62**: the tool also creates plugins and interior cells (planned at first: edit only cells created in the CK) |
| V2 | Doors | As recommended: doorway tiles (STAT) only; the DOOR object and teleportation stay in the CK. **Confirmed by R5**: the doorways are the `*door*` tiles of the hall/room sub-kits; the `door/` folder only contains DOOR objects |
| V3 | Rendering | As recommended: real untextured meshes, shaded, seen from above (step 12) |
| V4 | Editing | 90° rotation, undo/redo, drag to move, with snapping onto open faces (steps 13, 17). Multiple selection and group move: not done, later |
| V5 | Saving | Explicit Save button (Ctrl+S), no autosave; CK warning on the first save; timestamped backup; refused if the file changed on disk (D47, step 15) |
| V6 | ESL plugins | Refused with a clear message (restricted FormID range). Implemented in `Plugin.parse` |
| V7 | Mesh analysis prototyping | R3/R5 in Python, then TypeScript port once the algorithm was proven. pynifly cannot be installed outside Blender; in-house BSA and NIF readers in Python (`tools/bsa.py`, `tools/nif.py`) served as the reference for the port (step 9) |
| V8 | Catalogue validation tool | A page of the same SPA (Settings, Validation; step 10) |
| V9 | Key of the distributed annotations | EditorID: pieces by EditorID, types designated by an `EditorID:dir` face; types are never named by hand (internal, never shown to the designer) |
| V10 | Grid anchoring in an existing cell | Best fit on the recognized tiles; world origin for an empty cell. Implemented and validated by R10 (`deriveGrid`) |
| V11 | Tech stack | TypeScript + Vite + Svelte 5 (runes) + three.js. No SvelteKit; editor scene in imperative three.js outside the framework |
| V12 | Hosting | Three ways, no server needed: a single self-contained HTML file attached to each GitHub release, a minimal nginx Docker image (GHCR), or the dev server. GitHub Pages remains possible |
| V13 | License, repository, project name | GNU GPL v3; `github.com/dickeyf/SkyrimDungeonPlanner`; Skyrim Dungeon Planner |
| V14 | V1 success criterion | "Imperial dungeon of 30 tiles on one Z in under 10 minutes, opened in the CK with no error and no visible gap": **met** at step 16 ("very fast; limited, but fast, faster than with the CK") |

Still "Proposed" above, for later phases: D15 (props, phase 5) and D38 (obstacles in the bake).

Settled in V2: the tool keeps no list of the NAVMs or triangles it made (D64); the lock lives in
the browser (D37).

## Open questions
- **MO2**: settled by D50 (the tool rebuilds the MO2 overlay from `modlist.txt`, validated by
  R15).
- **Non-Chromium browsers**: settled by D48 (Chromium only; a degraded import/export mode maybe
  later).
- **Custom pieces**: should extraction run on the custom NIFs of the working mod (custom Imperial
  free-standing walls)? Probably yes as soon as props arrive (phase 5).
