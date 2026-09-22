/**
 * Compare face profiles with tolerance and group them into connection types (R3, D12, D13).
 * Two profiles match when most sampled points of each lie within MATCH_TOL of a segment of
 * the other. Faces that look at each other see the same geometry mirrored, so a type's mate
 * is the group its mirror image matches (itself when symmetric).
 */
import { mirror, profileExtent, type Profile } from './profiles';

export const SAMPLE_STEP = 2;
export const MATCH_TOL = 8; // jambs differ by up to 6 units between the two sides a kit author modelled
export const EXACT = 0.97;
export const NEAR = 0.8;
export const COARSE_TOL = 12;

export interface SignatureGroup {
  id: number;
  members: number[];
  /** Group matched by this group's mirror image; undefined when none. */
  mate?: number;
  width: number;
  height: number;
  vMin: number;
}

export interface GroupingResult {
  groups: SignatureGroup[];
  /** Face index -> group id. */
  groupOf: number[];
  near: { a: number; b: number; score: number }[];
}

export function samplePoints(segs: Profile): Float64Array {
  const pts: number[] = [];
  for (const [u1, v1, u2, v2] of segs as [number, number, number, number][]) {
    const n = Math.max(2, Math.ceil(Math.hypot(u2 - u1, v2 - v1) / SAMPLE_STEP) + 1);
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      pts.push(u1 + t * (u2 - u1), v1 + t * (v2 - v1));
    }
  }
  return Float64Array.from(pts);
}

/** Share of points within MATCH_TOL of some segment. */
export function coverage(points: Float64Array, segs: Profile): number {
  const n = points.length / 2;
  if (n === 0) return 0;
  let hits = 0;
  const tol2 = MATCH_TOL * MATCH_TOL;
  for (let i = 0; i < n; i++) {
    const px = points[i * 2]!;
    const py = points[i * 2 + 1]!;
    for (const [ax, ay, bx, by] of segs as [number, number, number, number][]) {
      const dx = bx - ax;
      const dy = by - ay;
      const dd = dx * dx + dy * dy;
      const t = dd === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / dd));
      const cx = ax + t * dx - px;
      const cy = ay + t * dy - py;
      if (cx * cx + cy * cy <= tol2) {
        hits++;
        break;
      }
    }
  }
  return hits / n;
}

class Sampled {
  readonly extent: ReturnType<typeof profileExtent>;
  readonly points: Float64Array;
  readonly mirrored: Profile;
  readonly mirroredPoints: Float64Array;
  constructor(readonly segs: Profile) {
    this.extent = profileExtent(segs);
    this.points = samplePoints(segs);
    this.mirrored = mirror(segs);
    this.mirroredPoints = samplePoints(this.mirrored);
  }
}

function coarseOk(a: Sampled, b: Sampled): boolean {
  return (
    Math.abs(a.extent.width - b.extent.width) <= COARSE_TOL &&
    Math.abs(a.extent.height - b.extent.height) <= COARSE_TOL &&
    Math.abs(a.extent.vMin - b.extent.vMin) <= COARSE_TOL
  );
}

export function score(a: Sampled, b: Sampled, mirrored = false): number {
  if (!coarseOk(a, b)) return 0;
  const segB = mirrored ? b.mirrored : b.segs;
  const ptsB = mirrored ? b.mirroredPoints : b.points;
  return Math.min(coverage(a.points, segB), coverage(ptsB, a.segs));
}

export function groupProfiles(profiles: Profile[]): GroupingResult {
  const sampled = profiles.map((p) => new Sampled(p));
  const n = sampled.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const near: GroupingResult['near'] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = score(sampled[i]!, sampled[j]!);
      if (s >= EXACT) parent[find(i)] = find(j);
      else if (s >= NEAR) near.push({ a: i, b: j, score: s });
    }
  }
  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const list = byRoot.get(r);
    if (list) list.push(i);
    else byRoot.set(r, [i]);
  }
  const ordered = [...byRoot.values()].sort((a, b) => b.length - a.length || a[0]! - b[0]!);
  const groupOf: number[] = new Array(n).fill(-1);
  const groups: SignatureGroup[] = ordered.map((members, id) => {
    for (const m of members) groupOf[m] = id;
    const e = sampled[members[0]!]!.extent;
    return { id, members, width: e.width, height: e.height, vMin: e.vMin };
  });
  for (const g of groups) {
    const rep = sampled[g.members[0]!]!;
    for (const h of groups) {
      if (score(rep, sampled[h.members[0]!]!, true) >= EXACT) {
        g.mate = h.id;
        break;
      }
    }
  }
  return { groups, groupOf, near: near.filter((p) => groupOf[p.a] !== groupOf[p.b]) };
}
