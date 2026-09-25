/**
 * Derive the grid view of a cell from its placed references (docs/design/planning/02-data-model.md §2,
 * R10, D23, V10).
 *
 * A reference is a tile placement when its base is a catalogue tile, it is not tilted or
 * scaled, its Z rotation is a multiple of 90 degrees, and its footprint corner lands on the
 * grid. The grid anchor is the offset shared by the most references (best fit), placed at
 * the lowest tile corner so existing tiles get small non-negative indices; with no
 * candidate it is the world origin.
 */
import type { CellIndex, Piece, Vec3 } from '../catalogue/types';
import { addCells, normalizeRotation, type Rotation } from './rotation';
import type { GridAnchor, OpaqueRef, PlacedRef, TilePlacement } from './types';

export interface DeriveOptions {
  module: number;
  zModule: number;
  /** Distance (units) a corner may be from a grid line. */
  positionTolerance?: number;
  /** Radians a rotation may be off a quarter turn, and off zero for tilt. */
  angleTolerance?: number;
  scaleTolerance?: number;
  /**
   * Sign relating Skyrim's Z angle to counter-clockwise quarter turns. -1 = the angle is a
   * clockwise heading (default); +1 = it is already counter-clockwise. R10 decides which by
   * counting overlaps on a real cell.
   */
  headingSign?: 1 | -1;
}

export interface DeriveResult {
  anchor: GridAnchor;
  tiles: TilePlacement[];
  opaque: OpaqueRef[];
  /** Cells claimed by more than one tile. */
  overlaps: { cell: CellIndex; refs: string[] }[];
}

const DEG90 = Math.PI / 2;

/**
 * Skyrim stores a heading: 0 faces +Y, and a positive Z angle turns clockwise seen from
 * above. In the tool's counter-clockwise quarter turns, that is minus the heading.
 */
export function quarterTurnsFromHeading(rz: number, sign: 1 | -1 = -1): number {
  return 0 + (sign * rz) / DEG90; // `0 +` keeps a heading of 0 at +0, not -0
}

export function headingFromQuarterTurns(r: Rotation, sign: 1 | -1 = -1): number {
  return normalizeRotation(sign * r) * DEG90;
}

/** Rotate a footprint cell about the corner of cell (0,0): the cell [i,i+1]x[j,j+1] lands on another unit square. */
export function rotateFootprintCell(cell: CellIndex, r: Rotation): CellIndex {
  const [i, j, k] = cell;
  switch (r) {
    case 0:
      return [i, j, k];
    case 1:
      return [-j - 1, i, k];
    case 2:
      return [-i - 1, -j - 1, k];
    case 3:
      return [j, -i - 1, k];
  }
}

/** World position of the piece's footprint corner (its cell (0,0,0) min corner). */
export function footprintCorner(pos: Vec3, r: Rotation, pivot: Vec3): Vec3 {
  const angle = r * DEG90;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // corner = pos + R(angle) * (-pivot)
  return [
    pos[0] - (c * pivot[0] - s * pivot[1]),
    pos[1] - (s * pivot[0] + c * pivot[1]),
    pos[2] - pivot[2],
  ];
}

/** World position of the NIF origin for a footprint corner placed at `corner` with rotation r. */
export function originFromCorner(corner: Vec3, r: Rotation, pivot: Vec3): Vec3 {
  const angle = r * DEG90;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    corner[0] + (c * pivot[0] - s * pivot[1]),
    corner[1] + (s * pivot[0] + c * pivot[1]),
    corner[2] + pivot[2],
  ];
}

interface Candidate {
  ref: PlacedRef;
  piece: Piece;
  rotation: Rotation;
  corner: Vec3;
}

