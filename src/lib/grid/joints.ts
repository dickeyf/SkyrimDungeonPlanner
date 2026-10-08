/**
 * Geometric verdict on a junction between two openings, from their face profiles (R3).
 *
 * Connection types group profiles within the loose MATCH_TOL, which lets through gaps of a
 * few units that show up close. A junction is judged on the two profiles themselves, drawn
 * in the same frame:
 * - exact: they coincide within SEAM_TOL (half a unit: 1 unit already shows);
 * - included: one lies within the other, the other's extra geometry (a ceiling detail, a door
 *   frame around a narrower hall) closing on nothing visible;
 * - seam: they only coincide within the loose tolerance, leaving a gap of `gap` units;
 * - mismatch: they do not coincide.
 */
import type { CellIndex, FaceDir } from '../catalogue/types';
import { U_SIGN, type Profile } from '../mesh/profiles';
import { EXACT, MATCH_TOL, samplePoints } from '../mesh/signatures';

/**
 * Largest gap (units) that does not show as a seam. Measured in the working cell: seamless
 * junctions give 0.0, a junction with a visible seam up close 1.0 (a piece 1 unit off).
 */
export const SEAM_TOL = 0.5;

/**
 * Largest gap (units) between the planes of two facing openings, along the junction's normal,
 * that does not show: the openings match in shape but stand apart (opening planes a little
 * inside the cell boundary).
 */
export const DEPTH_TOL = 0.5;

export type JointFit = 'exact' | 'included' | 'seam' | 'mismatch';

const RANK: Record<JointFit, number> = { exact: 0, included: 1, seam: 2, mismatch: 3 };

export function betterFit(a: JointFit, b: JointFit): JointFit {
  return RANK[a] <= RANK[b] ? a : b;
}

/**
 * A profile's segments as one flat array and its sample points, built once per profile: a first
 * click on an open face compares hundreds of profile pairs (V4 step 11, 3.7 s in the browser
 * before), always the same profiles in other placements.
 */
interface Prepared {
  segs: Float64Array;
  pts: Float64Array;
}
const prepared = new WeakMap<Profile, Prepared>();

function prepare(profile: Profile): Prepared {
  let p = prepared.get(profile);
  if (!p) {
    const segs = new Float64Array(profile.length * 4);
    profile.forEach((s, i) => segs.set([s[0]!, s[1]!, s[2]!, s[3]!], i * 4));
    p = { segs, pts: samplePoints(profile) };
    prepared.set(profile, p);
  }
  return p;
}

/** Distance from a point to the nearest segment. */
function distance(px: number, py: number, segs: Float64Array): number {
  let best = Infinity;
  for (let i = 0; i < segs.length; i += 4) {
    const ax = segs[i]!;
    const ay = segs[i + 1]!;
    const dx = segs[i + 2]! - ax;
    const dy = segs[i + 3]! - ay;
    const dd = dx * dx + dy * dy;
    const t = dd === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / dd));
    const ex = ax + t * dx - px;
    const ey = ay + t * dy - py;
    const d2 = ex * ex + ey * ey;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/**
 * Distances from each sample point of `a` to profile `b`, sorted; the points are first moved by
 * `map`, the placement of `a`'s frame in `b`'s (`mirror`: u becomes `du - u`).
 */
function distances(a: Prepared, b: Prepared, map: FrameMap): number[] {
  const pts = a.pts;
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    const u = map.mirror ? map.du - pts[i]! : pts[i]! + map.du;
    out.push(distance(u, pts[i + 1]! + map.dv, b.segs));
  }
  return out.sort((x, y) => x - y);
}

/** u' = (mirror ? du - u : u + du), v' = v + dv. */
interface FrameMap {
  mirror: boolean;
  du: number;
  dv: number;
}

/** Distance within which the EXACT share of the points lie: robust to a few stray samples. */
function spread(sorted: readonly number[]): number {
  if (!sorted.length) return Infinity;
  return sorted[Math.min(sorted.length - 1, Math.ceil(EXACT * sorted.length) - 1)]!;
}

/** Fit of two profiles already in the same frame. */
export interface ProfileFit {
  fit: JointFit;
  gap: number;
  /** Distance within which `a` lies on `b`, and `b` on `a` (units). */
  aOnB: number;
  bOnA: number;
}

export function profileFit(a: Profile, b: Profile): ProfileFit {
  const same: FrameMap = { mirror: false, du: 0, dv: 0 };
  return fitOf(prepare(a), prepare(b), same, same);
}

/**
 * The fit of `a` and of `b` drawn in `a`'s frame by `inFrameOf` (the same verdict as
 * `profileFit(a, inFrameOf(...))`), without redrawing `b`: the sample points are moved instead,
 * so each profile's segments and points are prepared once.
 */
export function profileFitInFrame(
  a: Profile,
  b: Profile,
  frame: { du: number; dv: number },
): ProfileFit {
  // b in a's frame: (du - u, v + dv); a's points in b's frame: (du - u, v - dv)
  return fitOf(
    prepare(a),
    prepare(b),
    { mirror: true, du: frame.du, dv: -frame.dv },
    { mirror: true, du: frame.du, dv: frame.dv },
  );
}

function fitOf(a: Prepared, b: Prepared, aToB: FrameMap, bToA: FrameMap): ProfileFit {
  const aOnB = spread(distances(a, b, aToB));
  const bOnA = spread(distances(b, a, bToA));
  const both = Math.max(aOnB, bOnA);
  const one = Math.min(aOnB, bOnA);
  const fit: JointFit =
    both <= SEAM_TOL
      ? 'exact'
      : one <= SEAM_TOL
        ? 'included'
        : one <= MATCH_TOL
          ? 'seam'
          : 'mismatch';
  return { fit, gap: fit === 'exact' ? both : one, aOnB, bOnA };
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
  const { du, dv } = frameOffset(a, b, module);
  return profile.map((s) => [du - s[0]! + 0, s[1]! + dv, du - s[2]! + 0, s[3]! + dv]);
}

/** The shift `inFrameOf` applies: along the face (after the mirror), and in height. */
export function frameOffset(
  a: { dir: FaceDir; cells: readonly CellIndex[] },
  b: { cells: readonly CellIndex[] },
  module: { xy: number; z: number },
): { du: number; dv: number } {
  const along = a.dir[1] === 'X' ? 1 : 0;
  const centre = (cells: readonly CellIndex[]) =>
    ((Math.min(...cells.map((c) => c[along])) + Math.max(...cells.map((c) => c[along])) + 1) / 2) *
    module.xy;
  const sign = U_SIGN[a.dir as keyof typeof U_SIGN];
  const du = sign * (centre(b.cells) - centre(a.cells)) + 0; // `+ 0` turns -0 into 0
  const dv = (b.cells[0]![2] - a.cells[0]![2]) * module.z;
  return { du, dv };
}
