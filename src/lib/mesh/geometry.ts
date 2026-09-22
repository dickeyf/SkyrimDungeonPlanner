/**
 * Welded piece geometry: vertices merged by position so that UV/normal seams do not create
 * fake open edges, plus the open edges (used by a single triangle) that outline where a
 * mesh stops. Port of tools/kit_geometry.py `load_geometry`.
 */
import type { MergedMesh } from '../format/nif/geometry';

export const WELD_QUANTUM = 0.1;

export interface WeldedGeometry {
  /** One position per welded vertex, 3 floats each. */
  positions: Float64Array;
  count: number;
  /** Triangles as welded vertex ids. */
  triangles: Uint32Array;
  /** Open edges as pairs of welded ids (a < b). */
  openEdges: Uint32Array;
  /** Per welded vertex: lies on an open edge. */
  rim: Uint8Array;
  min: [number, number, number];
  max: [number, number, number];
}

export function weldMesh(mesh: MergedMesh): WeldedGeometry {
  const n = mesh.positions.length / 3;
  const ids = new Map<string, number>();
  const map = new Uint32Array(n);
  const positions: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = mesh.positions[i * 3]!;
    const y = mesh.positions[i * 3 + 1]!;
    const z = mesh.positions[i * 3 + 2]!;
    const key = `${Math.round(x / WELD_QUANTUM)},${Math.round(y / WELD_QUANTUM)},${Math.round(z / WELD_QUANTUM)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = positions.length / 3;
      ids.set(key, id);
      positions.push(x, y, z);
    }
    map[i] = id;
  }
  const count = positions.length / 3;
  const triangles = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < mesh.indices.length; i++) triangles[i] = map[mesh.indices[i]!]!;

  const edgeCount = new Map<number, number>();
  const edgeKey = (a: number, b: number) => (a < b ? a * count + b : b * count + a);
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t]!;
    const b = triangles[t + 1]!;
    const c = triangles[t + 2]!;
    for (const k of [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)])
      edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
  }
  const open: number[] = [];
  const rim = new Uint8Array(count);
  for (const [k, c] of edgeCount) {
    if (c !== 1) continue;
    const a = Math.floor(k / count);
    const b = k % count;
    open.push(a, b);
    rim[a] = 1;
    rim[b] = 1;
  }
  return {
    positions: Float64Array.from(positions),
    count,
    triangles,
    openEdges: Uint32Array.from(open),
    rim,
    min: mesh.min,
    max: mesh.max,
  };
}

export function coord(g: WeldedGeometry, id: number, axis: 0 | 1 | 2): number {
  return g.positions[id * 3 + axis]!;
}
