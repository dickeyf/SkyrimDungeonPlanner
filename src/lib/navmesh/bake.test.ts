import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../catalogue/types';
import { bake, dropSmallIslands, splitEdges, type BakeTile } from './bake';
import { buildNavMesh, triangleAdjacency } from './build';

/** A counter-clockwise rectangle ring at height z (z1 at the +Y side for a ramp). */
function rect(x0: number, x1: number, y0: number, y1: number, z = 0, z1 = z): Vec3[] {
  return [
    [x0, y0, z],
    [x1, y0, z],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
}

const tile = (key: string, rings: Vec3[][], pos: Vec3 = [0, 0, 0], heading = 0): BakeTile => ({
  key,
  rings,
  pos,
  heading,
});

/** Whether some triangle of tile `a` shares an edge with a triangle of tile `b`. */
function joined(r: ReturnType<typeof bake>, a: string, b: string): boolean {
  const adj = triangleAdjacency(r.triangles);
  return adj.some(
    (edges, t) => r.tileOf[t] === a && edges.some((n) => n >= 0 && r.tileOf[n] === b),
  );
}

describe('splitEdges', () => {
  it('inserts the points lying on an edge, in order, with an interpolated height', () => {
    const ring = rect(0, 100, 0, 10, 0, 10);
    const out = splitEdges(
      ring,
      [
        [70, 0, 0],
        [30, 0, 0],
        [50, 5, 0],
        [50, 10, 0],
      ],
      0.5,
    );
    expect(out.slice(0, 4)).toEqual([
      [0, 0, 0],
      [30, 0, 0],
      [70, 0, 0],
      [100, 0, 0],
    ]);
    expect(out).toContainEqual([50, 10, 10]);
    expect(out).toHaveLength(7); // (50, 5) lies inside, on no edge;
  });
});

describe('bake', () => {
  it('joins two hallway tiles into one continuous mesh', () => {
    const r = bake([
      tile('A', [rect(-60, 60, -128, 128)]),
      tile('B', [rect(-60, 60, -128, 128)], [0, 256, 0]),
    ]);
    expect(r.vertices).toHaveLength(6); // the two shared corners are welded
    expect(r.triangles).toHaveLength(4);
    expect(joined(r, 'A', 'B')).toBe(true);
    expect(() => buildNavMesh(1, r.vertices, r.triangles)).not.toThrow();
  });

  it('cuts along the grid: a full cell is two triangles, cells join', () => {
    // a 2 x 2 cell floor square, then a hall one cell wide going on from its top-left cell
    const r = bake(
      [tile('A', [rect(0, 256, 0, 256)]), tile('B', [rect(-64, 64, -128, 128)], [64, 384, 0])],
      {},
      { origin: [0, 0], cell: 128 },
    );
    expect(r.triangles).toHaveLength(4 * 2 + 2 * 2); // two per cell
    expect(joined(r, 'A', 'B')).toBe(true);
    expect(() => buildNavMesh(1, r.vertices, r.triangles)).not.toThrow();
  });

  it('merges tiles overlapping in a cell instead of stacking their triangles', () => {
    // B's floor reaches 64 units into A's cells (a nested piece, a door's floor patch)
    const r = bake(
      [tile('A', [rect(0, 128, 0, 256)]), tile('B', [rect(64, 256, 0, 256)])],
      {},
      { origin: [0, 0], cell: 128 },
    );
    expect(() => buildNavMesh(1, r.vertices, r.triangles)).not.toThrow();
    expect(r.triangles).toHaveLength(4 * 2); // the 2 x 2 cells, two triangles each
  });

  it('leaves no flat triangle and no edge shared by three, with collinear border points', () => {
    // three tiles meeting on a cell line: the middle one's vertices land on the others' edges
    const r = bake(
      [
        tile('A', [rect(0, 128, 0, 256)]),
        tile('B', [rect(128, 256, 36, 76)]),
        tile('C', [rect(128, 256, 76, 256)]),
        tile('D', [rect(128, 256, 0, 36)]),
      ],
      {},
      { origin: [0, 0], cell: 128 },
    );
    expect(() => buildNavMesh(1, r.vertices, r.triangles)).not.toThrow();
    for (const t of r.triangles) {
      const [a, b, c] = t.map((i) => r.vertices[i]!) as [Vec3, Vec3, Vec3];
      expect(
        Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])),
      ).toBeGreaterThan(1);
    }
    expect(joined(r, 'A', 'B') && joined(r, 'A', 'C')).toBe(true);
  });

  it('conforms a narrower opening to the wider one (R11)', () => {
    const r = bake([
      tile('A', [rect(-60, 60, -128, 128)]),
      tile('B', [rect(-30, 30, -128, 128)], [0, 256, 0]),
    ]);
    expect(r.vertices).toContainEqual([-30, 128, 0]);
    expect(joined(r, 'A', 'B')).toBe(true);
    // the rest of A's wider border stays a border: no edge is shared by three triangles
    expect(() => triangleAdjacency(r.triangles)).not.toThrow();
  });

  it('places turned tiles, keeping the triangles counter-clockwise', () => {
    // B's ring runs along +X in its own frame; turned 90 degrees clockwise it runs along -Y
    const r = bake([
      tile('A', [rect(-60, 60, -128, 128)]),
      tile('B', [rect(-128, 128, -60, 60)], [0, -256, 0], Math.PI / 2),
    ]);
    expect(joined(r, 'A', 'B')).toBe(true);
    for (const t of r.triangles) {
      const [a, b, c] = t.map((i) => r.vertices[i]!) as [Vec3, Vec3, Vec3];
      expect((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).toBeGreaterThan(0);
    }
  });

  it('leaves the holes out', () => {
    const hole = rect(-10, 10, -10, 10).reverse();
    const r = bake([tile('A', [rect(-60, 60, -60, 60), hole])]);
    const centroids = r.triangles.map((t) =>
      [0, 1].map((k) => t.reduce((s, i) => s + r.vertices[i]![k]!, 0) / 3),
    );
    expect(centroids.some(([x, y]) => Math.abs(x!) < 10 && Math.abs(y!) < 10)).toBe(false);
    expect(r.triangles.length).toBeGreaterThanOrEqual(8);
  });

  it('keeps the heights of a ramp', () => {
    const r = bake([
      tile('A', [rect(-60, 60, -128, 128, 0, 64)]),
      tile('B', [rect(-60, 60, -128, 128)], [0, 256, 64]),
    ]);
    expect(joined(r, 'A', 'B')).toBe(true);
    expect(Math.max(...r.vertices.map((v) => v[2]))).toBe(64);
    expect(r.vertices.filter((v) => v[1] === 128).every((v) => v[2] === 64)).toBe(true);
  });
});

