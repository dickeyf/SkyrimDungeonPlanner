"""
Shared mesh-analysis primitives for the kit scripts (R5 module/pivots, R3 face signatures).

Everything works in "piece space": the NIF file's coordinate frame, whose origin is the
piece pivot. Vertices are welded by position so that UV/normal seams do not create fake
open edges.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

import numpy as np

from nif import NifFile

PLANE_TOL = 1.0  # vertex-to-plane distance counted as "on the plane"
EDGE_TOL = 6.0  # how far inside the bounding box an opening plane may sit (overhangs are <= 5)
GRID_TOL = 4.0  # alignment tolerance to a grid line
MIN_OPEN_VERTS = 20
MIN_OPEN_HEIGHT = 200.0  # closed sides only carry ~100 units of trim; openings ~300
MIN_RIM_SHARE = 0.1  # measured: walls 0.00, openings 0.23..1.00 (decor lowers the share)
MIN_OPEN_WIDTH = 64.0  # narrower rims are wall ends or props, not passages
WELD_QUANTUM = 0.1  # vertices closer than this (per axis) are the same point


@dataclass
class Opening:
    dir: str  # +X, -X, +Y, -Y
    plane: float
    span_min: float  # extent along the other horizontal axis, at floor level
    span_max: float
    z_min: float
    z_max: float
    verts: int
    centre: float = 0.0
    width: float = 0.0
    level: float = 0.0  # floor rise above piece floor, in z-modules

    def __post_init__(self) -> None:
        self.centre = round((self.span_min + self.span_max) / 2, 1)
        self.width = round(self.span_max - self.span_min, 1)

    @property
    def axis(self) -> int:
        return 0 if self.dir[1] == "X" else 1

    @property
    def other(self) -> int:
        return 1 - self.axis

    @property
    def sign(self) -> int:
        return 1 if self.dir[0] == "+" else -1


@dataclass
class Geometry:
    """A piece's rendered geometry, welded."""

    v: np.ndarray  # (n, 3) all vertices, piece space
    tris: np.ndarray  # (m, 3) indices into v
    weld: np.ndarray  # (n,) welded vertex id per vertex
    positions: np.ndarray  # (w, 3) one position per welded id
    open_edges: np.ndarray  # (k, 2) welded ids of edges used by a single triangle
    rim: np.ndarray  # (n,) bool: vertex lies on an open edge
    shape_of: np.ndarray  # (n,) index into `shapes` per vertex
    shapes: list[str]  # shape names, in order
    shape_alpha: list[bool]  # shape has an alpha property (decal-like)

    @property
    def bmin(self) -> np.ndarray:
        return self.v.min(0)

    @property
    def bmax(self) -> np.ndarray:
        return self.v.max(0)


def load_geometry(nif: NifFile, skip_alpha: bool = False) -> Geometry:
    """Merge all shapes. `skip_alpha` drops shapes with an alpha property (decals) so that
    piece-specific grime does not pollute structural analysis."""
    verts, tris, base = [], [], 0
    shape_of, names, alphas = [], [], []
    for shape in nif.shapes():
        if not len(shape.block.vertices):
            continue
        has_alpha = shape.block.alpha_property != -1
        if skip_alpha and has_alpha:
            continue
        verts.append(shape.world_vertices)
        tris.append(shape.block.triangles.astype(np.int64) + base)
        shape_of.append(np.full(len(shape.block.vertices), len(names)))
        names.append(shape.block.name)
        alphas.append(has_alpha)
        base += len(shape.block.vertices)
    v = np.vstack(verts)
    t = np.vstack(tris)

    keys = np.round(v / WELD_QUANTUM).astype(np.int64)
    _, first, weld = np.unique(keys, axis=0, return_index=True, return_inverse=True)
    weld = weld.reshape(-1)
    positions = v[first]

    wt = weld[t]
    edges = np.concatenate([wt[:, [0, 1]], wt[:, [1, 2]], wt[:, [2, 0]]])
    edges.sort(axis=1)
    uniq, counts = np.unique(edges, axis=0, return_counts=True)
    open_edges = uniq[counts == 1]
    open_welded = np.zeros(len(positions), dtype=bool)
    open_welded[open_edges.reshape(-1)] = True
    return Geometry(v, t, weld, positions, open_edges, open_welded[weld], np.concatenate(shape_of), names, alphas)


def find_openings(g: Geometry) -> list[Opening]:
    """Openings on the bounding-box sides. See r5_module_pivots.py for the heuristics."""
    v, rim, bmin, bmax = g.v, g.rim, g.bmin, g.bmax
    out: list[Opening] = []
    for axis, label in ((0, "X"), (1, "Y")):
        other = 1 - axis
        for sign, edge in (("-", bmin[axis]), ("+", bmax[axis])):
            near = v[np.abs(v[:, axis] - edge) <= EDGE_TOL]
            if len(near) < MIN_OPEN_VERTS:
                continue
            # Candidate planes near the edge (coordinates quantised to 0.5), nearest to the
            # edge first: decorative planes just inside an opening can be denser than its rim.
            counts = Counter(np.round(near[:, axis] * 2) / 2)
            chosen = None
            for plane, count in sorted(counts.items(), key=lambda pc: abs(pc[0] - edge)):
                if count < MIN_OPEN_VERTS:
                    continue
                on_plane_mask = np.abs(v[:, axis] - plane) < PLANE_TOL
                on_plane = v[on_plane_mask]
                z_min, z_max = float(on_plane[:, 2].min()), float(on_plane[:, 2].max())
                if z_max - z_min < MIN_OPEN_HEIGHT:
                    continue  # trim near the ceiling: closed side
                # An opening is the rim where floor, walls and ceiling stop: its vertices sit
                # on open edges. A rendered wall in the plane has interior (shared) edges.
                rim_verts = int(rim[on_plane_mask].sum())
                if rim_verts < MIN_OPEN_VERTS or rim_verts / len(on_plane) < MIN_RIM_SHARE:
                    continue
                chosen = (float(plane), on_plane, z_min, z_max)
                break
            if chosen is None:
                continue
            plane, on_plane, z_min, z_max = chosen
            low = on_plane[on_plane[:, 2] < z_min + 60]
            if np.ptp(low[:, other]) < MIN_OPEN_WIDTH:
                continue
            out.append(
                Opening(
                    dir=f"{sign}{label}",
                    plane=float(plane),
                    span_min=round(float(low[:, other].min()), 1),
                    span_max=round(float(low[:, other].max()), 1),
                    z_min=round(z_min, 1),
                    z_max=round(z_max, 1),
                    verts=int(len(on_plane)),
                )
            )
    return out


def grid_phase(planes: list[float], edges: tuple[float, float], module: float) -> tuple[float, bool]:
    """Offset of the grid lines relative to the piece origin, in [0, module), and whether all
    given planes agree on it."""
    if not planes:
        return 0.0, True
    phase = planes[0] % module
    ok = all(abs(((p - phase + module / 2) % module) - module / 2) <= GRID_TOL for p in planes)
    if abs(phase) <= GRID_TOL or abs(phase - module) <= GRID_TOL:
        phase = 0.0
    return phase, ok


def overlapped_cells(lo: float, hi: float, module: float) -> list[int]:
    """Cells [c*module, (c+1)*module) overlapped by [lo, hi] by more than a quarter module."""
    first = int(np.floor(lo / module))
    last = int(np.floor((hi - 1e-6) / module))
    cells = []
    for c in range(first, last + 1):
        overlap = min(hi, (c + 1) * module) - max(lo, c * module)
        if overlap > module / 4:
            cells.append(c)
    return cells or [first]
