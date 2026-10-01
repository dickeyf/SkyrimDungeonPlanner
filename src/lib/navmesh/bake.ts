/**
 * Bake (V2 step 10, D38, R11): the walkable polygons of a set of placed tiles into one
 * triangle mesh, ready for `buildNavMesh`.
 *
 * 1. Each tile's rings (piece space, rotation 0) are placed in the world; they give each vertex
 *    its height (the tiles' own triangulation).
 * 2. With a grid, every tile polygon is cut along the grid cells: a full cell becomes two
 *    triangles, and only the cells along the walls hold a small polygon, whose fan of triangles
 *    stays inside the cell. The outlines are simplified in 3D (a change of slope stays).
 * 3. Where pieces meet (cell lines, tile borders), every piece edge gets the vertices of the
 *    neighbouring pieces lying on it, so both sides carry the same vertices; where one side is
 *    narrower (R11), the rest of the wider border stays a border.
 * 4. Each piece is triangulated (earcut, holes included), vertices closer than `weld` merged, then
 *    each cell made Delaunay by edge flips (rounder triangles, the same count; the cell lines
 *    stay, keeping the regular pairs).
 */
import earcut from 'earcut';
import polygonClipping from 'polygon-clipping';
import type { Vec3 } from '../catalogue/types';
import type { TriangleIndices } from './build';

/** The grid the tile polygons are cut along: its origin in plan and its cell size. */
export interface BakeGrid {
  origin: readonly [number, number];
  cell: number;
}

/** A tile to bake: its walkable rings in piece space and its world placement. */
export interface BakeTile {
  key: string;
  rings: readonly (readonly Vec3[])[];
  pos: Vec3;
  /** Skyrim Z angle (clockwise heading), radians. */
  heading: number;
}

export interface BakeOptions {
  /** A vertex within this distance of an edge lies on it (units). */
  onEdge: number;
  /** Vertices within this distance are merged (units). */
  weld: number;
  /** Largest distance (3D) a vertex removed from an outline may lie from it (units). */
  simplify: number;
}

export const DEFAULT_BAKE_OPTIONS: BakeOptions = { onEdge: 0.5, weld: 0.5, simplify: 2 };

export interface BakeResult {
  vertices: Vec3[];
  triangles: TriangleIndices[];
  /** Tile of each triangle. */
  tileOf: string[];
}

type Ring = Vec3[];

/** Rings placed in the world: turned by the clockwise heading, then moved. */
function place(tile: BakeTile): Ring[] {
  const c = Math.cos(tile.heading);
  const s = Math.sin(tile.heading);
  return tile.rings.map((ring) =>
    ring.map((p): Vec3 => [
      p[0] * c + p[1] * s + tile.pos[0],
      -p[0] * s + p[1] * c + tile.pos[1],
      p[2] + tile.pos[2],
    ]),
  );
}

function signedArea(ring: readonly Vec3[]): number {
  let a = 0;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  });
  return a / 2;
}

function inside(p: Vec3, ring: readonly Vec3[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      hit = !hit;
  }
  return hit;
}

/**
 * Insert into `ring` every point of `points` lying on one of its edges (within `tol`), in order
 * along the edge, with a height interpolated along it.
 */
export function splitEdges(ring: readonly Vec3[], points: readonly Vec3[], tol: number): Ring {
  const out: Ring = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    out.push(a);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) continue;
    const on: { t: number; p: Vec3 }[] = [];
    for (const p of points) {
      const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
      if (t <= 0 || t >= 1) continue;
      const d = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / Math.sqrt(l2);
      if (d > tol) continue;
      // too close to an end: it is that end
      if (Math.sqrt(l2) * Math.min(t, 1 - t) <= tol) continue;
      on.push({ t, p: [a[0] + t * dx, a[1] + t * dy, a[2] + t * (b[2] - a[2])] });
    }
    on.sort((x, y) => x.t - y.t);
    for (const { p } of on)
      if (Math.hypot(p[0] - out.at(-1)![0], p[1] - out.at(-1)![1]) > tol) out.push(p);
  }
  return out;
}

