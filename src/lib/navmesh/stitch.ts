/**
 * Adding a bake to a cell's existing NavMesh (V2 step 11, D33, D36, D64).
 *
 * The cell keeps one NAVM. Its triangles, whoever made them (the CK, by hand, or the tool), are
 * never reshaped: the tiles they cover are not baked (D64), the bake leaves out the area they
 * cover, and the new triangles are appended. Where both meet, the border edges of each side get
 * the other side's border vertices lying on them (an existing border triangle is split in two:
 * it keeps its index, the new half goes to the end), so the shared borders weld. The existing
 * triangles keep their flags, door links, cover and links to other NavMeshes; adjacency and the
 * search grid are recomputed.
 */
import type { CellIndex, Vec3 } from '../catalogue/types';
import { NAV_TRIANGLE_DEFAULT_FLAGS, searchGrid, type TriangleIndices } from './build';
import type { NavMeshData, NavTriangle } from '../format/esp/navm';

/** A tile's footprint in the world: its cells' rectangles and the heights of its levels. */
export interface TileFootprint {
  key: string;
  cells: readonly CellIndex[];
}

export interface GridFrame {
  origin: Vec3;
  module: { xy: number; z: number };
}

/**
 * Tiles holding NavMesh triangles (D35): a triangle whose centre falls in one of the tile's
 * cells, at that cell's level (from half a level below its floor to its top).
 */
export function coveredTiles(
  nav: Pick<NavMeshData, 'vertices' | 'triangles'>,
  tiles: readonly TileFootprint[],
  grid: GridFrame,
): Set<string> {
  const find = cellFinder(tiles, grid);
  const out = new Set<string>();
  for (const t of nav.triangles) {
    const key = find(centreOf(nav, t.vertices));
    if (key) out.add(key);
  }
  return out;
}

function centreOf(
  nav: Pick<NavMeshData, 'vertices'>,
  vertices: readonly number[],
): [number, number, number] {
  return [0, 1, 2].map((k) => vertices.reduce((sum, v) => sum + nav.vertices[v]![k]!, 0) / 3) as [
    number,
    number,
    number,
  ];
}

/**
 * The tile whose cell holds a point, at that cell's level (from half a level below its floor to
 * its top). Cells may be fractional (pieces shifted by the fine step, D70): each shift is
 * looked up on its own grid.
 */
function cellFinder(
  tiles: readonly TileFootprint[],
  grid: GridFrame,
): (p: [number, number, number]) => string | undefined {
  const frac = (v: number) => v - Math.floor(v);
  const byShift = new Map<
    string,
    { shift: [number, number, number]; owner: Map<string, string> }
  >();
  for (const t of tiles)
    for (const c of t.cells) {
      const shift: [number, number, number] = [frac(c[0]), frac(c[1]), frac(c[2])];
      const k = shift.join(',');
      let e = byShift.get(k);
      if (!e) byShift.set(k, (e = { shift, owner: new Map() }));
      e.owner.set(c.map(Math.floor).join(','), t.key);
    }
  const { origin, module } = grid;
  return ([x, y, z]) => {
    for (const { shift, owner } of byShift.values()) {
      const i = Math.floor((x - origin[0]) / module.xy - shift[0]);
      const j = Math.floor((y - origin[1]) / module.xy - shift[1]);
      // the level whose floor lies at most half a level below the point
      const k = Math.floor((z - origin[2]) / module.z - shift[2] + 0.5);
      const key = owner.get(`${i},${j},${k}`) ?? owner.get(`${i},${j},${k - 1}`);
      if (key) return key;
    }
    return undefined;
  };
}

const edgeKey = (u: number, v: number) => (u < v ? `${u}:${v}` : `${v}:${u}`);

/** Edges used by a single triangle: the borders of the mesh. */
function borderEdges(triangles: readonly TriangleIndices[]): Map<string, number> {
  const count = new Map<string, number[]>();
  triangles.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const id = edgeKey(t[k]!, t[(k + 1) % 3]!);
      count.set(id, [...(count.get(id) ?? []), i]);
    }
  });
  const out = new Map<string, number>();
  for (const [id, list] of count) if (list.length === 1) out.set(id, list[0]!);
  return out;
}

/**
 * Split border edges at the border vertices lying on them (within `tol` in plan, `step` in
 * height), so two meshes touching along a border share their vertices there. A split triangle
 * keeps its index; its new half is appended, with `copy(original)` as its data. Triangles for
 * which `fixed(i)` is true are never split.
 */
