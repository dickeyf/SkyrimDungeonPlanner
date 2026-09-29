import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../catalogue/types';
import type { Piece } from '../catalogue/types';
import { simplifyRing, tileFrame, traceRings, walkablePolygons } from './walkable';

/** Collision soup built from quads (two triangles each, wound as given). */
class Soup {
  positions: number[] = [];
  indices: number[] = [];
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3): this {
    const base = this.positions.length / 3;
    this.positions.push(...a, ...b, ...c, ...d);
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return this;
  }
  /** Vertical wall along a segment, from z0 to z1. */
  wall(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number): this {
    return this.quad([x0, y0, z0], [x1, y1, z0], [x1, y1, z1], [x0, y0, z1]);
  }
  get mesh(): [Float32Array, Uint32Array] {
    return [new Float32Array(this.positions), new Uint32Array(this.indices)];
  }
}

/**
 * A hallway 200 wide (x) and 256 long (y), open at both ends: floor at z 10, walls at x = +-100,
 * ceiling at z 300 facing down.
 */
function hallway(): Soup {
  return new Soup()
    .quad([-100, -128, 10], [100, -128, 10], [100, 128, 10], [-100, 128, 10])
    .quad([-100, -128, 300], [-100, 128, 300], [100, 128, 300], [100, -128, 300])
    .wall(-100, -128, -100, 128, 10, 300)
    .wall(100, 128, 100, -128, 10, 300);
}

function area(ring: readonly Vec3[]): number {
  let a = 0;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  });
  return a / 2;
}

describe('walkablePolygons', () => {
  it('keeps the floor away from the walls, open at the ends', () => {
    const { rings } = walkablePolygons(...hallway().mesh, { actorRadius: 24, step: 4 });
    expect(rings).toHaveLength(1);
    const ring = rings[0]!;
    expect(area(ring)).toBeGreaterThan(0); // outer ring counter-clockwise
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-100 + 24);
    expect(Math.min(...xs)).toBeLessThan(-100 + 24 + 8);
    expect(Math.max(...xs)).toBeLessThanOrEqual(100 - 24);
    expect(Math.min(...ys)).toBe(-128); // not eroded at the open ends
    expect(Math.max(...ys)).toBe(128);
    expect(ring.every((p) => Math.abs(p[2] - 10) < 1e-3)).toBe(true);
    expect(ring.length).toBeLessThanOrEqual(8);
  });

  it('cuts a hole around a pillar and skips the pillar top', () => {
    const soup = hallway()
      .wall(-10, -10, 10, -10, 10, 300)
      .wall(10, -10, 10, 10, 10, 300)
      .wall(10, 10, -10, 10, 10, 300)
      .wall(-10, 10, -10, -10, 10, 300);
    const { rings } = walkablePolygons(...soup.mesh, { actorRadius: 20, step: 4 });
    expect(rings).toHaveLength(2);
    const hole = rings.find((r) => area(r) < 0)!;
    expect(hole).toBeDefined();
    expect(Math.max(...hole.map((p) => p[0]))).toBeGreaterThanOrEqual(10 + 20 - 4);
  });

  it('drops an enclosed area that does not reach the tile edge', () => {
    // A closed box inside the hallway's wall zone: floor, ceiling and four walls.
    const soup = hallway()
      .quad([-40, -40, 150], [40, -40, 150], [40, 40, 150], [-40, 40, 150])
      .quad([-40, -40, 280], [-40, 40, 280], [40, 40, 280], [40, -40, 280])
      .wall(-40, -40, 40, -40, 150, 280)
      .wall(40, -40, 40, 40, 150, 280)
      .wall(40, 40, -40, 40, 150, 280)
      .wall(-40, 40, -40, -40, 150, 280);
    const { rings } = walkablePolygons(...soup.mesh, { actorRadius: 8, step: 4 });
    expect(rings.every((r) => r.every((p) => p[2] < 100))).toBe(true);
  });

  it('grows from the openings of the tile frame', () => {
    // Floor at 10.3 (not exact in float32); footprint 2 x 2 cells of 128, open at -Y and +Y.
    const soup = new Soup()
      .quad([-100, -128, 10.3], [100, -128, 10.3], [100, 128, 10.3], [-100, 128, 10.3])
      .quad([-128, -128, 300], [-128, 128, 300], [128, 128, 300], [128, -128, 300])
      .wall(-100, -128, -100, 128, 0, 300)
      .wall(100, 128, 100, -128, 0, 300);
    const piece = {
      pivot: [128, 128, 0],
      cells: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
      ],
      faces: [
        { cell: [0, 0, 0], dir: '-Y', conn: 'a' },
        { cell: [1, 0, 0], dir: '-Y', conn: 'a' },
        { cell: [0, 1, 0], dir: '+Y', conn: 'a' },
        { cell: [1, 1, 0], dir: '+Y', conn: 'a' },
      ],
    } as unknown as Piece;
    const frame = tileFrame(piece, { xy: 128, z: 128 });
    expect(frame.min).toEqual([-128, -128]);
    expect(frame.openings).toHaveLength(4);
    const { rings } = walkablePolygons(...soup.mesh, { actorRadius: 16 }, frame);
    expect(rings).toHaveLength(1);
    expect(Math.min(...rings[0]!.map((p) => p[1]))).toBe(-128);
    expect(Math.max(...rings[0]!.map((p) => p[0]))).toBeLessThanOrEqual(100 - 16);
  });

  it('ignores floors with no ceiling above (tops of walls, roofs)', () => {
    const soup = new Soup().quad([0, 0, 0], [200, 0, 0], [200, 200, 0], [0, 200, 0]);
    expect(walkablePolygons(...soup.mesh).rings).toHaveLength(0);
  });

  it('steps over low obstacles but not high ones', () => {
    const low = hallway().quad([-100, -20, 20], [100, -20, 20], [100, 20, 20], [-100, 20, 20]);
    expect(walkablePolygons(...low.mesh, { stepHeight: 24 }).rings).toHaveLength(1);
    const high = hallway().quad([-100, -20, 60], [100, -20, 60], [100, 20, 60], [-100, 20, 60]);
    // A slab at 60 is a floor (headroom above it) the hallway cannot pass under.
    const rings = walkablePolygons(...high.mesh, { stepHeight: 24, actorHeight: 96 }).rings;
    expect(rings.length).toBeGreaterThan(1);
  });
});

describe('traceRings', () => {
  it('outlines a block counter-clockwise and a hole clockwise', () => {
    // 3 x 3 cells with the centre missing.
    const mask = new Uint8Array([1, 1, 1, 1, 0, 1, 1, 1, 1]);
    const rings = traceRings(mask, 3, 3);
    expect(rings).toHaveLength(2);
    const signed = rings.map((r) =>
      r.reduce((a, p, i) => {
        const q = r[(i + 1) % r.length]!;
        return a + p[0] * q[1] - q[0] * p[1];
      }, 0),
    );
    expect(signed.sort((a, b) => a - b)).toEqual([-2, 18]);
  });
});

describe('simplifyRing', () => {
  it('drops points within the tolerance', () => {
    const ring: [number, number][] = [
      [0, 0],
      [5, 0.5],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(simplifyRing(ring, 1)).toHaveLength(4);
  });
});
