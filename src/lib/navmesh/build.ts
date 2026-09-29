/**
 * Build the NVNM data of a NavMesh from its vertices and triangles: internal adjacencies, triangle
 * flags and the search grid, following what the Creation Kit writes (measured on the interior
 * NavMeshes of Skyrim.esm, V2 step 3):
 *
 * - triangles are counter-clockwise seen from above; edge k runs from vertex k to vertex k + 1;
 * - the grid spans the bounding box of the vertices the triangles use, `divisor` cells per side, row-major along Y
 *   (cell index = iy * divisor + ix), each cell listing the triangles that intersect it;
 * - the divisor grows with the triangle count: 1 up to 16 triangles, 2 below 50, then one more
 *   per 50 triangles, at most 12.
 */
import type { Vec3 } from '../catalogue/types';
import {
  NAVM_MAGIC,
  NAVM_VERSION,
  type NavMeshData,
  type NavSearchGrid,
  type NavTriangle,
} from '../format/esp/navm';

/** Flag the Creation Kit sets on almost every triangle. */
export const NAV_TRIANGLE_DEFAULT_FLAGS = 0x0800;

export type TriangleIndices = readonly [number, number, number];

export function gridDivisor(triangleCount: number): number {
  if (triangleCount <= 16) return 1;
  return Math.min(12, Math.floor(triangleCount / 50) + 2);
}

/** Signed doubled area in plan: positive when counter-clockwise seen from above. */
function orientation(a: Vec3, b: Vec3, c: Vec3): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** Neighbour across each edge (-1 on the boundary); throws on a non-manifold edge. */
export function triangleAdjacency(
  triangles: readonly TriangleIndices[],
): [number, number, number][] {
  const owners = new Map<string, { triangle: number; edge: number }[]>();
  const key = (u: number, v: number) => (u < v ? `${u}:${v}` : `${v}:${u}`);
  triangles.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const id = key(t[k]!, t[(k + 1) % 3]!);
      const list = owners.get(id) ?? [];
      list.push({ triangle: i, edge: k });
      owners.set(id, list);
    }
  });
  const edges = triangles.map(() => [-1, -1, -1] as [number, number, number]);
  for (const [id, list] of owners) {
    if (list.length > 2)
      throw new Error(`NavMesh edge ${id} is shared by ${list.length} triangles`);
    if (list.length === 2) {
      const [a, b] = list as [(typeof list)[0], (typeof list)[0]];
      edges[a.triangle]![a.edge] = b.triangle;
      edges[b.triangle]![b.edge] = a.triangle;
    }
  }
  return edges;
}

/** Whether a triangle and an axis-aligned rectangle overlap in plan (separating axis test). */
export function triangleTouchesRect(
  tri: readonly [Vec3, Vec3, Vec3],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const xs = tri.map((p) => p[0]);
  const ys = tri.map((p) => p[1]);
  if (Math.max(...xs) < x0 || Math.min(...xs) > x1) return false;
  if (Math.max(...ys) < y0 || Math.min(...ys) > y1) return false;
  const corners: [number, number][] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  for (let k = 0; k < 3; k++) {
    const a = tri[k]!;
    const b = tri[(k + 1) % 3]!;
    const c = tri[(k + 2) % 3]!;
    // Normal of edge a-b; the triangle's third vertex gives the inside direction.
    const nx = a[1] - b[1];
    const ny = b[0] - a[0];
    const inside = Math.sign(nx * (c[0] - a[0]) + ny * (c[1] - a[1]));
    if (inside === 0) continue;
    if (corners.every(([x, y]) => inside * (nx * (x - a[0]) + ny * (y - a[1])) < 0)) return false;
  }
  return true;
}

export function searchGrid(
  vertices: readonly Vec3[],
  triangles: readonly TriangleIndices[],
): NavSearchGrid {
  const divisor = gridDivisor(triangles.length);
  // Bounds of the vertices the triangles use: a NavMesh may keep unused vertices.
  const used = [...new Set(triangles.flat())].map((i) => vertices[i]!);
  const min = [0, 1, 2].map((a) => Math.min(...used.map((v) => v[a]!))) as unknown as Vec3;
  const max = [0, 1, 2].map((a) => Math.max(...used.map((v) => v[a]!))) as unknown as Vec3;
  const maxDistanceX = (max[0] - min[0]) / divisor;
  const maxDistanceY = (max[1] - min[1]) / divisor;
  const cells: number[][] = [];
  for (let iy = 0; iy < divisor; iy++) {
    for (let ix = 0; ix < divisor; ix++) {
      const x0 = min[0] + ix * maxDistanceX;
      const y0 = min[1] + iy * maxDistanceY;
      const cell: number[] = [];
      triangles.forEach((t, i) => {
        const tri = t.map((v) => vertices[v]!) as [Vec3, Vec3, Vec3];
        if (triangleTouchesRect(tri, x0, y0, x0 + maxDistanceX, y0 + maxDistanceY)) cell.push(i);
      });
      cells.push(cell);
    }
  }
  return { divisor, maxDistanceX, maxDistanceY, min, max, cells };
}

/**
 * The NVNM data of a NavMesh in an interior cell, without edge links, door links or cover
 * (left to the Creation Kit's Finalize).
 */
export function buildNavMesh(
  cell: number,
  vertices: readonly Vec3[],
  triangles: readonly TriangleIndices[],
): NavMeshData {
  triangles.forEach((t, i) => {
    for (const v of t)
      if (v < 0 || v >= vertices.length) throw new RangeError(`triangle ${i}: vertex ${v}`);
    if (orientation(vertices[t[0]]!, vertices[t[1]]!, vertices[t[2]]!) <= 0)
      throw new Error(`triangle ${i} is not counter-clockwise seen from above`);
  });
  if (vertices.length > 0x7fff || triangles.length > 0x7fff)
    throw new RangeError('a NavMesh holds at most 32767 vertices and triangles');
  const adjacency = triangleAdjacency(triangles);
  const navTriangles: NavTriangle[] = triangles.map((t, i) => ({
    vertices: [t[0], t[1], t[2]],
    edges: adjacency[i]!,
    flags: NAV_TRIANGLE_DEFAULT_FLAGS,
    coverFlags: 0,
  }));
  return {
    version: NAVM_VERSION,
    magic: NAVM_MAGIC,
    parent: { kind: 'cell', cell },
    vertices: vertices.map((v) => [v[0], v[1], v[2]]),
    triangles: navTriangles,
    edgeLinks: [],
    doorLinks: [],
    cover: [],
    grid: searchGrid(vertices, triangles),
    trailing: new Uint8Array(),
  };
}
