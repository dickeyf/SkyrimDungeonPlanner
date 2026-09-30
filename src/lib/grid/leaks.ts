/**
 * Deep junction check, exact part (R16, V2 step 5): gaps between two placed pieces that the face
 * profiles cannot see, such as a door frame or a floor that stops a little short of the other
 * piece.
 *
 * Around the junction plane, every free border of each mesh (an edge used by one triangle only)
 * running along the plane is sampled; a sample farther than `threshold` from the other piece's surface is part of a
 * candidate gap, whose width is that distance. Deterministic: no thin gap slips between two
 * samples. Whether a candidate is visible from where the player stands is decided separately
 * (the render test), since kits often hide joints behind overlaps.
 */
import type { CellIndex, ConnectionType, FaceDir, FormKey, Vec3 } from '../catalogue/types';
import type { WeldedGeometry } from '../mesh/geometry';
import { jointsOfTile, type Joint } from './assist';
import { tileWorldPlacement, type Layout, type Pieces } from './edit';
import type { GridAnchor } from './types';

/** A welded mesh placed in the world. */
export interface WorldMesh {
  positions: Float64Array;
  triangles: Uint32Array;
  openEdges: Uint32Array;
}

/**
 * Place a piece mesh: turned by Skyrim's Z angle (a clockwise heading, radians) about its
 * origin, then moved to `pos`. Tiles only turn about Z.
 */
export function placeMesh(g: WeldedGeometry, pos: Vec3, heading: number): WorldMesh {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const positions = new Float64Array(g.positions.length);
  for (let i = 0; i < g.positions.length; i += 3) {
    const x = g.positions[i]!;
    const y = g.positions[i + 1]!;
    positions[i] = x * c + y * s + pos[0];
    positions[i + 1] = -x * s + y * c + pos[1];
    positions[i + 2] = g.positions[i + 2]! + pos[2];
  }
  return { positions, triangles: g.triangles, openEdges: g.openEdges };
}

/** Several placed meshes as one (the tiles facing an opening together). */
export function mergeWorldMeshes(meshes: readonly WorldMesh[]): WorldMesh {
  const positions = new Float64Array(meshes.reduce((n, m) => n + m.positions.length, 0));
  const triangles = new Uint32Array(meshes.reduce((n, m) => n + m.triangles.length, 0));
  const openEdges = new Uint32Array(meshes.reduce((n, m) => n + m.openEdges.length, 0));
  let p = 0;
  let t = 0;
  let e = 0;
  for (const m of meshes) {
    const base = p / 3;
    positions.set(m.positions, p);
    for (let i = 0; i < m.triangles.length; i++) triangles[t + i] = m.triangles[i]! + base;
    for (let i = 0; i < m.openEdges.length; i++) openEdges[e + i] = m.openEdges[i]! + base;
    p += m.positions.length;
    t += m.triangles.length;
    e += m.openEdges.length;
  }
  return { positions, triangles, openEdges };
}

/** The junction: a vertical plane `axis = plane` and the opening's extent on it. */
export interface JunctionFrame {
  /** 0: the plane is x = plane, 1: y = plane. */
  axis: 0 | 1;
  plane: number;
  /** Extent along the other horizontal axis. */
  uMin: number;
  uMax: number;
  zMin: number;
  zMax: number;
}

export interface GapOptions {
  /** Largest distance that does not count as a gap (units). */
  threshold: number;
  /**
   * How far from the plane (and beyond the opening's extent) borders are examined: a piece
   * stopping short of the junction leaves its border a few units behind the plane.
   */
  reach: number;
  /** Sample spacing along the borders. */
  spacing: number;
}

export const DEFAULT_GAP_OPTIONS: GapOptions = { threshold: 0.5, reach: 8, spacing: 1 };

export interface Gap {
  /** Which piece the free border belongs to. */
  side: 'a' | 'b';
  /** Gap samples, in order along the border runs. */
  points: Vec3[];
  /** Widest distance to the other piece (units). */
  width: number;
  /** Centre of the samples. */
  centre: Vec3;
}

