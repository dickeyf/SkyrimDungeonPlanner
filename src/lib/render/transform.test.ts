import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { footprintCorner, headingFromQuarterTurns } from '../grid/derive';
import { gridLines, placementMatrix } from './transform';

const apply = (
  v: [number, number, number],
  pos: [number, number, number],
  rot: [number, number, number],
  scale = 1,
) =>
  new Vector3(...v)
    .applyMatrix4(placementMatrix(pos, rot, scale))
    .toArray()
    .map((x) => Math.round(x * 1000) / 1000 + 0);

describe('placementMatrix', () => {
  it('translates and scales', () => {
    expect(apply([1, 2, 3], [100, 200, -512], [0, 0, 0], 2)).toEqual([102, 204, -506]);
  });

  it('turns clockwise seen from above: heading 90° takes north to east', () => {
    expect(apply([0, 1, 0], [0, 0, 0], [0, 0, Math.PI / 2])).toEqual([1, 0, 0]);
    expect(apply([1, 0, 0], [0, 0, 0], [0, 0, Math.PI / 2])).toEqual([0, -1, 0]);
  });

  it('agrees with the grid derivation for every quarter turn', () => {
    // the NIF origin placed with the derivation's heading must put the footprint corner
    // (local -pivot) where footprintCorner says
    const pivot: [number, number, number] = [256, 128, 0];
    for (const r of [0, 1, 2, 3] as const) {
      const heading = headingFromQuarterTurns(r);
      const corner = apply([-pivot[0], -pivot[1], 0], [1000, 2000, 0], [0, 0, heading]);
      const expected = footprintCorner([1000, 2000, 0], r, pivot).map(
        (x) => Math.round(x * 1000) / 1000 + 0,
      );
      expect(corner).toEqual(expected);
    }
  });
});

describe('gridLines', () => {
  it('draws cell borders around the given range', () => {
    const lines = gridLines([10, 20, -512], 128, 0, 2, 0, 1);
    // 3 vertical + 2 horizontal lines, 6 numbers each
    expect(lines.length).toBe(5 * 6);
    expect(lines.slice(0, 6)).toEqual([10, 20, -512, 10, 148, -512]);
  });
});
