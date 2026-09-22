/**
 * Synthetic kit-like meshes for tests: a corridor box open at both ends, with the same
 * proportions as the Imperial small hall (256 x 256 tile, opening 192 wide, ceiling at 300).
 */
import type { MergedMesh } from '../format/nif/geometry';

interface Builder {
  positions: number[];
  indices: number[];
}

const SUBDIV = 8;

/** A bilinear quad subdivided SUBDIV x SUBDIV so its edges carry enough vertices for the
 * opening heuristics (which expect real kit meshes, dense along their rims). */
function quad(b: Builder, p: [number, number, number][]): void {
  const base = b.positions.length / 3;
  const n = SUBDIV;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const s = i / n;
      const t = j / n;
      for (let a = 0; a < 3; a++) {
        const v =
          (1 - s) * (1 - t) * p[0]![a]! +
          s * (1 - t) * p[1]![a]! +
          s * t * p[2]![a]! +
          (1 - s) * t * p[3]![a]!;
        b.positions.push(v);
      }
    }
  }
  const at = (i: number, j: number) => base + i * (n + 1) + j;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      b.indices.push(
        at(i, j),
        at(i + 1, j),
        at(i + 1, j + 1),
        at(i, j),
        at(i + 1, j + 1),
        at(i, j + 1),
      );
    }
  }
}

/**
 * A straight corridor along Y: floor and ceiling from y0 to y1, walls at x = +-halfWidth,
 * ceiling trim strips outside the walls up to x = +-halfTile. Open at both Y ends.
 */
export function corridorMesh(
  options: {
    y0?: number;
    y1?: number;
    halfWidth?: number;
    halfTile?: number;
    floorZ?: number;
    ceilingZ?: number;
    /** Shift the exit end (y1) sideways by this much, keeping the entrance centred. */
    jog?: number;
  } = {},
): MergedMesh {
  const {
    y0 = -128,
    y1 = 128,
    halfWidth = 96,
    halfTile = 128,
    floorZ = 8,
    ceilingZ = 300,
    jog = 0,
  } = options;
  const b: Builder = { positions: [], indices: [] };
  const x = (side: -1 | 1, y: number) => side * halfWidth + (jog * (y - y0)) / (y1 - y0);
  // floor (split in two quads so the jog stays planar enough for a test)
  quad(b, [
    [x(-1, y0), y0, floorZ],
    [x(1, y0), y0, floorZ],
    [x(1, y1), y1, floorZ],
    [x(-1, y1), y1, floorZ],
  ]);
  // ceiling
  quad(b, [
    [x(-1, y0), y0, ceilingZ],
    [x(-1, y1), y1, ceilingZ],
    [x(1, y1), y1, ceilingZ],
    [x(1, y0), y0, ceilingZ],
  ]);
  // walls
  for (const side of [-1, 1] as const) {
    quad(b, [
      [x(side, y0), y0, floorZ],
      [x(side, y1), y1, floorZ],
      [x(side, y1), y1, ceilingZ],
      [x(side, y0), y0, ceilingZ],
    ]);
    // ceiling trim strip on the outside of the wall, reaching the tile edge (closed side)
    quad(b, [
      [x(side, y0), y0, ceilingZ + 10],
      [side * halfTile + (side > 0 ? jog : 0), y0, ceilingZ + 10],
      [side * halfTile + (side > 0 ? jog : 0), y1, ceilingZ + 10],
      [x(side, y1), y1, ceilingZ + 10],
    ]);
  }
  const positions = Float32Array.from(b.positions);
  const indices = Uint32Array.from(b.indices);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a]!, positions[i + a]!);
      max[a] = Math.max(max[a]!, positions[i + a]!);
    }
  }
  return {
    positions,
    indices,
    ranges: [{ name: 'Corridor', start: 0, count: indices.length, alpha: false }],
    min,
    max,
  };
}