export function bake(
  tiles: readonly BakeTile[],
  options: Partial<BakeOptions> = {},
  grid?: BakeGrid,
  /** Triangles of a NavMesh already there (world): the bake leaves out the area they cover. */
  exclude: readonly (readonly [Vec3, Vec3, Vec3])[] = [],
): BakeResult {
  const o = { ...DEFAULT_BAKE_OPTIONS, ...options };
  const conformed = conform(tiles, o);
  const source = triangulateTiles(conformed, o);
  if (!grid) {
    delaunayFlips(source.vertices, source.triangles, source.tileOf);
    return { vertices: source.vertices, triangles: source.triangles, tileOf: source.tileOf };
  }
  const heightAt = heightSampler(source);
  // Snapped to 1/32 of a unit (exact in binary): turned tiles leave values like 2303.999997
  // next to 2304, on which the clipping sweep line fails.
  const snap = (v: number) => Math.round(v * 32) / 32;
  const toClip = (r: Ring): [number, number][] =>
    r
      .map((p): [number, number] => [snap(p[0]), snap(p[1])])
      .filter((p, i, all) => {
        const q = all[(i + all.length - 1) % all.length]!;
        return p[0] !== q[0] || p[1] !== q[1];
      });

  // 2. cut each tile polygon along the grid cells
  const cells = new Map<
    string,
    { i: number; j: number; tile: string; parts: ReturnType<typeof polygonClipping.intersection> }
  >();
  const pieces: { cell: string; i: number; j: number; tile: string; rings: Ring[] }[] = [];
  const size = grid.cell;
  const [gx, gy] = grid.origin;
  for (const tile of conformed) {
    for (const polygon of polygonsOf(tile.rings)) {
      const clip = polygon.map(toClip).filter((r) => r.length >= 3);
      if (clip.length === 0) continue;
      const xs = clip[0]!.map((p) => p[0]);
      const ys = clip[0]!.map((p) => p[1]);
      const i0 = Math.floor((Math.min(...xs) - gx) / size);
      const i1 = Math.ceil((Math.max(...xs) - gx) / size);
      const j0 = Math.floor((Math.min(...ys) - gy) / size);
      const j1 = Math.ceil((Math.max(...ys) - gy) / size);
      for (let i = i0; i < i1; i++)
        for (let j = j0; j < j1; j++) {
          const x0 = gx + i * size;
          const y0 = gy + j * size;
          const square: [number, number][] = [
            [x0, y0],
            [x0 + size, y0],
            [x0 + size, y0 + size],
            [x0, y0 + size],
          ];
          let parts: ReturnType<typeof polygonClipping.intersection>;
          try {
            parts = polygonClipping.intersection(clip, [square]);
          } catch {
            continue; // a degenerate sliver: nothing walkable worth keeping
          }
          const key = `${i},${j}`;
          const entry = cells.get(key) ?? { i, j, tile: tile.key, parts: [] };
          entry.parts.push(...parts);
          cells.set(key, entry);
        }
    }
  }
  // Tiles may overlap in a cell (nested pieces, a door's floor patch reaching into the
  // neighbour): their parts are merged, or their triangles would overlap.
  for (const [key, { i, j, tile, parts }] of cells) {
    let merged = parts;
    if (parts.length > 1) {
      try {
        merged = polygonClipping.union(parts[0]!, ...parts.slice(1));
      } catch {
        merged = parts.slice(0, 1); // keep one part rather than overlapping ones
      }
    }
    // leave out what an existing NavMesh already covers in this cell (D64)
    if (exclude.length) {
      const x0 = gx + i * size;
      const y0 = gy + j * size;
      const near = exclude
        .filter(
          (t) =>
            t.some(
              (p) =>
                p[0] >= x0 - 1 && p[0] <= x0 + size + 1 && p[1] >= y0 - 1 && p[1] <= y0 + size + 1,
            ) ||
            // a large triangle may cover the cell without a vertex in it
            (Math.min(...t.map((p) => p[0])) <= x0 + size &&
              Math.max(...t.map((p) => p[0])) >= x0 &&
              Math.min(...t.map((p) => p[1])) <= y0 + size &&
              Math.max(...t.map((p) => p[1])) >= y0),
        )
        .map((t) => [t.map((p): [number, number] => [snap(p[0]), snap(p[1])])]);
      if (near.length && merged.length) {
        try {
          merged = polygonClipping.difference(merged, ...near);
        } catch {
          merged = []; // cannot tell what is free: leave the cell to the existing NavMesh
        }
      }
    }
    for (const part of merged) {
      const rings = part
        .map((ring) =>
          simplifyClosed(
            ring.slice(0, -1).map((p): Vec3 => [p[0], p[1], heightAt(p[0], p[1])]),
            o.simplify,
          ),
        )
        .filter((r) => r.length >= 3 && Math.abs(signedArea(r)) > 1);
      if (rings.length) pieces.push({ cell: key, i, j, tile, rings });
    }
  }

  // 3. conform the pieces: each edge gets the vertices of the pieces around it lying on it
  const byCell = new Map<string, number[]>();
  pieces.forEach((p, k) => byCell.set(p.cell, [...(byCell.get(p.cell) ?? []), k]));
  const conformedPieces = pieces.map((p, k) => {
    const near: Vec3[] = [];
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++)
        for (const n of byCell.get(`${p.i + di},${p.j + dj}`) ?? [])
          if (n !== k) near.push(...pieces[n]!.rings.flat());
    return { ...p, rings: p.rings.map((r) => splitEdges(r, near, o.onEdge)) };
  });

  // 4. triangulate, weld, then Delaunay within each cell
  const weld = welder(o.weld);
  const triangles: TriangleIndices[] = [];
  const tileOf: string[] = [];
  const cellOf: string[] = [];
  for (const piece of conformedPieces) {
    for (const [outer, ...holes] of polygonsOf(piece.rings)) {
      const flat = [outer!, ...holes].flat();
      const holeStarts: number[] = [];
      let at = outer!.length;
      for (const h of holes) {
        holeStarts.push(at);
        at += h.length;
      }
      const ids = flat.map(weld.id);
      const tris = earcut(
        flat.flatMap((p) => [p[0], p[1]]),
        holeStarts,
        2,
      );
      for (let t = 0; t < tris.length; t += 3) {
        let tri: [number, number, number] = [
          ids[tris[t]!]!,
          ids[tris[t + 1]!]!,
          ids[tris[t + 2]!]!,
        ];
        if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
        const [a, b, c] = tri.map((v) => weld.vertices[v]!) as [Vec3, Vec3, Vec3];
        const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (Math.abs(area) < 1e-6) continue;
        if (area < 0) tri = [tri[0], tri[2], tri[1]]; // counter-clockwise seen from above
        triangles.push(tri);
        tileOf.push(piece.tile);
        cellOf.push(piece.cell);
      }
    }
  }
  removeFlatTriangles(weld.vertices, triangles, tileOf, cellOf);
  delaunayFlips(weld.vertices, triangles, cellOf);
  return { vertices: weld.vertices, triangles, tileOf };
}