export function conformMesh(
  vertices: readonly Vec3[],
  triangles: TriangleIndices[],
  options: {
    tol: number;
    step: number;
    fixed?: (i: number) => boolean;
    onSplit?: (from: number) => void;
  },
): void {
  // one split at a time (the border map changes with each), until none is left
  for (let guard = 0; guard < 100000; guard++) {
    const borders = borderEdges(triangles);
    const borderVertices = new Set<number>();
    for (const id of borders.keys()) for (const v of id.split(':')) borderVertices.add(Number(v));
    let done = true;
    for (const [id, t] of borders) {
      if (options.fixed?.(t)) continue;
      const [u, v] = id.split(':').map(Number) as [number, number];
      const a = vertices[u]!;
      const b = vertices[v]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy;
      if (l2 === 0) continue;
      let best: { p: number; s: number } | undefined;
      for (const p of borderVertices) {
        if (p === u || p === v) continue;
        const q = vertices[p]!;
        const s = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2;
        if (s <= 0 || s >= 1) continue;
        if (Math.sqrt(l2) * Math.min(s, 1 - s) <= options.tol) continue;
        if (Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / Math.sqrt(l2) > options.tol)
          continue;
        if (Math.abs(q[2] - (a[2] + s * (b[2] - a[2]))) > options.step) continue;
        if (!best || Math.abs(s - 0.5) < Math.abs(best.s - 0.5)) best = { p, s };
      }
      if (!best) continue;
      // split triangle t on edge u-v at p: (first, p, w) in place, (p, second, w) appended
      const tri = triangles[t]!;
      const k = [0, 1, 2].find((n) => edgeKey(tri[n]!, tri[(n + 1) % 3]!) === id)!;
      const first = tri[k]!;
      const second = tri[(k + 1) % 3]!;
      const w = tri[(k + 2) % 3]!;
      triangles[t] = [first, best.p, w];
      triangles.push([best.p, second, w]);
      options.onSplit?.(t);
      done = false;
      break;
    }
    if (done) return;
  }
}

export interface StitchResult {
  nav: NavMeshData;
  /** Triangles added by the bake (the existing ones keep their indices first). */
  added: number;
  /** New border edges lying near the existing NavMesh but not welded to it (to link in the CK). */
  unlinked: [Vec3, Vec3][];
}

/**
 * Append baked triangles to a cell's NavMesh (or start one), weld and conform the borders
 * between both, and recompute adjacency and the search grid.
 */
export function mergeNavMesh(
  existing: NavMeshData | null,
  baked: { vertices: readonly Vec3[]; triangles: readonly TriangleIndices[] },
  cell: number,
  options: {
    weld: number;
    step: number;
    /** Vertices of the cell's other NavMeshes: new borders along them cannot weld (R2). */
    others?: readonly Vec3[];
  } = { weld: 0.5, step: 64 },
): StitchResult {
  const base: NavMeshData = existing ?? {
    version: 12,
    magic: 0xa5e9a03c,
    parent: { kind: 'cell', cell },
    vertices: [],
    triangles: [],
    edgeLinks: [],
    doorLinks: [],
    cover: [],
    grid: {
      divisor: 1,
      maxDistanceX: 0,
      maxDistanceY: 0,
      min: [0, 0, 0],
      max: [0, 0, 0],
      cells: [[]],
    },
    trailing: new Uint8Array(),
  };
  const vertices: Vec3[] = base.vertices.map((v) => [v[0], v[1], v[2]]);
  // weld the baked vertices onto existing ones within `weld` (plan) and a step (height)
  const map = baked.vertices.map((p) => {
    for (let i = 0; i < base.vertices.length; i++) {
      const q = vertices[i]!;
      if (
        Math.hypot(q[0] - p[0], q[1] - p[1]) <= options.weld &&
        Math.abs(q[2] - p[2]) <= options.step
      )
        return i;
    }
    vertices.push([p[0], p[1], p[2]]);
    return vertices.length - 1;
  });
  const existingCount = base.triangles.length;
  const triangles: TriangleIndices[] = [
    ...base.triangles.map((t) => t.vertices),
    ...baked.triangles.map((t) => t.map((v) => map[v]!) as unknown as TriangleIndices),
  ];
  // data per triangle: existing ones keep theirs, split halves copy their original's
  const data: { flags: number; coverFlags: number; links: [number, number, number] }[] = [
    ...base.triangles.map((t) => ({
      flags: t.flags,
      coverFlags: t.coverFlags,
      // an edge flagged as an edge link keeps its link index
      links: t.edges.map((e, k) => (t.flags & (1 << k) ? e : -2)) as [number, number, number],
    })),
    ...baked.triangles.map(() => ({
      flags: NAV_TRIANGLE_DEFAULT_FLAGS,
      coverFlags: 0,
      links: [-2, -2, -2] as [number, number, number],
    })),
  ];
  conformMesh(vertices, triangles, {
    tol: options.weld,
    step: options.step,
    // a triangle with a link to another NavMesh keeps its edges as they are
    fixed: (i) => i < data.length && data[i]!.links.some((l) => l !== -2),
    onSplit: (from) => data.push({ ...data[from]!, links: [-2, -2, -2] }),
  });

  // adjacency over the whole mesh; an edge shared by three triangles is left unlinked
  const owners = new Map<string, { t: number; k: number }[]>();
  triangles.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const id = edgeKey(t[k]!, t[(k + 1) % 3]!);
      owners.set(id, [...(owners.get(id) ?? []), { t: i, k }]);
    }
  });
  const edges = triangles.map(() => [-1, -1, -1] as [number, number, number]);
  for (const list of owners.values()) {
    if (list.length !== 2) continue;
    const [a, b] = list as [{ t: number; k: number }, { t: number; k: number }];
    edges[a.t]![a.k] = b.t;
    edges[b.t]![b.k] = a.t;
  }
  const navTriangles: NavTriangle[] = triangles.map((t, i) => {
    const d = data[i]!;
    return {
      vertices: [t[0], t[1], t[2]],
      edges: [0, 1, 2].map((k) => (d.links[k] !== -2 ? d.links[k]! : edges[i]![k]!)) as [
        number,
        number,
        number,
      ],
      flags: d.flags,
      coverFlags: d.coverFlags,
    };
  });

  // new border edges near an existing mesh (this one or the cell's others) but not welded to it
  const unlinked: [Vec3, Vec3][] = [];
  const around = [...base.vertices, ...(options.others ?? [])];
  if (around.length > 0) {
    const near = (p: Vec3) =>
      around.some(
        (q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= 32 && Math.abs(q[2] - p[2]) <= options.step,
      );
    for (const [id, list] of owners) {
      if (list.length !== 1 || list[0]!.t < existingCount) continue;
      const [u, v] = id.split(':').map(Number) as [number, number];
      const a = vertices[u]!;
      const b = vertices[v]!;
      // the short steps two outlines leave at a wall corner are no gap in the passage
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 8) continue;
      const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      if (near(mid)) unlinked.push([a, b]);
    }
  }

  return {
    nav: {
      ...base,
      parent: base.parent,
      vertices,
      triangles: navTriangles,
      grid: searchGrid(vertices, triangles),
    },
    added: triangles.length - existingCount,
    unlinked,
  };
}

