/**
 * Quarter-turn rotations about Z, applied to cell indices and face directions.
 * A tile placement is `{ cell, rotation }` with rotation in {0, 1, 2, 3} = 0°, 90°, 180°, 270°
 * counter-clockwise (Skyrim's Z axis points up, X east, Y north).
 */
import type { CellIndex, FaceDir } from '../catalogue/types';

export type Rotation = 0 | 1 | 2 | 3;

export function normalizeRotation(quarterTurns: number): Rotation {
  return (((quarterTurns % 4) + 4) % 4) as Rotation;
}

/** Rotate a cell offset (relative to the piece origin cell) by `r` quarter turns CCW. */
export function rotateCell(cell: CellIndex, r: Rotation): CellIndex {
  const [i, j, k] = cell;
  // `0 - x` rather than `-x` so a zero coordinate never becomes -0 (keeps deep equality
  // and cell keys stable).
  switch (r) {
    case 0:
      return [i, j, k];
    case 1:
      return [0 - j, i, k];
    case 2:
      return [0 - i, 0 - j, k];
    case 3:
      return [j, 0 - i, k];
  }
}

const HORIZONTAL_CCW: readonly FaceDir[] = ['+X', '+Y', '-X', '-Y'];

export function rotateDir(dir: FaceDir, r: Rotation): FaceDir {
  const idx = HORIZONTAL_CCW.indexOf(dir);
  if (idx === -1) return dir; // ±Z are unaffected by a rotation about Z
  return HORIZONTAL_CCW[(idx + r) % 4]!;
}

export function oppositeDir(dir: FaceDir): FaceDir {
  return ((dir[0] === '+' ? '-' : '+') + dir[1]) as FaceDir;
}

/** Unit step to the neighbouring cell across a face. */
export function dirOffset(dir: FaceDir): CellIndex {
  switch (dir) {
    case '+X':
      return [1, 0, 0];
    case '-X':
      return [-1, 0, 0];
    case '+Y':
      return [0, 1, 0];
    case '-Y':
      return [0, -1, 0];
    case '+Z':
      return [0, 0, 1];
    case '-Z':
      return [0, 0, -1];
  }
}

export function addCells(a: CellIndex, b: CellIndex): CellIndex {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function cellKey(cell: CellIndex): string {
  return `${cell[0]},${cell[1]},${cell[2]}`;
}
