import { describe, expect, it } from 'vitest';
import type { MergedMesh } from '../format/nif/geometry';
import type { JunctionFrame } from './leaks';
import { placeTextured, textureBreaks } from './textures';

/**
 * A wall quad in the plane y = 0, from x0 to x1 and z 0 to 100, its texture coordinates running
 * u from u0 to u1 along x and v from 0 to 1 up. It ends on the junction plane x = 0 when x0 or
 * x1 is 0.
 */
function wall(x0: number, x1: number, u0: number, u1: number, texture = 'wall.dds'): MergedMesh {
  return {
    positions: new Float32Array([x0, 0, 0, x1, 0, 0, x1, 0, 100, x0, 0, 100]),
    uvs: new Float32Array([u0, 0, u1, 0, u1, 1, u0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    ranges: [{ name: 'wall', start: 0, count: 6, alpha: false, texture }],
    min: [Math.min(x0, x1), 0, 0],
    max: [Math.max(x0, x1), 0, 100],
  };
}

const FRAME: JunctionFrame = { axis: 0, plane: 0, uMin: -50, uMax: 50, zMin: 0, zMax: 100 };
const breaksOf = (a: MergedMesh, b: MergedMesh) =>
  textureBreaks(placeTextured(a, [0, 0, 0], 0), placeTextured(b, [0, 0, 0], 0), FRAME);

describe('textureBreaks', () => {
  it('finds none when the coordinates run on', () => {
    expect(breaksOf(wall(-100, 0, 0, 1), wall(0, 100, 1, 2))).toHaveLength(0);
  });

  it('accepts a whole number of repeats', () => {
    expect(breaksOf(wall(-100, 0, 0, 1), wall(0, 100, 3, 4))).toHaveLength(0);
  });

  it('reports a shift of half a repeat, with its length and position', () => {
    const [b] = breaksOf(wall(-100, 0, 0, 1), wall(0, 100, 0.5, 1.5));
    expect(b?.cause).toBe('offset');
    expect(b?.offset).toBeCloseTo(0.5);
    expect(b?.length).toBeCloseTo(100);
    expect(b?.centre[0]).toBeCloseTo(0);
  });

  it('reports a texture flipped upside down', () => {
    const flipped = wall(0, 100, 1, 2);
    flipped.uvs.set([1, 1, 2, 1, 2, 0, 1, 0]);
    expect(breaksOf(wall(-100, 0, 0, 1), flipped).map((b) => b.cause)).toEqual(['offset']);
  });

  it('reports a different texture file', () => {
    const [b] = breaksOf(wall(-100, 0, 0, 1), wall(0, 100, 1, 2, 'stone.dds'));
    expect(b).toMatchObject({ cause: 'texture', texture: 'wall.dds', other: 'stone.dds' });
  });
});
