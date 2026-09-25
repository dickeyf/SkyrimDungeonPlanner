# Analysis scripts (Python)

Throwaway scripts for the mesh-analysis proofs of concept R5 and R3 (`docs/design/planning/03-risks.md`).
The algorithms are prototyped here first, then ported to TypeScript once proven (V7).
`pynifly` is not on PyPI (it is a Blender add-on with a native DLL), so the NIF reading is
done by `nif.py`, a small reader limited to what the analyses need (node tree, BSTriShape
vertices and triangles). Like `bsa.py`, it is the reference for the TypeScript port.

```powershell
cd tools
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Extracting meshes from the game archives

`bsa_extract.py` reads the BSA v105 archives directly (no external tool). The game root is
found from the registry / Steam library folders, or passed with `--game`.

```powershell
python tools/bsa_extract.py --list --filter meshes/dungeons/imperial/ --suffix .nif
python tools/bsa_extract.py --filter meshes/dungeons/imperial/ --suffix .nif --out tools/out/nif
```

The Imperial kit is 435 `.nif` files across `Skyrim - Meshes0.bsa` and `Skyrim - Meshes1.bsa`,
extracted in well under a second. Everything under `tools/out/` is git-ignored. The reader
lives in `bsa.py` and is the reference for the TypeScript port (`src/lib/format/bsa`, R14b).

| Script                  | Risk | Produces                                                                                  |
| ----------------------- | ---- | ----------------------------------------------------------------------------------------- |
| `r5_module_pivots.py`   | R5   | Per-piece bounds, openings, grid phase, cells and pivot for a given module; fit summary.  |
| `r3_face_signatures.py` | R3   | Open-edge polylines per face plane, grouped with tolerance and mirror; near-match list.   |
| `kit_geometry.py`       | —    | Shared: welded geometry, open edges, opening detection, grid phase and cells.             |
| `make_fixtures.py`      | —    | Writes `src/lib/testdata/fixtures.ts`: tiny synthetic NIF, BSA and LZ4 frames for Vitest. |

```powershell
python tools/r5_module_pivots.py --subkit smallhall --module 128 --z-module 128
python tools/r5_module_pivots.py --subkit smallhall --module 64 --z-module 64
```

Reports land in `tools/out/r5-<subkit>-<module>.json`. Run it for each of `smallhall`,
`largehall`, `smallroom`, `largeroom` (and `door`, which only contains props).

```powershell
python tools/r3_face_signatures.py --subkit smallhall --subkit largehall --subkit smallroom --subkit largeroom
```

Prints the connection-type groups (with their mirror mate), the near matches for human
validation and each piece's faces; writes `tools/out/r3-<subkits>-<module>.json` with the
profile polylines.
