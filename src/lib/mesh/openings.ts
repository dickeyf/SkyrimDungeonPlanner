/**
 * Openings on the sides of a piece's bounding box. Port of tools/kit_geometry.py
 * `find_openings`, with the heuristics proven by R5:
 * - candidate planes near a bounding-box edge, nearest first (decor just inside an opening can
 *   be denser than its rim);
 * - an opening's vertices span floor to ceiling (a closed side only carries ceiling trim);
 * - its vertices sit on open edges (a rendered wall in the plane has shared edges instead);
 * - it is at least MIN_OPEN_WIDTH wide at floor level (narrower rims are wall ends).
 */
import { coord, type WeldedGeometry } from './geometry';

export const PLANE_TOL = 1.0;
export const EDGE_TOL = 6.0;
export const MIN_OPEN_VERTS = 20;
export const MIN_OPEN_HEIGHT = 200;
export const MIN_RIM_SHARE = 0.1;
export const MIN_OPEN_WIDTH = 64;

export type OpeningDir = '+X' | '-X' | '+Y' | '-Y';

export interface Opening {
  dir: OpeningDir;
  axis: 0 | 1;
  other: 0 | 1;
  sign: 1 | -1;
  plane: number;
  /** Extent along the other horizontal axis at floor level. */
  spanMin: number;
  spanMax: number;
  zMin: number;
  zMax: number;
  verts: number;
  centre: number;
  width: number;
}

export function findOpenings(g: WeldedGeometry): Opening[] {
  const out: Opening[] = [];
  for (const axis of [0, 1] as const) {
    const other = (1 - axis) as 0 | 1;
    for (const [sign, edge] of [
      [-1, g.min[axis]],
      [1, g.max[axis]],
    ] as const) {
      // vertices near the edge, grouped by coordinate quantised to 0.5
      const counts = new Map<number, number>();
      for (let i = 0; i < g.count; i++) {
        const c = coord(g, i, axis);
        if (Math.abs(c - edge) <= EDGE_TOL) {
          const q = Math.round(c * 2) / 2;
          counts.set(q, (counts.get(q) ?? 0) + 1);
        }
      }
      const candidates = [...counts]
        .filter(([, n]) => n >= MIN_OPEN_VERTS)
        .sort((a, b) => Math.abs(a[0] - edge) - Math.abs(b[0] - edge));
      for (const [plane] of candidates) {
        const onPlane: number[] = [];
        for (let i = 0; i < g.count; i++)
          if (Math.abs(coord(g, i, axis) - plane) < PLANE_TOL) onPlane.push(i);
        let zMin = Infinity;
        let zMax = -Infinity;
        let rimVerts = 0;
        for (const i of onPlane) {
          const z = coord(g, i, 2);
          if (z < zMin) zMin = z;
          if (z > zMax) zMax = z;
          if (g.rim[i]) rimVerts++;
        }
        if (zMax - zMin < MIN_OPEN_HEIGHT) continue;
        if (rimVerts < MIN_OPEN_VERTS || rimVerts / onPlane.length < MIN_RIM_SHARE) continue;
        let spanMin = Infinity;
        let spanMax = -Infinity;
        for (const i of onPlane) {
          if (coord(g, i, 2) >= zMin + 60) continue;
          const c = coord(g, i, other);
          if (c < spanMin) spanMin = c;
          if (c > spanMax) spanMax = c;
        }
        if (spanMax - spanMin < MIN_OPEN_WIDTH) continue;
        const dir = `${sign > 0 ? '+' : '-'}${axis === 0 ? 'X' : 'Y'}` as OpeningDir;
        out.push({
          dir,
          axis,
          other,
          sign,
          plane,
          spanMin: round1(spanMin),
          spanMax: round1(spanMax),
          zMin: round1(zMin),
          zMax: round1(zMax),
          verts: onPlane.length,
          centre: round1((spanMin + spanMax) / 2),
          width: round1(spanMax - spanMin),
        });
        break;
      }
    }
  }
  return out;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