export interface GapResult {
  gaps: Gap[];
  /** Border samples examined. */
  samples: number;
}

interface Tri {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  min: Vec3;
  max: Vec3;
}

const vertex = (m: WorldMesh, i: number): Vec3 => [
  m.positions[i * 3]!,
  m.positions[i * 3 + 1]!,
  m.positions[i * 3 + 2]!,
];

function nearFrame(p: Vec3, f: JunctionFrame, reach: number): boolean {
  const u = p[1 - f.axis]!;
  return (
    Math.abs(p[f.axis]! - f.plane) <= reach &&
    u >= f.uMin - reach &&
    u <= f.uMax + reach &&
    p[2] >= f.zMin - reach &&
    p[2] <= f.zMax + reach
  );
}

/** Triangles of `m` within `reach` of the junction (by bounding box), for distance queries. */
function trianglesNear(m: WorldMesh, f: JunctionFrame, reach: number): Tri[] {
  const out: Tri[] = [];
  const w = 1 - f.axis;
  for (let t = 0; t < m.triangles.length; t += 3) {
    const a = vertex(m, m.triangles[t]!);
    const b = vertex(m, m.triangles[t + 1]!);
    const c = vertex(m, m.triangles[t + 2]!);
    const min: Vec3 = [
      Math.min(a[0], b[0], c[0]),
      Math.min(a[1], b[1], c[1]),
      Math.min(a[2], b[2], c[2]),
    ];
    const max: Vec3 = [
      Math.max(a[0], b[0], c[0]),
      Math.max(a[1], b[1], c[1]),
      Math.max(a[2], b[2], c[2]),
    ];
    const r = 2 * reach;
    if (max[f.axis]! < f.plane - r || min[f.axis]! > f.plane + r) continue;
    if (max[w]! < f.uMin - r || min[w]! > f.uMax + r) continue;
    if (max[2] < f.zMin - r || min[2] > f.zMax + r) continue;
    out.push({ a, b, c, min, max });
  }
  return out;
}