export function deriveGrid(
  refs: readonly PlacedRef[],
  pieces: ReadonlyMap<string, Piece>,
  options: DeriveOptions,
): DeriveResult {
  const posTol = options.positionTolerance ?? 2;
  const angleTol = options.angleTolerance ?? 0.01;
  const scaleTol = options.scaleTolerance ?? 0.001;
  const sign = options.headingSign ?? -1;
  const { module, zModule } = options;

  const opaque: OpaqueRef[] = [];
  const candidates: Candidate[] = [];
  for (const ref of refs) {
    const piece = pieces.get(ref.base);
    if (!piece || piece.class !== 'tile') {
      opaque.push({ ref, reason: 'unknown-base' });
      continue;
    }
    if (Math.abs(ref.scale - 1) > scaleTol) {
      opaque.push({ ref, reason: 'scaled' });
      continue;
    }
    if (Math.abs(ref.rot[0]) > angleTol || Math.abs(ref.rot[1]) > angleTol) {
      opaque.push({ ref, reason: 'tilted' });
      continue;
    }
    const turns = quarterTurnsFromHeading(ref.rot[2], sign);
    if (Math.abs(turns - Math.round(turns)) * DEG90 > angleTol) {
      opaque.push({ ref, reason: 'non-quarter-rotation' });
      continue;
    }
    const rotation = normalizeRotation(Math.round(turns));
    candidates.push({
      ref,
      piece,
      rotation,
      corner: footprintCorner(ref.pos, rotation, piece.pivot),
    });
  }

  const anchor: GridAnchor = {
    origin: bestAnchor(candidates, module, zModule, posTol),
    module: { xy: module, z: zModule },
  };

  const tiles: TilePlacement[] = [];
  const occupancy = new Map<string, string[]>();
  for (const c of candidates) {
    const d: Vec3 = [
      c.corner[0] - anchor.origin[0],
      c.corner[1] - anchor.origin[1],
      c.corner[2] - anchor.origin[2],
    ];
    const idx = [d[0] / module, d[1] / module, d[2] / zModule];
    const cell: CellIndex = [Math.round(idx[0]!), Math.round(idx[1]!), Math.round(idx[2]!)];
    const err = [
      Math.abs(d[0] - cell[0] * module),
      Math.abs(d[1] - cell[1] * module),
      Math.abs(d[2] - cell[2] * zModule),
    ];
    if (err.some((e) => e > posTol)) {
      opaque.push({ ref: c.ref, reason: 'off-grid' });
      continue;
    }
    const occupied = c.piece.cells.map((pc) => addCells(cell, rotateFootprintCell(pc, c.rotation)));
    tiles.push({
      ref: c.ref,
      pieceEditorId: c.piece.editorId,
      cell,
      rotation: c.rotation,
      occupied,
    });
    for (const oc of occupied) {
      const key = `${oc[0]},${oc[1]},${oc[2]}`;
      const list = occupancy.get(key) ?? [];
      list.push(c.ref.refFormKey);
      occupancy.set(key, list);
    }
  }

  const overlaps: DeriveResult['overlaps'] = [];
  for (const [key, list] of occupancy) {
    if (list.length > 1) {
      const [i, j, k] = key.split(',').map(Number) as [number, number, number];
      overlaps.push({ cell: [i, j, k], refs: list });
    }
  }
  return { anchor, tiles, opaque, overlaps };
}

/** The grid offset (in [0, module) per axis) shared by the most candidates, refined by averaging. */
function bestAnchor(candidates: Candidate[], module: number, zModule: number, tol: number): Vec3 {
  if (candidates.length === 0) return [0, 0, 0];
  const axis = (i: 0 | 1 | 2, m: number): number => {
    const bins = new Map<number, number[]>();
    for (const c of candidates) {
      const residue = ((c.corner[i] % m) + m) % m;
      const bin = Math.round(residue / tol);
      // a residue near m wraps to the bin of 0
      const key = bin * tol >= m - tol ? 0 : bin;
      const members = bins.get(key);
      if (members) members.push(residue);
      else bins.set(key, [residue]);
    }
    let best: number[] = [];
    for (const members of bins.values()) if (members.length > best.length) best = members;
    const unwrapped = best.map((v) => (v > m - tol ? v - m : v));
    const phase = unwrapped.reduce((a, b) => a + b, 0) / unwrapped.length;
    // shift the phase down to the lowest candidate corner on this axis
    const lowest = Math.min(...candidates.map((c) => c.corner[i]));
    return phase + Math.floor((lowest - phase + tol) / m) * m;
  };
  return [axis(0, module), axis(1, module), axis(2, zModule)];
}
