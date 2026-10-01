import { describe, expect, it } from 'vitest';
import { buildNavMesh } from './build';
import { addTriangle, joinNavMeshes, mergeVertices, retargetLinks } from './edit';
import type { NavMeshData } from '../format/esp/navm';

/** A square of two triangles over [x, x + 100] x [0, 100]. */
const square = (x: number) =>
  buildNavMesh(
    1,
    [
      [x, 0, 0],
      [x + 100, 0, 0],
      [x + 100, 100, 0],
      [x, 100, 0],
    ],
    [
      [0, 1, 2],
      [0, 2, 3],
    ],
  );

describe('mergeVertices', () => {
  it('moves the merged vertex to the mean and links the triangles that now share an edge', () => {
    // two squares 4 units apart: join their facing corners
    const joined = joinNavMeshes(square(0), square(104), 10, 11).nav;
    const a = mergeVertices(joined, [1, 4]);
    const b = mergeVertices(a, [2, 6]);
    expect(b.vertices).toHaveLength(6);
    expect(b.vertices).toContainEqual([102, 0, 0]);
    expect(b.vertices).toContainEqual([102, 100, 0]);
    // each square's diagonal, and the shared edge linking the two squares
    expect(b.triangles.flatMap((t) => t.edges).filter((e) => e >= 0)).toHaveLength(6);
  });

  it('removes the triangles that collapse', () => {
    const merged = mergeVertices(square(0), [0, 3]);
    expect(merged.triangles).toHaveLength(1);
    expect(merged.vertices).toHaveLength(3);
  });

  it('refuses a merge that flips a triangle', () => {
    expect(() => mergeVertices(square(0), [1, 3])).toThrow(/flipped|flat/);
  });
});

describe('addTriangle', () => {
  it('winds the triangle counter-clockwise and links it', () => {
    const nav = buildNavMesh(
      1,
      [
        [0, 0, 0],
        [100, 0, 0],
        [100, 100, 0],
        [0, 100, 0],
      ],
      [[0, 1, 2]],
    );
    const added = addTriangle(nav, [3, 2, 0]);
    expect(added.triangles[1]!.vertices).toEqual([3, 0, 2]);
    expect(added.triangles[0]!.edges).toContain(1);
    expect(added.triangles[1]!.edges).toContain(0);
  });

  it('refuses a duplicate or aligned triangle', () => {
    expect(() => addTriangle(square(0), [2, 1, 0])).toThrow(/exists/);
    const line = buildNavMesh(
      1,
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [2, 0, 0],
      ],
      [[0, 1, 2]],
    );
    expect(() => addTriangle(line, [0, 1, 3])).toThrow(/aligned/);
  });
});

describe('joinNavMeshes', () => {
  it('drops the links between the two, keeps the others and moves door links', () => {
    const a: NavMeshData = {
      ...square(0),
      edgeLinks: [{ type: 0, navMesh: 11, triangle: 0 }],
    };
    a.triangles[0] = { ...a.triangles[0]!, flags: a.triangles[0]!.flags | 2, edges: [-1, 0, 1] };
    const b: NavMeshData = {
      ...square(100),
      edgeLinks: [{ type: 0, navMesh: 99, triangle: 5 }],
      doorLinks: [{ triangle: 1, crc: 0, door: 7 }],
    };
    b.triangles[1] = { ...b.triangles[1]!, flags: b.triangles[1]!.flags | 4, edges: [0, -1, 0] };
    const { nav, offset } = joinNavMeshes(a, b, 10, 11);
    expect(offset).toBe(2);
    expect(nav.triangles[0]!.flags & 2).toBe(0);
    expect(nav.triangles[3]!.flags & 4).toBe(4);
    expect(nav.edgeLinks[nav.triangles[3]!.edges[2]!]!.navMesh).toBe(99);
    expect(nav.doorLinks).toEqual([{ triangle: 3, crc: 0, door: 7 }]);
  });
});

describe('retargetLinks', () => {
  it('points links at the joined NavMesh, its triangles moved', () => {
    const c = { ...square(0), edgeLinks: [{ type: 0, navMesh: 11, triangle: 1 }] };
    expect(retargetLinks(c, 11, 10, 2)!.edgeLinks).toEqual([{ type: 0, navMesh: 10, triangle: 3 }]);
    expect(retargetLinks(c, 12, 10, 2)).toBeUndefined();
  });
});