/** Distance from p to triangle abc (Ericson, Real-Time Collision Detection 5.1.5). */
export function pointTriangleDistance(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const sub = (u: Vec3, v: Vec3): Vec3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u: Vec3, v: Vec3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const at = (q: Vec3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return at(a);
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return at(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return at([a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]);
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return at(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return at([a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return at([b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])]);
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return at([
    a[0] + ab[0] * v + ac[0] * w,
    a[1] + ab[1] * v + ac[1] * w,
    a[2] + ab[2] * v + ac[2] * w,
  ]);
}

function distanceTo(p: Vec3, tris: readonly Tri[], cap: number): number {
  let best = cap;
  for (const t of tris) {
    // Box distance is a lower bound: skip triangles that cannot beat the best so far.
    const dx = Math.max(t.min[0] - p[0], 0, p[0] - t.max[0]);
    const dy = Math.max(t.min[1] - p[1], 0, p[1] - t.max[1]);
    const dz = Math.max(t.min[2] - p[2], 0, p[2] - t.max[2]);
    if (Math.hypot(dx, dy, dz) >= best) continue;
    best = Math.min(best, pointTriangleDistance(p, t.a, t.b, t.c));
  }
  return best;
}

/**
 * Candidate gaps between pieces `a` and `b` at a junction: runs of free-border samples of either
 * piece lying farther than `threshold` from the other piece.
 */
export function junctionGaps(
  a: WorldMesh,
  b: WorldMesh,
  frame: JunctionFrame,
  options: Partial<GapOptions> = {},
): GapResult {
  const o = { ...DEFAULT_GAP_OPTIONS, ...options };
  const gaps: Gap[] = [];
  let samples = 0;
  for (const [side, mine, other] of [
    ['a', a, b],
    ['b', b, a],
  ] as const) {
    const tris = trianglesNear(other, frame, o.reach);
    const runs: { p: Vec3; d: number }[][] = [];
    for (let e = 0; e < mine.openEdges.length; e += 2) {
      const p = vertex(mine, mine.openEdges[e]!);
      const q = vertex(mine, mine.openEdges[e + 1]!);
      if (!nearFrame(p, frame, o.reach) && !nearFrame(q, frame, o.reach)) continue;
      const length = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      // Only borders running along the junction, where a piece ends facing the other: a border
      // running across it (the side of a floor) is closed by walls, not by the other piece.
      if (length === 0 || Math.abs(q[frame.axis]! - p[frame.axis]!) / length > 0.5) continue;
      const n = Math.max(1, Math.ceil(length / o.spacing));
      let run: { p: Vec3; d: number }[] = [];
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const s: Vec3 = [
          p[0] + t * (q[0] - p[0]),
          p[1] + t * (q[1] - p[1]),
          p[2] + t * (q[2] - p[2]),
        ];
        if (!nearFrame(s, frame, o.reach)) continue;
        samples++;
        const d = distanceTo(s, tris, o.reach * 4);
        if (d > o.threshold) run.push({ p: s, d });
        else if (run.length > 0) {
          runs.push(run);
          run = [];
        }
      }
      if (run.length > 0) runs.push(run);
    }
    for (const cluster of clusterRuns(runs, 2 * o.spacing)) {
      const points = cluster.map((r) => r.p);
      const centre: Vec3 = [0, 1, 2].map(
        (k) => points.reduce((sum, p) => sum + p[k]!, 0) / points.length,
      ) as unknown as Vec3;
      gaps.push({ side, points, width: Math.max(...cluster.map((r) => r.d)), centre });
    }
  }
  return { gaps: gaps.sort((x, y) => y.width - x.width), samples };
}

/** Merge runs whose samples come within `join` of each other (one gap spans several edges). */
function clusterRuns(runs: { p: Vec3; d: number }[][], join: number): { p: Vec3; d: number }[][] {
  const parent = runs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const close = (x: Vec3, y: Vec3) => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) <= join;
  for (let i = 0; i < runs.length; i++)
    for (let j = i + 1; j < runs.length; j++) {
      const ri = runs[i]!;
      const rj = runs[j]!;
      const ends = [ri[0]!.p, ri[ri.length - 1]!.p];
      if ([rj[0]!.p, rj[rj.length - 1]!.p].some((p) => ends.some((q) => close(p, q))))
        parent[find(i)] = find(j);
    }
  const groups = new Map<number, { p: Vec3; d: number }[]>();
  runs.forEach((r, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), ...r]);
  });
  return [...groups.values()];
}

// ---- junctions of an editor layout ------------------------------------------------------------

/** One side of a junction: a piece and its exact world placement. */
export interface JunctionSide {
  key: string;
  piece: FormKey;
  pos: Vec3;
  /** Skyrim Z angle (clockwise heading), radians. */
  heading: number;
}

/** A junction of the layout for the deep check: an opening and every tile facing it. */
export interface LayoutJunction {
  joint: Joint;
  mine: JunctionSide;
  facing: JunctionSide[];
  frame: JunctionFrame;
  /** Same pieces in the same relative placement give the same key, anywhere and turned. */
  key: string;
}

/** The junction plane and extent of a world opening (the cells behind it, facing `dir`). */
export function jointFrame(
  dir: FaceDir,
  cells: readonly CellIndex[],
  anchor: GridAnchor,
): JunctionFrame {
  const { origin, module } = anchor;
  const axis = dir[1] === 'X' ? 0 : 1;
  const u = 1 - axis;
  const along = cells.map((c) => c[axis]!);
  const across = cells.map((c) => c[u]!);
  const levels = cells.map((c) => c[2]);
  const edge = dir[0] === '+' ? Math.max(...along) + 1 : Math.min(...along);
  return {
    axis,
    plane: origin[axis]! + edge * module.xy,
    uMin: origin[u]! + Math.min(...across) * module.xy,
    uMax: origin[u]! + (Math.max(...across) + 1) * module.xy,
    zMin: origin[2] + Math.min(...levels) * module.z,
    zMax: origin[2] + (Math.max(...levels) + 1) * module.z,
  };
}