/**
 * Remove the flat triangles ear clipping leaves along a border carrying collinear vertices (a
 * point inserted on a cell line, (a, p, b) with p on the segment ab): the triangle on the other
 * side of ab is split at p instead, so the mesh stays continuous and no edge ends up shared by
 * three triangles. A flat triangle with nothing across ab is just dropped.
 */
function removeFlatTriangles(
  vertices: readonly Vec3[],
  triangles: TriangleIndices[],
  tileOf: string[],
  cellOf: string[],
): void {
  const flat = (t: TriangleIndices): number => {
    // the vertex lying between the two others, or -1 when the triangle is not flat
    const [a, b, c] = t.map((i) => vertices[i]!) as [Vec3, Vec3, Vec3];
    const lengths = [
      Math.hypot(b[0] - c[0], b[1] - c[1]),
      Math.hypot(c[0] - a[0], c[1] - a[1]),
      Math.hypot(a[0] - b[0], a[1] - b[1]),
    ];
    const longest = Math.max(...lengths);
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    // height over the longest side under a tenth of a unit
    if (longest === 0 || (2 * area) / longest >= 0.1) return -1;
    return lengths.indexOf(longest); // the vertex opposite the longest side
  };
  for (let guard = 0; guard < triangles.length; guard++) {
    const t = triangles.findIndex((tri) => flat(tri) >= 0);
    if (t < 0) return;
    const tri = triangles[t]!;
    const k = flat(tri);
    const p = tri[k]!;
    const a = tri[(k + 1) % 3]!;
    const b = tri[(k + 2) % 3]!;
    triangles.splice(t, 1);
    const [tile] = tileOf.splice(t, 1);
    const [cell] = cellOf.splice(t, 1);
    const across = triangles.findIndex((u) => u.includes(a) && u.includes(b));
    if (across < 0) continue;
    // split only where it mends a crack: each half edge then has exactly two triangles
    const users = (x: number, y: number) =>
      triangles.filter((u) => u.includes(x) && u.includes(y)).length;
    if (users(a, p) !== 1 || users(p, b) !== 1) continue;
    const u = triangles[across]!;
    const q = u.find((x) => x !== a && x !== b)!;
    // split (a, b, q) at p into two counter-clockwise triangles
    const ccw = (x: number, y: number, z: number): TriangleIndices => {
      const [X, Y, Z] = [x, y, z].map((i) => vertices[i]!) as [Vec3, Vec3, Vec3];
      return (Y[0] - X[0]) * (Z[1] - X[1]) - (Y[1] - X[1]) * (Z[0] - X[0]) >= 0
        ? [x, y, z]
        : [x, z, y];
    };
    triangles[across] = ccw(a, p, q);
    triangles.push(ccw(p, b, q));
    tileOf.push(tileOf[across] ?? tile ?? '');
    cellOf.push(cellOf[across] ?? cell ?? '');
  }
}

