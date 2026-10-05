import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../catalogue/types';
import { decodeNvnm, encodeNvnm } from '../format/esp/navm';
import { bake } from './bake';
import { buildNavMesh, triangleAdjacency, type TriangleIndices } from './build';
import { coveredTiles, mergeNavMesh, removeTriangles, trianglesInTiles } from './stitch';

const GRID = { origin: [0, 0, 0] as Vec3, module: { xy: 128, z: 128 } };

/** An existing NavMesh: the square [0, 128] x [0, 128] in two triangles, a door on the first. */
function existing() {
  const nav = buildNavMesh(
    0x01000d62,
    [
      [0, 0, 0],
      [128, 0, 0],
      [128, 128, 0],
      [0, 128, 0],
    ],
    [
      [0, 1, 2],
      [0, 2, 3],
    ],
  );
  nav.triangles[0]!.flags |= 0x0400;
  nav.doorLinks.push({ triangle: 0, crc: 0x12345678, door: 0x01000d70 });
  return nav;
}

describe('coveredTiles', () => {
  it('finds the tiles holding a triangle centre at their level', () => {
    const tiles = [
      { key: 'A', cells: [[0, 0, 0]] as [number, number, number][] },
      { key: 'B', cells: [[1, 0, 0]] as [number, number, number][] },
      { key: 'Up', cells: [[0, 0, 2]] as [number, number, number][] },
    ];
    expect([...coveredTiles(existing(), tiles, GRID)]).toEqual(['A']);
  });
});

