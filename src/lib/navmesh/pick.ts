/**
 * Picking in a NavMesh seen from above (V2 step 14, "Edit NavMesh"): the triangle, edge or
 * vertex under the pointer, the elements within a rectangle, and the triangles a selection
 * deletes. Edges are named `u:v` with u < v.
 */
import type { Vec3 } from '../catalogue/types';
import type { NavMeshData } from '../format/esp/navm';

export type NavElement = 'triangle' | 'edge' | 'vertex';

type Mesh = Pick<NavMeshData, 'vertices' | 'triangles'>;

export const edgeName = (u: number, v: number) => (u < v ? `${u}:${v}` : `${v}:${u}`);

function inside(p: [number, number], a: Vec3, b: Vec3, c: Vec3): boolean {
  const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
  const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
  const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function segmentDistance(p: [number, number], a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Every edge of the mesh once, by name. */
export function edgesOf(
  nav: Mesh,
  allow: (triangle: number) => boolean = () => true,
): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  for (const [i, t] of nav.triangles.entries()) {
    if (!allow(i)) continue;
    for (let k = 0; k < 3; k++) {
      const u = t.vertices[k]!;
      const v = t.vertices[(k + 1) % 3]!;
      out.set(edgeName(u, v), u < v ? [u, v] : [v, u]);
    }
  }
  return out;
}

/**
 * The element under a point: the triangle containing it, or the edge or vertex nearest to it
 * within `tol` (units). Undefined when nothing is there.
 */
export function pickElement(
  nav: Mesh,
  kind: NavElement,
  x: number,
  y: number,
  tol: number,
  /** Only these triangles (and their edges and vertices) can be picked (a level, V3). */
  allow: (triangle: number) => boolean = () => true,
): number | string | undefined {
  const p: [number, number] = [x, y];
  const V = nav.vertices;
  if (kind === 'triangle') {
    const i = nav.triangles.findIndex(
      (t, k) => allow(k) && inside(p, V[t.vertices[0]]!, V[t.vertices[1]]!, V[t.vertices[2]]!),
    );
    return i >= 0 ? i : undefined;
  }
  if (kind === 'vertex') {
    let best: number | undefined;
    let bestD = tol;
    const used = new Set(nav.triangles.flatMap((t, k) => (allow(k) ? t.vertices : [])));
    for (const v of used) {
      const d = Math.hypot(V[v]![0] - x, V[v]![1] - y);
      if (d <= bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }
  let best: string | undefined;
  let bestD = tol;
  for (const [name, [u, v]] of edgesOf(nav, allow)) {
    const d = segmentDistance(p, V[u]!, V[v]!);
    if (d <= bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

/** The elements within a rectangle: triangles by their centre, edges by their middle, vertices. */
export function elementsInBox(
  nav: Mesh,
  kind: NavElement,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  allow: (triangle: number) => boolean = () => true,
): (number | string)[] {
  const V = nav.vertices;
  const inBox = (x: number, y: number) =>
    x >= Math.min(x0, x1) &&
    x <= Math.max(x0, x1) &&
    y >= Math.min(y0, y1) &&
    y <= Math.max(y0, y1);
  if (kind === 'triangle') {
    return nav.triangles.flatMap((t, i) => {
      if (!allow(i)) return [];
      const cx = t.vertices.reduce((s, v) => s + V[v]![0], 0) / 3;
      const cy = t.vertices.reduce((s, v) => s + V[v]![1], 0) / 3;
      return inBox(cx, cy) ? [i] : [];
    });
  }
  if (kind === 'vertex') {
    return [...new Set(nav.triangles.flatMap((t, i) => (allow(i) ? t.vertices : [])))].filter((v) =>
      inBox(V[v]![0], V[v]![1]),
    );
  }
  return [...edgesOf(nav, allow)].flatMap(([name, [u, v]]) =>
    inBox((V[u]![0] + V[v]![0]) / 2, (V[u]![1] + V[v]![1]) / 2) ? [name] : [],
  );
}

/**
 * The triangles a selection deletes: the selected triangles; for edges, the triangles using
 * one of them; for vertices, the triangles using one of them.
 */
export function trianglesOfSelection(
  nav: Mesh,
  kind: NavElement,
  selection: readonly (number | string)[],
): number[] {
  if (kind === 'triangle') return [...new Set(selection as number[])];
  const picked = new Set(selection);
  return nav.triangles.flatMap((t, i) => {
    const hit =
      kind === 'vertex'
        ? t.vertices.some((v) => picked.has(v))
        : [0, 1, 2].some((k) => picked.has(edgeName(t.vertices[k]!, t.vertices[(k + 1) % 3]!)));
    return hit ? [i] : [];
  });
}