/** Vertices merged within `distance` (in plan, and within a step in height). */
function welder(distance: number): { vertices: Vec3[]; id: (p: Vec3) => number } {
  const vertices: Vec3[] = [];
  const buckets = new Map<string, number[]>();
  const id = (p: Vec3): number => {
    const cx = Math.floor(p[0] / distance);
    const cy = Math.floor(p[1] / distance);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const k of buckets.get(`${cx + dx},${cy + dy}`) ?? []) {
          const q = vertices[k]!;
          if (Math.hypot(q[0] - p[0], q[1] - p[1]) <= distance && Math.abs(q[2] - p[2]) <= 64)
            return k;
        }
    const k = vertices.length;
    vertices.push([p[0], p[1], p[2]]);
    buckets.set(`${cx},${cy}`, [...(buckets.get(`${cx},${cy}`) ?? []), k]);
    return k;
  };
  return { vertices, id };
}

/** Rings placed in the world and conformed where tiles meet. */
function conform(tiles: readonly BakeTile[], o: BakeOptions): { key: string; rings: Ring[] }[] {
  const placed = tiles.map((t) => ({ key: t.key, rings: place(t) }));

  // 2. conform the borders: each ring takes the vertices of the other tiles' rings on its edges
  const boxes = placed.map((t) => {
    const all = t.rings.flat();
    return {
      minX: Math.min(...all.map((p) => p[0])) - o.onEdge,
      maxX: Math.max(...all.map((p) => p[0])) + o.onEdge,
      minY: Math.min(...all.map((p) => p[1])) - o.onEdge,
      maxY: Math.max(...all.map((p) => p[1])) + o.onEdge,
    };
  });
  const conformed = placed.map((t, i) => {
    const b = boxes[i]!;
    const others: Vec3[] = [];
    placed.forEach((u, k) => {
      if (k === i || t.rings.length === 0 || u.rings.length === 0) return;
      const c = boxes[k]!;
      if (c.minX > b.maxX || c.maxX < b.minX || c.minY > b.maxY || c.maxY < b.minY) return;
      for (const ring of u.rings)
        for (const p of ring)
          if (p[0] >= b.minX && p[0] <= b.maxX && p[1] >= b.minY && p[1] <= b.maxY) others.push(p);
    });
    return { key: t.key, rings: t.rings.map((r) => splitEdges(r, others, o.onEdge)) };
  });
  return conformed;
}