function sideOf(layout: Layout, pieces: Pieces, anchor: GridAnchor, key: string): JunctionSide {
  const tile = layout.tiles.get(key)!;
  const placement = tileWorldPlacement(tile, pieces.get(tile.piece)!, anchor);
  return { key, piece: tile.piece, pos: placement.pos, heading: placement.rot[2] };
}

/**
 * Cache key of a junction: the opening's piece and direction (rotation 0), then each facing
 * piece with its position and turn relative to the opening's piece, rounded to the unit and the
 * quarter turn.
 */
export function junctionKey(
  joint: Joint,
  mine: JunctionSide,
  facing: readonly JunctionSide[],
): string {
  const c = Math.cos(mine.heading);
  const s = Math.sin(mine.heading);
  const others = facing.map((f) => {
    const dx = f.pos[0] - mine.pos[0];
    const dy = f.pos[1] - mine.pos[1];
    // Undo the heading: world = (x c + y s, -x s + y c).
    const x = Math.round(dx * c - dy * s) + 0;
    const y = Math.round(dx * s + dy * c) + 0;
    const z = Math.round(f.pos[2] - mine.pos[2]) + 0;
    const turn = (((Math.round(((f.heading - mine.heading) * 2) / Math.PI) % 4) + 4) % 4) as number;
    return `${f.piece}@${x},${y},${z},${turn}`;
  });
  return `${mine.piece}:${joint.opening.dir}|${others.sort().join('|')}`;
}

/** Every opening of the layout that faces other tiles, as junctions for the deep check. */
export function layoutJunctions(
  layout: Layout,
  pieces: Pieces,
  types: ReadonlyMap<string, ConnectionType>,
  anchor: GridAnchor,
): LayoutJunction[] {
  const out: LayoutJunction[] = [];
  for (const tile of layout.tiles.values()) {
    if (!pieces.has(tile.piece)) continue;
    for (const joint of jointsOfTile(layout, pieces, types, tile.key)) {
      if (joint.tile !== tile.key || joint.against.length === 0) continue;
      out.push(layoutJunction(joint, layout, pieces, anchor));
    }
  }
  return out;
}

export function layoutJunction(
  joint: Joint,
  layout: Layout,
  pieces: Pieces,
  anchor: GridAnchor,
): LayoutJunction {
  const mine = sideOf(layout, pieces, anchor, joint.tile);
  const facing = joint.against.map((k) => sideOf(layout, pieces, anchor, k));
  return {
    joint,
    mine,
    facing,
    frame: jointFrame(joint.dir, joint.cells, anchor),
    key: junctionKey(joint, mine, facing),
  };
}

/** Every tile of the layout with its exact world placement (the scene around junctions). */
export function layoutSides(layout: Layout, pieces: Pieces, anchor: GridAnchor): JunctionSide[] {
  return [...layout.tiles.keys()]
    .filter((k) => pieces.has(layout.tiles.get(k)!.piece))
    .map((k) => sideOf(layout, pieces, anchor, k));
}

/** A point in a side's own frame (origin at its position, heading undone), and back. */
export function toSideFrame(side: JunctionSide, p: Vec3): Vec3 {
  const c = Math.cos(side.heading);
  const s = Math.sin(side.heading);
  const dx = p[0] - side.pos[0];
  const dy = p[1] - side.pos[1];
  return [dx * c - dy * s, dx * s + dy * c, p[2] - side.pos[2]];
}

export function fromSideFrame(side: JunctionSide, p: Vec3): Vec3 {
  const c = Math.cos(side.heading);
  const s = Math.sin(side.heading);
  return [
    p[0] * c + p[1] * s + side.pos[0],
    -p[0] * s + p[1] * c + side.pos[1],
    p[2] + side.pos[2],
  ];
}
