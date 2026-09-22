import { describe, expect, it } from 'vitest';
import type { FaceDir } from '../catalogue/types';
import {
  addCells,
  dirOffset,
  normalizeRotation,
  oppositeDir,
  rotateCell,
  rotateDir,
} from './rotation';

describe('rotation', () => {
  it('normalizes quarter turns into 0..3', () => {
    expect(normalizeRotation(5)).toBe(1);
    expect(normalizeRotation(-1)).toBe(3);
    expect(normalizeRotation(4)).toBe(0);
  });

  it('rotates a cell offset counter-clockwise about Z', () => {
    expect(rotateCell([1, 0, 0], 1)).toEqual([0, 1, 0]);
    expect(rotateCell([1, 0, 0], 2)).toEqual([-1, 0, 0]);
    expect(rotateCell([1, 0, 0], 3)).toEqual([0, -1, 0]);
    expect(rotateCell([2, 1, 5], 1)).toEqual([-1, 2, 5]);
  });

  it('rotates horizontal face directions and leaves vertical ones alone', () => {
    expect(rotateDir('+X', 1)).toBe('+Y');
    expect(rotateDir('+Y', 1)).toBe('-X');
    expect(rotateDir('-X', 1)).toBe('-Y');
    expect(rotateDir('-Y', 1)).toBe('+X');
    expect(rotateDir('+X', 2)).toBe('-X');
    expect(rotateDir('+Z', 3)).toBe('+Z');
  });

  it('keeps rotateDir consistent with rotateCell', () => {
    const dirs: FaceDir[] = ['+X', '-X', '+Y', '-Y'];
    for (const dir of dirs) {
      for (const r of [0, 1, 2, 3] as const) {
        expect(dirOffset(rotateDir(dir, r))).toEqual(rotateCell(dirOffset(dir), r));
      }
    }
  });

  it('computes opposites and neighbour offsets', () => {
    expect(oppositeDir('+X')).toBe('-X');
    expect(oppositeDir('-Z')).toBe('+Z');
    expect(addCells([1, 2, 3], dirOffset('-Y'))).toEqual([1, 1, 3]);
  });
});
