/**
 * Accepted overlaps: two pieces that share cells on purpose in one exact relative placement
 * (a door frame nested into its neighbour to hide the joint). Recorded by a human in the
 * annotations; such a pair is neither flagged as a shared cell nor refused when placed.
 *
 * A tile is a corner point `cell` plus a quarter-turn rotation, so the placement of B seen
 * from A is the offset of B's corner rotated back by A's rotation, and the difference of
 * rotations: the same whatever the pair's position and orientation in the level.
 */
import type { CellIndex, FormKey, PieceOverlap } from '../catalogue/types';
import { normalizeRotation, rotateCell, type Rotation } from './rotation';

/** Rotation of the second piece relative to the first; its corner in the first's frame. */
export type AcceptedOverlap = PieceOverlap;

/** Keys of accepted overlaps, both orders. */
export type AcceptedOverlaps = ReadonlySet<string>;

interface Placed {
  piece: FormKey;
  cell: CellIndex;
  rotation: Rotation;
}

const key = (a: FormKey, b: FormKey, r: Rotation, q: CellIndex) =>
  `${a}|${b}|${r}|${q[0]},${q[1]},${q[2]}`;

/** Placement of `b` in `a`'s frame. */
export function relativePlacement(a: Placed, b: Placed): AcceptedOverlap {
  const back = normalizeRotation(4 - a.rotation);
  const d: CellIndex = [b.cell[0] - a.cell[0], b.cell[1] - a.cell[1], b.cell[2] - a.cell[2]];
  return {
    pieces: [a.piece, b.piece],
    rotation: normalizeRotation(b.rotation - a.rotation),
    offset: rotateCell(d, back),
  };
}

export function acceptedOverlaps(list: readonly AcceptedOverlap[]): AcceptedOverlaps {
  const out = new Set<string>();
  for (const o of list) {
    out.add(key(o.pieces[0], o.pieces[1], o.rotation, o.offset));
    // the same pair seen from the second piece
    const r = normalizeRotation(4 - o.rotation);
    const neg: CellIndex = [0 - o.offset[0], 0 - o.offset[1], 0 - o.offset[2]];
    out.add(key(o.pieces[1], o.pieces[0], r, rotateCell(neg, r)));
  }
  return out;
}

export function overlapAccepted(accepted: AcceptedOverlaps, a: Placed, b: Placed): boolean {
  if (!accepted.size) return false;
  const rel = relativePlacement(a, b);
  return accepted.has(key(rel.pieces[0], rel.pieces[1], rel.rotation, rel.offset));
}
