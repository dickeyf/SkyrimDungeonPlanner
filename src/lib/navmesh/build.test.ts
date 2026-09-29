import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../catalogue/types';
import { decodeNvnm, encodeNvnm } from '../format/esp/navm';
import {
  buildNavMesh,
  gridDivisor,
  searchGrid,
  triangleAdjacency,
  triangleTouchesRect,
  type TriangleIndices,
} from './build';

const SQUARE: Vec3[] = [
  [0, 0, 0],
  [100, 0, 0],
  [100, 100, 0],
  [0, 100, 0],
];
const HALVES: TriangleIndices[] = [
  [0, 1, 2],
  [0, 2, 3],
];

describe('triangleAdjacency', () => {
  it('links the triangles sharing an edge, -1 elsewhere', () => {
    // Edge 2-0 of the first triangle is edge 0-1 of the second.
    expect(triangleAdjacency(HALVES)).toEqual([
      [-1, -1, 1],
      [0, -1, -1],
    ]);
  });

  it('refuses an edge shared by three triangles', () => {
    expect(() => triangleAdjacency([...HALVES, [2, 0, 1]])).toThrow(/shared by 3/);
  });
});

describe('gridDivisor', () => {
  it('follows the Creation Kit thresholds', () => {
    expect([1, 16, 17, 49, 50, 99, 100, 494, 502, 5000].map(gridDivisor)).toEqual([
      1, 1, 2, 2, 3, 3, 4, 11, 12, 12,
    ]);
  });
});

describe('triangleTouchesRect', () => {
  const tri: [Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [100, 0, 0],
    [0, 100, 0],
  ];
  it('accepts overlaps and rejects rectangles beyond the hypotenuse', () => {
    expect(triangleTouchesRect(tri, 10, 10, 20, 20)).toBe(true);
    expect(triangleTouchesRect(tri, 70, 70, 90, 90)).toBe(false);
    expect(triangleTouchesRect(tri, 200, 0, 300, 10)).toBe(false);
  });
});

describe('searchGrid', () => {
  it('spans the used vertices, rows along Y', () => {
    const triangles: TriangleIndices[] = Array.from({ length: 9 }, () => [0, 1, 2]);
    const vertices: Vec3[] = [...SQUARE, [5000, 5000, 0]];
    const g = searchGrid(vertices, [...triangles, ...triangles]); // 18 triangles: divisor 2
    expect(g.divisor).toBe(2);
    expect(g.min).toEqual([0, 0, 0]);
    expect(g.max).toEqual([100, 100, 0]);
    expect(g.maxDistanceX).toBe(50);
    // Triangle 0-1-2 touches the cell x < 50, y > 50 (index 2) at its corner only: touching
    // counts, as the Creation Kit's grid is inclusive.
    expect(g.cells.map((c) => c.length)).toEqual([18, 18, 18, 18]);
  });
});

describe('searchGrid cell order', () => {
  it('numbers the cells row by row along Y', () => {
    const vertices: Vec3[] = [...SQUARE, [10, 60, 0], [40, 60, 0], [10, 90, 0]];
    // 17 triangles for a divisor of 2: the square halves span all, the small one only x < 50, y > 50.
    const triangles: TriangleIndices[] = [
      ...Array.from({ length: 8 }, () => HALVES).flat(),
      [4, 5, 6],
    ];
    const g = searchGrid(vertices, triangles);
    expect(g.divisor).toBe(2);
    expect(g.cells.map((c) => c.includes(16))).toEqual([false, false, true, false]);
  });
});

describe('buildNavMesh', () => {
  it('builds an interior NavMesh that survives the NVNM round trip', () => {
    const nav = buildNavMesh(0x01000d62, SQUARE, HALVES);
    expect(nav.parent).toEqual({ kind: 'cell', cell: 0x01000d62 });
    expect(nav.triangles[0]).toEqual({
      vertices: [0, 1, 2],
      edges: [-1, -1, 1],
      flags: 0x800,
      coverFlags: 0,
    });
    expect(nav.grid.cells).toEqual([[0, 1]]);
    expect(decodeNvnm(encodeNvnm(nav))).toEqual(nav);
  });

  it('refuses clockwise triangles and bad indices', () => {
    expect(() => buildNavMesh(1, SQUARE, [[0, 2, 1]])).toThrow(/counter-clockwise/);
    expect(() => buildNavMesh(1, SQUARE, [[0, 1, 7]])).toThrow(/vertex 7/);
  });
});