describe('mergeNavMesh', () => {
  it('starts a NavMesh in an empty cell', () => {
    const r = mergeNavMesh(
      null,
      {
        vertices: [
          [0, 0, 0],
          [10, 0, 0],
          [0, 10, 0],
        ],
        triangles: [[0, 1, 2]],
      },
      0x01000d62,
    );
    expect(r.nav.parent).toEqual({ kind: 'cell', cell: 0x01000d62 });
    expect(r.added).toBe(1);
    expect(decodeNvnm(encodeNvnm(r.nav))).toEqual(r.nav);
  });

  it('welds a bake onto an existing border, splitting it, keeping the existing data', () => {
    // the neighbour square [128, 256] with a vertex at the middle of the shared border x = 128
    const baked = {
      vertices: [
        [128, 0, 0],
        [256, 0, 0],
        [256, 128, 0],
        [128, 128, 0],
        [128, 64, 0],
      ] as Vec3[],
      triangles: [
        [0, 1, 4],
        [4, 1, 2],
        [4, 2, 3],
      ] as TriangleIndices[],
    };
    const r = mergeNavMesh(existing(), baked, 0x01000d62);
    // the existing border triangle (0, 1, 2) was split at (128, 64): one more triangle
    expect(r.nav.triangles).toHaveLength(2 + 3 + 1);
    expect(r.nav.triangles[0]!.flags & 0x0400).toBe(0x0400); // its door flag kept
    expect(r.nav.doorLinks).toEqual([{ triangle: 0, crc: 0x12345678, door: 0x01000d70 }]);
    expect(r.nav.triangles[1]!.vertices).toEqual([0, 2, 3]); // untouched triangle, same index
    // welded: no duplicate of the shared corners, and every triangle reached from the others
    expect(r.nav.vertices).toHaveLength(4 + 2 + 1);
    const adj = triangleAdjacency(r.nav.triangles.map((t) => t.vertices));
    const seen = new Set([0]);
    const queue = [0];
    while (queue.length) {
      for (const n of adj[queue.pop()!]!) {
        if (n < 0 || seen.has(n)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    expect(seen.size).toBe(r.nav.triangles.length);
    expect(r.unlinked).toHaveLength(0);
  });

  it('never splits a triangle linked to another NavMesh', () => {
    const nav = existing();
    nav.triangles[0]!.flags |= 0x0002; // edge 1 (1-2, on x = 128) is an edge link
    nav.triangles[0]!.edges[1] = 0;
    nav.edgeLinks.push({ type: 0, navMesh: 0x000f1234, triangle: 5 });
    const r = mergeNavMesh(
      nav,
      {
        vertices: [
          [128, 0, 0],
          [256, 0, 0],
          [128, 64, 0],
        ],
        triangles: [[0, 1, 2]],
      },
      0x01000d62,
    );
    expect(r.nav.triangles[0]!.vertices).toEqual([0, 1, 2]);
    expect(r.nav.triangles[0]!.edges[1]).toBe(0); // its link kept
  });
});

describe('bake beside an existing NavMesh', () => {
  it('leaves out the area the existing triangles cover', () => {
    const nav = existing();
    const exclude = nav.triangles.map((t) => t.vertices.map((v) => nav.vertices[v]!)) as [
      Vec3,
      Vec3,
      Vec3,
    ][];
    // a tile spanning both the covered cell and the next one
    const r = bake(
      [
        {
          key: 'T',
          rings: [
            [
              [0, 0, 0],
              [256, 0, 0],
              [256, 128, 0],
              [0, 128, 0],
            ],
          ],
          pos: [0, 0, 0],
          heading: 0,
        },
      ],
      {},
      { origin: [0, 0], cell: 128 },
      exclude,
    );
    expect(r.triangles).toHaveLength(2); // the free cell only
    expect(Math.min(...r.vertices.map((v) => v[0]))).toBe(128);
  });
});

describe('removeTriangles', () => {
  it('renumbers the rest, its door links and cover, and drops unused vertices', () => {
    // two squares side by side: triangles 0, 1 in [0, 128], 2, 3 in [128, 256]
    const nav = buildNavMesh(
      0x01000d62,
      [
        [0, 0, 0],
        [128, 0, 0],
        [128, 128, 0],
        [0, 128, 0],
        [256, 0, 0],
        [256, 128, 0],
      ],
      [
        [0, 1, 2],
        [0, 2, 3],
        [1, 4, 5],
        [1, 5, 2],
      ],
    );
    nav.doorLinks.push({ triangle: 0, crc: 1, door: 2 }, { triangle: 3, crc: 3, door: 4 });
    nav.cover.push(1, 2);
    const inFirst = trianglesInTiles(nav, [{ key: 'A', cells: [[0, 0, 0]] }], GRID);
    expect(inFirst).toEqual([0, 1]);
    const r = removeTriangles(nav, inFirst);
    expect(r.triangles).toHaveLength(2);
    expect(r.vertices).toEqual([
      [128, 0, 0],
      [128, 128, 0],
      [256, 0, 0],
      [256, 128, 0],
    ]);
    expect(r.doorLinks).toEqual([{ triangle: 1, crc: 3, door: 4 }]);
    expect(r.cover).toEqual([0]);
    // the remaining pair still neighbours each other; the removed side is a border now
    expect(r.triangles[0]!.edges.filter((e) => e === 1)).toHaveLength(1);
    expect(r.triangles.flatMap((t) => t.edges).filter((e) => e >= 2)).toHaveLength(0);
    expect(decodeNvnm(encodeNvnm(r))).toEqual(r);
  });
});

describe('coveredTiles with shifted pieces (D70)', () => {
  it('finds a tile shifted by the fine step on its own grid', () => {
    const nav = buildNavMesh(
      1,
      [
        [20, 4, 0],
        [40, 4, 0],
        [30, 60, 0],
      ],
      [[0, 1, 2]],
    );
    const grid = { origin: [0, 0, 0] as [number, number, number], module: { xy: 128, z: 128 } };
    // a tile at x from 16 to 144 (shifted by 16) holds the centre (30, 22.7)
    const shifted = [{ key: 's', cells: [[0.125, 0, 0]] as [number, number, number][] }];
    expect([...coveredTiles(nav, shifted, grid)]).toEqual(['s']);
    // shifted by 64 the other way it does not
    const away = [{ key: 'a', cells: [[0.5, 0, 0]] as [number, number, number][] }];
    expect([...coveredTiles(nav, away, grid)]).toEqual([]);
  });
});