/** A tile's rings grouped into polygons: each outer ring with the holes inside it. */
function polygonsOf(rings: readonly Ring[]): Ring[][] {
  const outers = rings.filter((r) => r.length >= 3 && signedArea(r) > 0);
  const holes = rings.filter((r) => r.length >= 3 && signedArea(r) < 0);
  return outers.map((outer) => [outer, ...holes.filter((h) => inside(h[0]!, outer))]);
}

interface TiledMesh extends BakeResult {
  /** The triangle under a point in plan, if any. */
  locate(x: number, y: number): { tile: string; z: number } | undefined;
}

/** Each tile's polygons triangulated on their own, welded where tiles meet. */
function triangulateTiles(
  conformed: readonly { key: string; rings: Ring[] }[],
  o: BakeOptions,
): TiledMesh {
  const vertices: Vec3[] = [];
  const triangles: TriangleIndices[] = [];
  const tileOf: string[] = [];
  const weldIndex = new Map<string, number[]>();
  const cellOf = (p: Vec3) => `${Math.floor(p[0] / o.weld)},${Math.floor(p[1] / o.weld)}`;
  const vertexId = (p: Vec3): number => {
    // 4. weld: look in the neighbouring buckets for a vertex within `weld`
    const cx = Math.floor(p[0] / o.weld);
    const cy = Math.floor(p[1] / o.weld);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const id of weldIndex.get(`${cx + dx},${cy + dy}`) ?? []) {
          const q = vertices[id]!;
          if (Math.hypot(q[0] - p[0], q[1] - p[1]) <= o.weld && Math.abs(q[2] - p[2]) <= 64)
            return id;
        }
    const id = vertices.length;
    vertices.push([p[0], p[1], p[2]]);
    const key = cellOf(p);
    weldIndex.set(key, [...(weldIndex.get(key) ?? []), id]);
    return id;
  };

  for (const tile of conformed) {
    for (const [outer, ...mine] of polygonsOf(tile.rings)) {
      const flat: Vec3[] = [outer!, ...mine].flat();
      const data: number[] = flat.flatMap((p) => [p[0], p[1]]);
      const holeStarts: number[] = [];
      let at = outer!.length;
      for (const h of mine) {
        holeStarts.push(at);
        at += h.length;
      }
      const tris = earcut(data, holeStarts, 2);
      const ids = flat.map(vertexId);
      for (let t = 0; t < tris.length; t += 3) {
        let tri: [number, number, number] = [
          ids[tris[t]!]!,
          ids[tris[t + 1]!]!,
          ids[tris[t + 2]!]!,
        ];
        if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
        const [a, b, c] = tri.map((i) => vertices[i]!) as [Vec3, Vec3, Vec3];
        const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (Math.abs(area) < 1e-6) continue;
        if (area < 0) tri = [tri[0], tri[2], tri[1]]; // counter-clockwise seen from above
        triangles.push(tri);
        tileOf.push(tile.key);
      }
    }
  }
  const locate = (x: number, y: number) => {
    for (let t = 0; t < triangles.length; t++) {
      const [a, b, c] = triangles[t]!.map((i) => vertices[i]!) as [Vec3, Vec3, Vec3];
      const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (det === 0) continue;
      const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / det;
      const l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      return { tile: tileOf[t]!, z: l1 * a[2] + l2 * b[2] + l3 * c[2] };
    }
    return undefined;
  };
  return { vertices, triangles, tileOf, locate };
}

/** Height of the walkable surface at a point: the tiles' surface there, else the nearest vertex. */
function heightSampler(source: TiledMesh): (x: number, y: number) => number {
  return (x, y) => {
    const hit = source.locate(x, y);
    if (hit) return hit.z;
    let best = 0;
    let bestD = Infinity;
    for (const v of source.vertices) {
      const d = Math.hypot(v[0] - x, v[1] - y);
      if (d < bestD) {
        bestD = d;
        best = v[2];
      }
    }
    return best;
  };
}

