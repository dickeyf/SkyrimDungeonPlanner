/**
 * Face profiles: the open edges lying on an opening's plane, in face-local coordinates
 * (u to the viewer's right seen from outside the piece, origin at the centre of the cells the
 * opening covers; v = z minus the opening's Z level). Port of tools/r3_face_signatures.py.
 */
import { coord, type WeldedGeometry } from './geometry';
import { PLANE_TOL, type Opening, type OpeningDir } from './openings';

export const QUANTUM = 0.5;
export const MIN_COMPONENT_SHARE = 0.25;

/** u axis sign per direction: +X face u = +Y, -X u = -Y, +Y u = -X, -Y u = +X. */
export const U_SIGN: Record<OpeningDir, 1 | -1> = { '+X': 1, '-X': -1, '+Y': -1, '-Y': 1 };

/** Segments as [u1, v1, u2, v2], canonical order. */
export type Profile = number[][];

export interface FaceProfile {
  opening: Opening;
  level: number;
  /** Centre of the covered cells along the face, in piece units. */
  u0: number;
  segments: Profile;
}

export function extractProfile(
  g: WeldedGeometry,
  o: Opening,
  u0: number,
  level: number,
  zModule: number,
): Profile {
  const edges: [number, number][] = [];
  for (let k = 0; k < g.openEdges.length; k += 2) {
    const a = g.openEdges[k]!;
    const b = g.openEdges[k + 1]!;
    if (
      Math.abs(coord(g, a, o.axis) - o.plane) < PLANE_TOL &&
      Math.abs(coord(g, b, o.axis) - o.plane) < PLANE_TOL
    )
      edges.push([a, b]);
  }
  const kept = mainComponents(g, edges);
  const s = U_SIGN[o.dir];
  const raw: number[][] = [];
  for (const [a, b] of kept) {
    const seg = [
      s * (coord(g, a, o.other) - u0),
      coord(g, a, 2) - level * zModule,
      s * (coord(g, b, o.other) - u0),
      coord(g, b, 2) - level * zModule,
    ].map((v) => Math.round(v / QUANTUM) * QUANTUM);
    if (seg[0] === seg[2] && seg[1] === seg[3]) continue;
    raw.push(seg);
  }
  return canonical(mergeCollinear(raw));
}

/** Connected components of the edge graph at least MIN_COMPONENT_SHARE as long as the longest. */
export function mainComponents(g: WeldedGeometry, edges: [number, number][]): [number, number][] {
  if (edges.length === 0) return edges;
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let p = parent.get(x) ?? x;
    while (p !== x) {
      x = p;
      p = parent.get(x) ?? x;
    }
    return x;
  };
  for (const [a, b] of edges) parent.set(find(a), find(b));
  const length = new Map<number, number>();
  const comp = edges.map(([a, b]) => {
    const c = find(a);
    const dx = coord(g, a, 0) - coord(g, b, 0);
    const dy = coord(g, a, 1) - coord(g, b, 1);
    const dz = coord(g, a, 2) - coord(g, b, 2);
    length.set(c, (length.get(c) ?? 0) + Math.hypot(dx, dy, dz));
    return c;
  });
  const longest = Math.max(...length.values());
  return edges.filter((_, i) => length.get(comp[i]!)! >= MIN_COMPONENT_SHARE * longest);
}

/** Merge chains of collinear segments meeting at degree-2 points. */
export function mergeCollinear(segs: number[][]): number[][] {
  const out = segs.map((s) => [...s]);
  let changed = true;
  while (changed) {
    changed = false;
    const byPoint = new Map<string, number[]>();
    out.forEach((s, i) => {
      for (const pt of [`${s[0]},${s[1]}`, `${s[2]},${s[3]}`]) {
        const list = byPoint.get(pt);
        if (list) list.push(i);
        else byPoint.set(pt, [i]);
      }
    });
    for (const [pt, idx] of byPoint) {
      if (idx.length !== 2) continue;
      const [i, j] = idx as [number, number];
      const [px, py] = pt.split(',').map(Number) as [number, number];
      const oi = otherEnd(out[i]!, px, py);
      const oj = otherEnd(out[j]!, px, py);
      const d1x = px - oi[0];
      const d1y = py - oi[1];
      const d2x = oj[0] - px;
      const d2y = oj[1] - py;
      const cross = d1x * d2y - d1y * d2x;
      const dot = d1x * d2x + d1y * d2y;
      if (Math.abs(cross) <= 1e-6 && dot > 0) {
        const merged = [oi[0], oi[1], oj[0], oj[1]];
        for (const k of [i, j].sort((a, b) => b - a)) out.splice(k, 1);
        out.push(merged);
        changed = true;
        break;
      }
    }
  }
  return out;
}

function otherEnd(s: number[], x: number, y: number): [number, number] {
  return s[0] === x && s[1] === y ? [s[2]!, s[3]!] : [s[0]!, s[1]!];
}

export function canonical(segs: number[][]): Profile {
  const out = segs.map((s) => {
    const flip = s[0]! > s[2]! || (s[0] === s[2] && s[1]! > s[3]!);
    return flip ? [s[2]!, s[3]!, s[0]!, s[1]!] : [s[0]!, s[1]!, s[2]!, s[3]!];
  });
  return out.sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]! || a[3]! - b[3]!);
}

export function mirror(segs: Profile): Profile {
  return canonical(segs.map((s) => [-s[2]!, s[3]!, -s[0]!, s[1]!]));
}

export function profileExtent(segs: Profile): {
  width: number;
  height: number;
  vMin: number;
  length: number;
} {
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  let length = 0;
  for (const s of segs) {
    uMin = Math.min(uMin, s[0]!, s[2]!);
    uMax = Math.max(uMax, s[0]!, s[2]!);
    vMin = Math.min(vMin, s[1]!, s[3]!);
    vMax = Math.max(vMax, s[1]!, s[3]!);
    length += Math.hypot(s[2]! - s[0]!, s[3]! - s[1]!);
  }
  return { width: uMax - uMin, height: vMax - vMin, vMin, length };
}
