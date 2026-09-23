/**
 * Review data for the validation page (step 10): one entry per automatic type, near matches
 * aggregated per pair of types, and containment candidates for composite faces (D56).
 */
import { coverage, EXACT, NEAR, samplePoints } from '../mesh/signatures';
import type { AnalysisResult } from './analyze';

export interface TypeEntry {
  group: number;
  /** Automatic id, `Kit:G<n>`. */
  id: string;
  /** Face index (into analysis.faces) used as representative. */
  representative: number;
  faces: number[];
  mate?: number;
  width: number;
  height: number;
  vMin: number;
}

export interface NearPair {
  a: number; // group
  b: number; // group
  bestScore: number;
  count: number;
  /** Representative faces of the best-scoring pair. */
  faceA: number;
  faceB: number;
}

export interface ContainmentPair {
  /** The group whose contour lies entirely on the other's. */
  inner: number;
  outer: number;
  innerCoverage: number;
  outerCoverage: number;
}

export interface ReviewData {
  types: TypeEntry[];
  near: NearPair[];
  containment: ContainmentPair[];
}

export function buildReview(analysis: AnalysisResult): ReviewData {
  const kit = analysis.kit.kit;
  const types: TypeEntry[] = analysis.grouping.groups.map((g) => ({
    group: g.id,
    id: `${kit}:G${g.id}`,
    representative: g.members[0]!,
    faces: g.members,
    mate: g.mate,
    width: g.width,
    height: g.height,
    vMin: g.vMin,
  }));

  const byPair = new Map<string, NearPair>();
  for (const n of analysis.grouping.near) {
    const ga = analysis.faces[n.a]!.group;
    const gb = analysis.faces[n.b]!.group;
    const [a, b, fa, fb] = ga <= gb ? [ga, gb, n.a, n.b] : [gb, ga, n.b, n.a];
    const key = `${a}-${b}`;
    const e = byPair.get(key);
    if (!e) byPair.set(key, { a, b, bestScore: n.score, count: 1, faceA: fa, faceB: fb });
    else {
      e.count++;
      if (n.score > e.bestScore) Object.assign(e, { bestScore: n.score, faceA: fa, faceB: fb });
    }
  }
  const near = [...byPair.values()].sort((x, y) => y.bestScore - x.bestScore);

  // Containment between representatives: A entirely on B, B not on A.
  const pts = types.map((t) => samplePoints(analysis.faces[t.representative]!.profile));
  const containment: ContainmentPair[] = [];
  for (const inner of types) {
    for (const outer of types) {
      if (inner.group === outer.group) continue;
      const innerCoverage = coverage(
        pts[inner.group]!,
        analysis.faces[outer.representative]!.profile,
      );
      if (innerCoverage < EXACT) continue;
      const outerCoverage = coverage(
        pts[outer.group]!,
        analysis.faces[inner.representative]!.profile,
      );
      if (outerCoverage >= NEAR) continue; // that is a near match, not a composite
      containment.push({ inner: inner.group, outer: outer.group, innerCoverage, outerCoverage });
    }
  }
  return { types, near, containment };
}
