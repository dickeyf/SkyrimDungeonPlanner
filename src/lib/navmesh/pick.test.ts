import { describe, expect, it } from 'vitest';
import { buildNavMesh } from './build';
import { elementsInBox, pickElement, trianglesOfSelection } from './pick';

/** A 2 x 1 strip: triangles 0, 1 over [0, 100], 2, 3 over [100, 200]. */
const NAV = buildNavMesh(
  1,
  [
    [0, 0, 0],
    [100, 0, 0],
    [100, 100, 0],
    [0, 100, 0],
    [200, 0, 0],
    [200, 100, 0],
  ],
  [
    [0, 1, 2],
    [0, 2, 3],
    [1, 4, 5],
    [1, 5, 2],
  ],
);

describe('pickElement', () => {
  it('finds the triangle under a point', () => {
    expect(pickElement(NAV, 'triangle', 80, 10, 8)).toBe(0);
    expect(pickElement(NAV, 'triangle', 150, 90, 8)).toBe(3);
    expect(pickElement(NAV, 'triangle', 300, 10, 8)).toBeUndefined();
  });

  it('finds the nearest edge and vertex within the tolerance', () => {
    expect(pickElement(NAV, 'edge', 100, 50, 8)).toBe('1:2');
    expect(pickElement(NAV, 'vertex', 97, 4, 8)).toBe(1);
    expect(pickElement(NAV, 'vertex', 50, 50, 8)).toBeUndefined();
  });
});

describe('elementsInBox', () => {
  it('takes triangles by their centre, edges by their middle, and vertices', () => {
    expect(elementsInBox(NAV, 'triangle', 0, 0, 100, 100)).toEqual([0, 1]);
    expect(elementsInBox(NAV, 'vertex', 90, -10, 210, 10)).toEqual([1, 4]);
    expect(elementsInBox(NAV, 'edge', 140, -10, 160, 10)).toEqual(['1:4']);
  });
});

describe('trianglesOfSelection', () => {
  it('deletes the triangles using a selected edge or vertex', () => {
    expect(trianglesOfSelection(NAV, 'triangle', [2, 2, 0])).toEqual([2, 0]);
    expect(trianglesOfSelection(NAV, 'edge', ['1:2'])).toEqual([0, 3]);
    expect(trianglesOfSelection(NAV, 'vertex', [4])).toEqual([2]);
  });
});