/** Douglas-Peucker in 3D on a closed ring, split at its two farthest-apart vertices. */
function simplifyClosed(ring: readonly Vec3[], tolerance: number): Vec3[] {
  if (ring.length <= 4) return [...ring];
  let far = 0;
  let farD = -1;
  ring.forEach((p, i) => {
    const d = Math.hypot(p[0] - ring[0]![0], p[1] - ring[0]![1], p[2] - ring[0]![2]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  });
  const first = simplifyPath(ring.slice(0, far + 1), tolerance);
  const second = simplifyPath([...ring.slice(far), ring[0]!], tolerance);
  const out = [...first.slice(0, -1), ...second.slice(0, -1)];
  return out.length >= 3 ? out : [...ring];
}

function simplifyPath(path: readonly Vec3[], tolerance: number): Vec3[] {
  if (path.length <= 2) return [...path];
  const a = path[0]!;
  const b = path[path.length - 1]!;
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  let worst = 0;
  let index = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const p = path[i]!;
    const t =
      len2 === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / len2,
            ),
          );
    const d = Math.hypot(p[0] - a[0] - t * ab[0], p[1] - a[1] - t * ab[1], p[2] - a[2] - t * ab[2]);
    if (d > worst) {
      worst = d;
      index = i;
    }
  }
  if (worst <= tolerance) return [a, b];
  const left = simplifyPath(path.slice(0, index + 1), tolerance);
  const right = simplifyPath(path.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

/**
 * 2D in-circle test: positive when `d` lies inside the circle through the counter-clockwise
 * triangle a, b, c.
 */
function inCircle(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  const ax = a[0] - d[0];
  const ay = a[1] - d[1];
  const bx = b[0] - d[0];
  const by = b[1] - d[1];
  const cx = c[0] - d[0];
  const cy = c[1] - d[1];
  return (
    (ax * ax + ay * ay) * (bx * cy - cx * by) -
    (bx * bx + by * by) * (ax * cy - cx * ay) +
    (cx * cx + cy * cy) * (ax * by - bx * ay)
  );
}

const cross = (o: Vec3, a: Vec3, b: Vec3) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/**
 * Constrained Delaunay by edge flips (Lawson): an edge shared by two triangles of the same group
 * (grid cell, or tile) is replaced by the other diagonal of their quadrilateral when that one
 * gives rounder triangles. Outlines are never flipped (they have a single triangle), nor the
 * edges between groups. Ear clipping fans out from one vertex; the flips undo the long slivers
 * without changing the triangle count.
 */
function delaunayFlips(
  vertices: readonly Vec3[],
  triangles: TriangleIndices[],
  groupOf: readonly string[],
): void {
  const key = (u: number, v: number) => (u < v ? `${u}:${v}` : `${v}:${u}`);
  for (let pass = 0; pass < 50; pass++) {
    const owners = new Map<string, number[]>();
    triangles.forEach((t, i) => {
      for (let k = 0; k < 3; k++) {
        const id = key(t[k]!, t[(k + 1) % 3]!);
        owners.set(id, [...(owners.get(id) ?? []), i]);
      }
    });
    const touched = new Set<number>();
    let flipped = 0;
    for (const [id, list] of owners) {
      if (list.length !== 2) continue;
      const [i, j] = list as [number, number];
      if (groupOf[i] !== groupOf[j] || touched.has(i) || touched.has(j)) continue;
      const [u, v] = id.split(':').map(Number) as [number, number];
      const ti = triangles[i]!;
      const tj = triangles[j]!;
      const c = ti.find((x) => x !== u && x !== v)!;
      const d = tj.find((x) => x !== u && x !== v)!;
      // triangle i as a counter-clockwise (p, q, c) with p, q the shared edge
      const k = ti.indexOf(c);
      const p = ti[(k + 1) % 3]!;
      const q = ti[(k + 2) % 3]!;
      const [P, Q, C, D] = [p, q, c, d].map((x) => vertices[x]!) as [Vec3, Vec3, Vec3, Vec3];
      if (inCircle(C, P, Q, D) <= 1e-9) continue;
      // the new diagonal c-d must leave two counter-clockwise triangles (convex quadrilateral)
      if (cross(C, P, D) <= 1e-9 || cross(D, Q, C) <= 1e-9) continue;
      triangles[i] = [c, p, d];
      triangles[j] = [d, q, c];
      touched.add(i).add(j);
      flipped++;
    }
    if (flipped === 0) return;
  }
}