/** Indices of the triangles whose centre falls in the given tiles' cells (D35's test). */
export function trianglesInTiles(
  nav: Pick<NavMeshData, 'vertices' | 'triangles'>,
  tiles: readonly TileFootprint[],
  grid: GridFrame,
): number[] {
  const find = cellFinder(tiles, grid);
  const out: number[] = [];
  nav.triangles.forEach((t, i) => {
    if (find(centreOf(nav, t.vertices))) out.push(i);
  });
  return out;
}

/**
 * The NavMesh without some triangles: the others are renumbered, their neighbours across the
 * removed ones become borders, and the door links and cover triangles follow (those of removed
 * triangles go); unused vertices are dropped and the search grid recomputed.
 */
export function removeTriangles(nav: NavMeshData, remove: readonly number[]): NavMeshData {
  const gone = new Set(remove);
  const newIndex = new Map<number, number>();
  nav.triangles.forEach((_, i) => {
    if (!gone.has(i)) newIndex.set(i, newIndex.size);
  });
  const kept = nav.triangles.filter((_, i) => !gone.has(i));
  // vertices still used, renumbered in order
  const used = new Map<number, number>();
  for (const t of kept) for (const v of t.vertices) if (!used.has(v)) used.set(v, -1);
  const order = [...used.keys()].sort((a, b) => a - b);
  order.forEach((v, i) => used.set(v, i));
  const vertices = order.map((v) => nav.vertices[v]!);
  const triangles: NavTriangle[] = kept.map((t) => ({
    vertices: t.vertices.map((v) => used.get(v)!) as [number, number, number],
    edges: t.edges.map((e, k) =>
      // an edge link keeps its index into the edge links; a neighbour is renumbered or gone
      t.flags & (1 << k) ? e : e < 0 ? e : (newIndex.get(e) ?? -1),
    ) as [number, number, number],
    flags: t.flags,
    coverFlags: t.coverFlags,
  }));
  return {
    ...nav,
    vertices,
    triangles,
    doorLinks: nav.doorLinks
      .filter((d) => newIndex.has(d.triangle))
      .map((d) => ({ ...d, triangle: newIndex.get(d.triangle)! })),
    cover: nav.cover.filter((c) => newIndex.has(c)).map((c) => newIndex.get(c)!),
    grid:
      triangles.length > 0
        ? searchGrid(
            vertices,
            triangles.map((t) => t.vertices),
          )
        : {
            divisor: 1,
            maxDistanceX: 0,
            maxDistanceY: 0,
            min: [0, 0, 0],
            max: [0, 0, 0],
            cells: [[]],
          },
  };
}
