import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../catalogue/types';
import { bakeLevels } from './levels';

const square = (z: number): Vec3[] => [
  [0, 0, z],
  [256, 0, z],
  [256, 256, z],
  [0, 256, z],
];
const GRID = { origin: [0, 0] as const, cell: 128 };

describe('bakeLevels', () => {
  it('bakes stacked floors apart instead of merging them', () => {
    const r = bakeLevels(
      [
        { key: 'low', rings: [square(0)], pos: [0, 0, 0], heading: 0, level: 0 },
        { key: 'high', rings: [square(0)], pos: [0, 0, 256], heading: 0, level: 1 },
      ],
      {},
      GRID,
      [],
      64,
    );
    expect(r.map((x) => x.level)).toEqual([0, 1]);
    // each floor: 2 x 2 cells of two triangles, at its own height
    for (const { result } of r) expect(result.triangles).toHaveLength(8);
    expect(r[1]!.result.vertices.every((v) => v[2] === 256)).toBe(true);
  });

  it('leaves out an existing NavMesh only at its own level', () => {
    const below: [Vec3, Vec3, Vec3] = [
      [0, 0, 0],
      [256, 0, 0],
      [256, 256, 0],
    ];
    const r = bakeLevels(
      [{ key: 'high', rings: [square(0)], pos: [0, 0, 256], heading: 0, level: 1 }],
      {},
      GRID,
      [below],
      64,
    );
    expect(r[0]!.result.triangles).toHaveLength(8);
  });
});
