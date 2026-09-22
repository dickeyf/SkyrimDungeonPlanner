"""
R3 - face signatures from open mesh edges.

Hypothesis: two faces that mate share the same junction geometry, i.e. the open edges of
their meshes (edges used by a single triangle) that lie on the junction plane coincide.

For every opening found by the R5 heuristics (`kit_geometry.find_openings`):
  * collect the open edges lying on the opening plane;
  * express them in face-local 2D coordinates (u, v):
      - u runs along the face as seen from OUTSIDE the piece, to the viewer's right
        (+X face: u = +Y, -X: u = -Y, +Y: u = -X, -Y: u = +X), with origin at the centre of
        the grid cells the opening covers, so the profile is independent of where the
        opening sits on the piece and of the piece's rotation;
      - v = z minus the opening's Z level (level = round(z_floor / z_module)), so a raised
        exit has the same profile as a ground one (D55: the floor offset inside the level is
        part of the profile);
  * drop alpha-blended shapes (grime decals differ per piece) and keep only the main
    connected components of the open edges (small decorative loops lying in the plane are
    not junction geometry);
  * merge collinear chains into polylines and quantise to 0.5 units;
  * compare profiles pairwise with a tolerance (share of sampled points of A within TOL of
    a segment of B, and vice versa), also against the mirror image (u -> -u): two faces that
    look at each other see the same world geometry mirrored, so `mate` = mirror group.

Three tiers: exact (score >= EXACT) -> same connection type; near (NEAR <= score < EXACT)
-> listed for human validation; otherwise distinct.

    python tools/r3_face_signatures.py --subkit smallhall --subkit smallroom
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from kit_geometry import PLANE_TOL, Opening, find_openings, grid_phase, load_geometry, overlapped_cells
from nif import NifFile

QUANTUM = 0.5  # profile coordinate quantum
SAMPLE_STEP = 2.0  # spacing of sample points along segments
MATCH_TOL = 8.0  # sample-to-segment distance counted as a hit (jambs differ by up to 6 units between the two sides a kit author modelled)
MIN_COMPONENT_SHARE = 0.25  # keep open-edge components at least this long relative to the longest
EXACT = 0.97
NEAR = 0.80
COARSE_TOL = 12.0  # width/height/v_min difference beyond which no fine comparison is done

U_SIGN = {"+X": 1.0, "-X": -1.0, "+Y": -1.0, "-Y": 1.0}


@dataclass
class Face:
    piece: str
    subkit: str
    opening: Opening
    cells: list[int]  # cells covered along the face, in the phased grid
    level: int
    u0: float
    segments: np.ndarray  # (k, 4): u1 v1 u2 v2
    group: int = -1

    @property
    def key(self) -> str:
        return f"{self.piece}:{self.opening.dir}"

    @property
    def width(self) -> float:
        return float(np.ptp(np.concatenate([self.segments[:, 0], self.segments[:, 2]])))

    @property
    def height(self) -> float:
        return float(np.ptp(np.concatenate([self.segments[:, 1], self.segments[:, 3]])))

    @property
    def v_min(self) -> float:
        return float(min(self.segments[:, 1].min(), self.segments[:, 3].min()))

    @property
    def total_length(self) -> float:
        d = self.segments[:, 2:] - self.segments[:, :2]
        return float(np.hypot(d[:, 0], d[:, 1]).sum())


# -- profile extraction ------------------------------------------------------------------


def extract_faces(path: Path, subkit: str, module: float, z_module: float) -> list[Face]:
    g = load_geometry(NifFile(path), skip_alpha=True)
    openings = find_openings(g)
    phases = []
    for axis, label in ((0, "X"), (1, "Y")):
        planes = [o.plane for o in openings if o.dir[1] == label]
        phases.append(grid_phase(planes, (g.bmin[axis], g.bmax[axis]), module)[0])

    faces: list[Face] = []
    pos = g.positions
    for o in openings:
        on_plane = np.abs(pos[:, o.axis] - o.plane) < PLANE_TOL
        edges = g.open_edges[on_plane[g.open_edges].all(axis=1)]
        edges = main_components(edges, pos)
        if not len(edges):
            continue
        phase = phases[o.other]
        cells = overlapped_cells(o.span_min - phase, o.span_max - phase, module)
        u0 = phase + (cells[0] + cells[-1] + 1) / 2 * module
        level = int(round(o.z_min / z_module))
        s = U_SIGN[o.dir]
        a, b = pos[edges[:, 0]], pos[edges[:, 1]]
        seg = np.stack(
            [s * (a[:, o.other] - u0), a[:, 2] - level * z_module, s * (b[:, o.other] - u0), b[:, 2] - level * z_module],
            axis=1,
        )
        seg = np.round(seg / QUANTUM) * QUANTUM
        seg = seg[~((seg[:, 0] == seg[:, 2]) & (seg[:, 1] == seg[:, 3]))]  # drop degenerate
        faces.append(Face(path.stem, subkit, o, cells, level, u0, merge_collinear(seg)))
    return faces


def main_components(edges: np.ndarray, pos: np.ndarray) -> np.ndarray:
    """Keep the connected components of the edge graph whose total length is at least
    MIN_COMPONENT_SHARE of the longest one. Drops decorative loops lying in the plane
    (medallions, trim ends) that are not part of the junction contour."""
    if not len(edges):
        return edges
    parent: dict[int, int] = {}

    def find(x: int) -> int:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in edges:
        parent[find(int(a))] = find(int(b))
    length = np.linalg.norm(pos[edges[:, 0]] - pos[edges[:, 1]], axis=1)
    comp = np.array([find(int(a)) for a in edges[:, 0]])
    total = defaultdict(float)
    for c, l in zip(comp, length):
        total[c] += l
    keep = {c for c, l in total.items() if l >= MIN_COMPONENT_SHARE * max(total.values())}
    return edges[np.isin(comp, list(keep))]


def merge_collinear(seg: np.ndarray) -> np.ndarray:
    """Merge chains of collinear segments meeting at degree-2 points into single segments."""
    segs = [tuple(map(float, r)) for r in seg]
    changed = True
    while changed:
        changed = False
        by_point: dict[tuple[float, float], list[int]] = defaultdict(list)
        for i, (u1, v1, u2, v2) in enumerate(segs):
            by_point[(u1, v1)].append(i)
            by_point[(u2, v2)].append(i)
        for pt, idx in by_point.items():
            if len(idx) != 2:
                continue
            i, j = idx
            si, sj = segs[i], segs[j]
            oi = other_end(si, pt)
            oj = other_end(sj, pt)
            d1 = (pt[0] - oi[0], pt[1] - oi[1])
            d2 = (oj[0] - pt[0], oj[1] - pt[1])
            cross = d1[0] * d2[1] - d1[1] * d2[0]
            dot = d1[0] * d2[0] + d1[1] * d2[1]
            if abs(cross) <= 1e-6 and dot > 0:
                merged = (oi[0], oi[1], oj[0], oj[1])
                for k in sorted((i, j), reverse=True):
                    segs.pop(k)
                segs.append(merged)
                changed = True
                break
    out = np.array(segs, dtype=float).reshape(-1, 4)
    # canonical endpoint order for stable output
    flip = (out[:, 0] > out[:, 2]) | ((out[:, 0] == out[:, 2]) & (out[:, 1] > out[:, 3]))
    out[flip] = out[flip][:, [2, 3, 0, 1]]
    return out[np.lexsort((out[:, 3], out[:, 2], out[:, 1], out[:, 0]))]


def other_end(s: tuple[float, float, float, float], pt: tuple[float, float]) -> tuple[float, float]:
    return (s[2], s[3]) if (s[0], s[1]) == pt else (s[0], s[1])


# -- comparison ---------------------------------------------------------------------------


def sample(seg: np.ndarray) -> np.ndarray:
    pts = []
    for u1, v1, u2, v2 in seg:
        n = max(2, int(np.ceil(np.hypot(u2 - u1, v2 - v1) / SAMPLE_STEP)) + 1)
        t = np.linspace(0, 1, n)
        pts.append(np.stack([u1 + t * (u2 - u1), v1 + t * (v2 - v1)], axis=1))
    return np.vstack(pts)


def coverage(points: np.ndarray, seg: np.ndarray) -> float:
    """Share of points within MATCH_TOL of some segment."""
    a = seg[:, :2][None, :, :]
    d = (seg[:, 2:] - seg[:, :2])[None, :, :]
    p = points[:, None, :]
    dd = (d * d).sum(-1)
    t = np.clip(((p - a) * d).sum(-1) / np.where(dd == 0, 1, dd), 0, 1)
    closest = a + t[..., None] * d
    dist = np.linalg.norm(p - closest, axis=-1).min(axis=1)
    return float((dist <= MATCH_TOL).mean())


def mirror(seg: np.ndarray) -> np.ndarray:
    m = seg.copy()
    m[:, 0] = -seg[:, 2]
    m[:, 2] = -seg[:, 0]
    m[:, 1] = seg[:, 3]
    m[:, 3] = seg[:, 1]
    return m


class Profiles:
    """Caches sampled points so every face is sampled once (plus once mirrored)."""

    def __init__(self, faces: list[Face]) -> None:
        self.faces = faces
        self.pts = [sample(f.segments) for f in faces]
        self.mseg = [mirror(f.segments) for f in faces]
        self.mpts = [sample(m) for m in self.mseg]

    def coarse_ok(self, i: int, j: int) -> bool:
        a, b = self.faces[i], self.faces[j]
        return (
            abs(a.width - b.width) <= COARSE_TOL
            and abs(a.height - b.height) <= COARSE_TOL
            and abs(a.v_min - b.v_min) <= COARSE_TOL
        )

    def score(self, i: int, j: int, mirrored: bool = False) -> float:
        if not self.coarse_ok(i, j):
            return 0.0
        segj = self.mseg[j] if mirrored else self.faces[j].segments
        ptsj = self.mpts[j] if mirrored else self.pts[j]
        return min(coverage(self.pts[i], segj), coverage(ptsj, self.faces[i].segments))


def group_faces(p: Profiles) -> tuple[list[list[int]], list[tuple[int, int, float]]]:
    n = len(p.faces)
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    near: list[tuple[int, int, float]] = []
    for i in range(n):
        for j in range(i + 1, n):
            s = p.score(i, j)
            if s >= EXACT:
                parent[find(i)] = find(j)
            elif s >= NEAR:
                near.append((i, j, s))
    groups: dict[int, list[int]] = defaultdict(list)
    for i in range(n):
        groups[find(i)].append(i)
    ordered = sorted(groups.values(), key=lambda g: (-len(g), p.faces[g[0]].key))
    for gid, members in enumerate(ordered):
        for i in members:
            p.faces[i].group = gid
    # near matches across different groups only
    near = [(i, j, s) for i, j, s in near if p.faces[i].group != p.faces[j].group]
    return ordered, near


def mates(p: Profiles, groups: list[list[int]]) -> dict[int, int | None]:
    """For each group, the group its mirror image matches (itself when symmetric)."""
    out: dict[int, int | None] = {}
    reps = [g[0] for g in groups]
    for gi, ri in enumerate(reps):
        out[gi] = None
        for gj, rj in enumerate(reps):
            if p.score(ri, rj, mirrored=True) >= EXACT:
                out[gi] = gj
                break
    return out


# -- report -------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--nif-dir", type=Path, default=Path(__file__).parent / "out" / "nif")
    parser.add_argument("--kit", default="meshes/dungeons/imperial")
    parser.add_argument("--subkit", action="append", default=None, help="repeatable; default smallhall")
    parser.add_argument("--module", type=float, default=128.0)
    parser.add_argument("--z-module", type=float, default=128.0)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args(argv)
    subkits = args.subkit or ["smallhall"]

    faces: list[Face] = []
    for subkit in subkits:
        folder = args.nif_dir / Path(args.kit) / subkit
        files = sorted(folder.glob("*.nif"))
        if not files:
            print(f"no .nif under {folder}; run bsa_extract.py first", file=sys.stderr)
            return 2
        for f in files:
            faces.extend(extract_faces(f, subkit, args.module, args.z_module))

    p = Profiles(faces)
    groups, near = group_faces(p)
    mate_of = mates(p, groups)

    print(f"{len(faces)} faces from {len({f.piece for f in faces})} pieces in {', '.join(subkits)}\n")
    print(f"{'grp':>3} {'faces':>5} {'width':>6} {'height':>6} {'v_min':>6} {'segs':>4} {'mate':>5}  members (piece:dir), subkits")
    for gid, members in enumerate(groups):
        f0 = faces[members[0]]
        m = mate_of[gid]
        mate = "self" if m == gid else (f"G{m}" if m is not None else "none")
        subs = sorted({faces[i].subkit for i in members})
        names = " ".join(f"{faces[i].piece.replace('imp', '', 1)}:{faces[i].opening.dir}" for i in members[:6])
        more = f" (+{len(members) - 6})" if len(members) > 6 else ""
        print(f"G{gid:<2} {len(members):>5} {f0.width:>6.0f} {f0.height:>6.0f} {f0.v_min:>6.0f} {len(f0.segments):>4} {mate:>5}  {names}{more}  [{','.join(subs)}]")

    print("\nnear matches (for human validation):")
    if not near:
        print("  none")
    for i, j, s in sorted(near, key=lambda t: -t[2]):
        print(f"  {s:.3f}  {faces[i].key}  ~  {faces[j].key}  (G{faces[i].group} vs G{faces[j].group})")

    print("\nper piece:")
    by_piece: dict[str, list[Face]] = defaultdict(list)
    for f in faces:
        by_piece[f.piece].append(f)
    for piece, fs in sorted(by_piece.items()):
        print(f"  {piece:<28} " + "  ".join(f"{f.opening.dir}:G{f.group}(L{f.level},c{f.cells[0]}..{f.cells[-1]})" for f in fs))

    out = args.out or Path(__file__).parent / "out" / f"r3-{'-'.join(subkits)}-{args.module:g}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "module": args.module,
                "z_module": args.z_module,
                "groups": [
                    {"id": gid, "mate": mate_of[gid], "faces": [faces[i].key for i in members]}
                    for gid, members in enumerate(groups)
                ],
                "faces": [
                    {
                        "piece": f.piece,
                        "subkit": f.subkit,
                        "dir": f.opening.dir,
                        "plane": f.opening.plane,
                        "cells": f.cells,
                        "level": f.level,
                        "u0": f.u0,
                        "group": f.group,
                        "segments": f.segments.tolist(),
                    }
                    for f in faces
                ],
                "near": [[faces[i].key, faces[j].key, round(s, 3)] for i, j, s in near],
            },
            indent=1,
        )
    )
    print(f"\nreport: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
