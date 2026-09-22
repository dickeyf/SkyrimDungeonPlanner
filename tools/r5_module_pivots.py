"""
R5 - measure the grid module and per-piece pivot/cells of a kit from its meshes.

For every NIF under the chosen folder:
  * bounding box of all rendered vertices (file space, i.e. relative to the piece pivot);
  * openings: at each bounding-box edge, the nearest well-populated vertical plane; it is
    an opening when its vertices span from floor to ceiling (a closed side only carries
    trim near the ceiling) and most of them lie on open mesh edges (a rendered wall in
    the plane has shared edges instead). Floor level = lowest opening vertex;
  * grid phase per axis: openings must sit on grid lines, so the phase is taken from them
    (from the bounding-box edges when an axis has no opening). A piece whose openings
    disagree modulo `--module` does not fit that module and is flagged;
  * cells: grid cells (of `--module` units, in the phased frame) overlapped by the bounding
    box by more than a quarter module, so cornice overhangs do not add cells;
  * pivot: NIF origin relative to the min corner of the occupied cells;
  * Z: each opening's floor rise above the piece floor, in `--z-module` units, rounded to a
    level; flagged when the rise is near half a module (ambiguous level).

    python tools/r5_module_pivots.py --subkit smallhall
    python tools/r5_module_pivots.py --subkit smallhall --module 64 --z-module 64
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from kit_geometry import GRID_TOL, Opening, find_openings, grid_phase, load_geometry, overlapped_cells
from nif import NifFile

@dataclass
class PieceReport:
    file: str
    vertices: int
    bbox_min: list[float]
    bbox_max: list[float]
    size: list[float]
    floor_z: float | None
    phase: list[float]
    openings: list[dict]
    cells: list[list[int]]
    pivot: list[float]
    fits: bool
    notes: list[str]


def analyse(path: Path, module: float, z_module: float) -> PieceReport:
    g = load_geometry(NifFile(path))
    notes: list[str] = []
    bmin, bmax = g.bmin, g.bmax

    openings = find_openings(g)
    floor_z = min(o.z_min for o in openings) if openings else None
    if floor_z is None:
        notes.append("no opening detected")

    phase: list[float] = []
    cells_per_axis: list[list[int]] = []
    for axis, label in ((0, "X"), (1, "Y")):
        planes = [o.plane for o in openings if o.dir[1] == label]
        ph, ok = grid_phase(planes, (bmin[axis], bmax[axis]), module)
        if not ok:
            notes.append(f"{label} openings at {sorted(set(planes))} not on a {module:g} grid")
        phase.append(ph)
        cells_per_axis.append(overlapped_cells(bmin[axis] - ph, bmax[axis] - ph, module))

    # An opening's floor may sit anywhere inside its Z cell (that offset is part of the
    # connection profile, e.g. a large-room door frame 42 units above the room floor); only
    # a rise near half a module makes the level ambiguous.
    levels: list[int] = [0]
    for o in openings:
        rise = (o.z_min - floor_z) / z_module
        o.level = round(rise, 2)
        if abs(rise - round(rise)) > 1 / 3:
            notes.append(f"{o.dir} opening rise {o.z_min - floor_z:g} is an ambiguous level for z-module {z_module:g}")
        levels.append(int(round(rise)))

    cells = [
        [i, j, k]
        for i in cells_per_axis[0]
        for j in cells_per_axis[1]
        for k in range(min(levels), max(levels) + 1)
    ]
    pivot = [
        -(phase[0] + cells_per_axis[0][0] * module),
        -(phase[1] + cells_per_axis[1][0] * module),
        -(floor_z or 0.0),
    ]

    return PieceReport(
        file=path.name,
        vertices=int(len(g.v)),
        bbox_min=rounded(bmin),
        bbox_max=rounded(bmax),
        size=rounded(bmax - bmin),
        floor_z=None if floor_z is None else round(float(floor_z), 1),
        phase=[round(p, 1) for p in phase],
        openings=[asdict(o) for o in openings],
        cells=cells,
        pivot=rounded(np.array(pivot)),
        fits=not notes,
        notes=notes,
    )


def rounded(a: np.ndarray) -> list[float]:
    return [round(float(x), 1) for x in a]


def alignment(values: list[float], step: float) -> str:
    if not values:
        return "n/a"
    hits = sum(1 for x in values if abs(x - round(x / step) * step) <= GRID_TOL)
    return f"{hits}/{len(values)}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--nif-dir", type=Path, default=Path(__file__).parent / "out" / "nif")
    parser.add_argument("--kit", default="meshes/dungeons/imperial")
    parser.add_argument("--subkit", default="smallhall")
    parser.add_argument("--module", type=float, default=128.0, help="XY grid module in units")
    parser.add_argument("--z-module", type=float, default=128.0, help="Z grid module in units")
    parser.add_argument("--out", type=Path, default=None, help="JSON report (default: tools/out/r5-<subkit>-<module>.json)")
    args = parser.parse_args(argv)

    folder = args.nif_dir / Path(args.kit) / args.subkit
    files = sorted(folder.glob("*.nif"))
    if not files:
        print(f"no .nif under {folder}; run bsa_extract.py first", file=sys.stderr)
        return 2

    reports = [analyse(f, args.module, args.z_module) for f in files]

    print(f"module {args.module:g} / z {args.z_module:g}\n")
    print(f"{'piece':<26} {'size':<13} {'floor':>6} {'phase':>8} {'cells':<7} {'pivot':<14} openings (dir@centre w=width z=floor L=level)")
    for r in reports:
        size = "x".join(f"{s:.0f}" for s in r.size)
        nx = len({c[0] for c in r.cells})
        ny = len({c[1] for c in r.cells})
        nz = len({c[2] for c in r.cells})
        pivot = ",".join(f"{p:.0f}" for p in r.pivot)
        phase = ",".join(f"{p:.0f}" for p in r.phase)
        ops = "  ".join(f"{o['dir']}@{o['centre']:+.0f} w{o['width']:.0f} z{o['z_min']:.0f} L{o['level']:g}" for o in r.openings)
        flag = "" if r.fits else "  !! " + "; ".join(r.notes)
        floor = f"{r.floor_z:.1f}" if r.floor_z is not None else "-"
        print(f"{r.file:<26} {size:<13} {floor:>6} {phase:>8} {nx}x{ny}x{nz:<3} {pivot:<14} {ops}{flag}")

    edges = [e for r in reports for e in (r.bbox_min[0], r.bbox_max[0], r.bbox_min[1], r.bbox_max[1])]
    planes = [o["plane"] for r in reports for o in r.openings]
    centres = [o["centre"] for r in reports for o in r.openings]
    widths = Counter(round(o["width"]) for r in reports for o in r.openings)
    heights = Counter(round(o["z_max"] - o["z_min"]) for r in reports for o in r.openings)
    floor_zs = Counter(r.floor_z for r in reports)
    rises = Counter(round(o["z_min"] - r.floor_z) for r in reports if r.floor_z is not None for o in r.openings)
    print()
    print(f"pieces fitting module {args.module:g}: {sum(r.fits for r in reports)}/{len(reports)}")
    print("bbox edges on grid     256:", alignment(edges, 256), " 128:", alignment(edges, 128), " 64:", alignment(edges, 64))
    print("opening planes on grid 256:", alignment(planes, 256), " 128:", alignment(planes, 128), " 64:", alignment(planes, 64))
    print("opening centres on grid256:", alignment(centres, 256), " 128:", alignment(centres, 128), " 64:", alignment(centres, 64))
    print("opening widths:", dict(widths.most_common()))
    print("opening heights:", dict(heights.most_common()))
    print("floor z (pivot to floor):", dict(floor_zs.most_common()))
    print("opening rise above floor:", dict(rises.most_common()))

    out = args.out or Path(__file__).parent / "out" / f"r5-{args.subkit}-{args.module:g}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"module": args.module, "z_module": args.z_module, "pieces": [asdict(r) for r in reports]}, indent=2))
    print(f"\nreport: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
