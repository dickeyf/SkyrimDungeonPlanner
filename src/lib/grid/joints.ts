/**
 * Geometric verdict on a junction between two openings, from their face profiles (R3).
 *
 * Connection types group profiles within the loose MATCH_TOL, which lets through gaps of a
 * few units that show up close. A junction is judged on the two profiles themselves, drawn
 * in the same frame:
 * - exact: they coincide within SEAM_TOL;
 * - included: one lies within the other, the other's extra geometry (a ceiling detail, a door
 *   frame around a narrower hall) closing on nothing visible;
 * - seam: they only coincide within the loose tolerance, leaving a gap of `gap` units;
 * - mismatch: they do not coincide.
 */
import type { CellIndex, FaceDir } from '../catalogue/types';
import { U_SIGN, type Profile } from '../mesh/profiles';
import { EXACT, MATCH_TOL, samplePoints } from '../mesh/signatures';

/** Largest gap (units) that does not show as a seam. */
export const SEAM_TOL = 1.5;

export type JointFit = 'exact' | 'included' | 'seam' | 'mismatch';

const RANK: Record<JointFit, number> = { exact: 0, included: 1, seam: 2, mismatch: 3 };

export function betterFit(a: JointFit, b: JointFit): JointFit {
  return RANK[a] <= RANK[b] ? a : b;
}

/** Distance from a point to the nearest segment. */
function distance(px: number, py: number, segs: Profile): number {
  let best = Infinity;
  for (const [ax, ay, bx, by] of segs as [number, number, number, number][]) {
    const dx = bx - ax;
    const dy = by - ay;
    const dd = dx * dx + dy * dy;
    const t = dd === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / dd));
    best = Math.min(best, Math.hypot(ax + t * dx - px, ay + t * dy - py));
  }
  return best;
}

/** Distances from each sample point of `a` to profile `b`, sorted. */
function distances(a: Profile, b: Profile): number[] {
  const pts = samplePoints(a);
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) out.push(distance(pts[i]!, pts[i + 1]!, b));
  return out.sort((x, y) => x - y);
}

/** Distance within which the EXACT share of the points lie: robust to a few stray samples. */
function spread(sorted: readonly number[]): number {
  if (!sorted.length) return Infinity;
  return sorted[Math.min(sorted.length - 1, Math.ceil(EXACT * sorted.length) - 1)]!;
}

/** Fit of two profiles already in the same frame. */
export function profileFit(a: Profile, b: Profile): { fit: JointFit; gap: number } {
  const ab = spread(distances(a, b)); // a covered by b
  const ba = spread(distances(b, a));
  const both = Math.max(ab, ba);
  const one = Math.min(ab, ba);
  if (both <= SEAM_TOL) return { fit: 'exact', gap: both };
  if (one <= SEAM_TOL) return { fit: 'included', gap: one };
  if (one <= MATCH_TOL) return { fit: 'seam', gap: one };
  return { fit: 'mismatch', gap: one };
}

/**
 * Profile `b` of the opening facing `a`, redrawn in `a`'s frame: seen from the other side
 * it is mirrored, then shifted by the offset between the centres of the two openings along
 * the face and by the difference of their levels.
 */
export function inFrameOf(
  a: { dir: FaceDir; cells: readonly CellIndex[] },
  b: { cells: readonly CellIndex[] },
  profile: Profile,
  module: { xy: number; z: number },
): Profile {
  const along = a.dir[1] === 'X' ? 1 : 0;
  const centre = (cells: readonly CellIndex[]) =>
    ((Math.min(...cells.map((c) => c[along])) + Math.max(...cells.map((c) => c[along])) + 1) / 2) *
    module.xy;
  const sign = U_SIGN[a.dir as keyof typeof U_SIGN];
  const du = sign * (centre(b.cells) - centre(a.cells)) + 0; // `+ 0` turns -0 into 0
  const dv = (b.cells[0]![2] - a.cells[0]![2]) * module.z;
  return profile.map((s) => [du - s[0]! + 0, s[1]! + dv, du - s[2]! + 0, s[3]! + dv]);
}