describe('bake triangle quality', () => {
  it('flips ear-clipping fans into Delaunay triangles within a tile', () => {
    // a long hall with many vertices along both walls (as conformed borders and notches give)
    const ring: Vec3[] = [];
    // small notches: every other wall vertex sits 4 units in, so none is collinear
    for (let x = -60; x <= 60; x += 20) ring.push([x, -300 + ((x + 60) % 40 ? 4 : 0), 0]);
    for (let x = 60; x >= -60; x -= 20) ring.push([x, 300 - ((x + 60) % 40 ? 4 : 0), 0]);
    ring.splice(7, 0, [60, 0, 0]);
    ring.push([-60, 0, 0]);
    const r = bake([tile('A', [ring])]);
    // Delaunay: no vertex of a neighbouring triangle lies inside a triangle's circumcircle
    const adj = triangleAdjacency(r.triangles);
    r.triangles.forEach((t, i) => {
      const [a, b, c] = t.map((k) => r.vertices[k]!) as [Vec3, Vec3, Vec3];
      const ux = b[0] - a[0],
        uy = b[1] - a[1],
        vx = c[0] - a[0],
        vy = c[1] - a[1];
      const d = 2 * (ux * vy - uy * vx);
      const cx = a[0] + (vy * (ux * ux + uy * uy) - uy * (vx * vx + vy * vy)) / d;
      const cy = a[1] + (ux * (vx * vx + vy * vy) - vx * (ux * ux + uy * uy)) / d;
      const radius = Math.hypot(a[0] - cx, a[1] - cy);
      for (const n of adj[i]!) {
        if (n < 0) continue;
        for (const k of r.triangles[n]!) {
          if (t.includes(k)) continue;
          const p = r.vertices[k]!;
          expect(Math.hypot(p[0] - cx, p[1] - cy)).toBeGreaterThanOrEqual(radius - 1e-6);
        }
      }
    });
    expect(r.triangles).toHaveLength(r.vertices.length - 2); // one polygon, no hole
  });
});

describe('dropSmallIslands', () => {
  const floor = () =>
    bake(
      [tile('A', [rect(0, 256, 0, 256)]), tile('B', [rect(0, 32, 0, 32)], [512, 0, 64])],
      {},
      { origin: [0, 0], cell: 128 },
    );

  it('leaves out a small group of triangles apart from the rest', () => {
    const r = dropSmallIslands(floor(), 128 * 128);
    expect(new Set(r.tileOf)).toEqual(new Set(['A']));
    expect(r.vertices.every((p) => p[0] <= 256)).toBe(true);
    expect(() => buildNavMesh(1, r.vertices, r.triangles)).not.toThrow();
  });

  it('keeps an island touching a NavMesh already there', () => {
    const r = dropSmallIslands(floor(), 128 * 128, (p) => p[0] >= 512);
    expect(new Set(r.tileOf)).toEqual(new Set(['A', 'B']));
  });
});
