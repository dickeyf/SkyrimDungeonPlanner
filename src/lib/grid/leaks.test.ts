import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../catalogue/types';
import { weldMesh } from '../mesh/geometry';
import type { MergedMesh } from '../format/nif/geometry';
import {
  junctionGaps,
  mergeWorldMeshes,
  placeMesh,
  pointTriangleDistance,
  type JunctionFrame,
} from './leaks';

/** A floor slab from x0 to x1 (y0..y1, z 0): two triangles, open all around. */
function slab(x0: number, x1: number, y0 = -50, y1 = 50): MergedMesh {
  const positions = new Float32Array([x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  return {
    positions,
    indices,
    ranges: [{ name: 'slab', start: 0, count: 6, alpha: false }],
    min: [x0, y0, 0],
    max: [x1, y1, 0],
  };
}

const FRAME: JunctionFrame = { axis: 0, plane: 0, uMin: -50, uMax: 50, zMin: -10, zMax: 10 };

describe('pointTriangleDistance', () => {
  it('measures to the face, an edge and a vertex', () => {
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [10, 0, 0];
    const c: Vec3 = [0, 10, 0];
    expect(pointTriangleDistance([2, 2, 5], a, b, c)).toBeCloseTo(5);
    expect(pointTriangleDistance([5, -3, 0], a, b, c)).toBeCloseTo(3);
    expect(pointTriangleDistance([-3, -4, 0], a, b, c)).toBeCloseTo(5);
  });
});

describe('junctionGaps', () => {
  it('finds nothing when the two floors meet', () => {
    const a = placeMesh(weldMesh(slab(-100, 0)), [0, 0, 0], 0);
    const b = placeMesh(weldMesh(slab(0, 100)), [0, 0, 0], 0);
    expect(junctionGaps(a, b, FRAME).gaps).toHaveLength(0);
  });

  it('reports a floor that stops short, with the width of the gap', () => {
    const a = placeMesh(weldMesh(slab(-100, -3)), [0, 0, 0], 0);
    const b = placeMesh(weldMesh(slab(0, 100)), [0, 0, 0], 0);
    const { gaps } = junctionGaps(a, b, FRAME);
    const mine = gaps.filter((g) => g.side === 'a');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.width).toBeCloseTo(3);
    expect(mine[0]!.centre[0]).toBeCloseTo(-3);
    // b's border at x = 0 is 3 units from a as well.
    expect(gaps.some((g) => g.side === 'b' && Math.abs(g.width - 3) < 1e-6)).toBe(true);
  });

  it('ignores an overlap: a border lying on the other surface', () => {
    const a = placeMesh(weldMesh(slab(-100, 10)), [0, 0, 0], 0);
    const b = placeMesh(weldMesh(slab(0, 100)), [0, 0, 0], 0);
    expect(junctionGaps(a, b, FRAME).gaps).toHaveLength(0);
  });

  it('judges an opening against all the tiles facing it together', () => {
    const a = placeMesh(weldMesh(slab(-100, 0)), [0, 0, 0], 0);
    const left = placeMesh(weldMesh(slab(0, 100, -50, 0)), [0, 0, 0], 0);
    const right = placeMesh(weldMesh(slab(0, 100, 0, 50)), [0, 0, 0], 0);
    expect(junctionGaps(a, left, FRAME).gaps.some((g) => g.side === 'a')).toBe(true);
    const both = mergeWorldMeshes([left, right]);
    expect(junctionGaps(a, both, FRAME).gaps.filter((g) => g.side === 'a')).toHaveLength(0);
  });

  it('places a piece with its clockwise heading', () => {
    // A slab from x 0 to 100 turned 90 degrees clockwise goes from y 0 to -100.
    const placed = placeMesh(weldMesh(slab(0, 100)), [5, 0, 0], Math.PI / 2);
    const ys = [];
    for (let i = 1; i < placed.positions.length; i += 3) ys.push(placed.positions[i]!);
    expect(Math.min(...ys)).toBeCloseTo(-100);
    expect(Math.max(...ys)).toBeCloseTo(0);
  });
});
