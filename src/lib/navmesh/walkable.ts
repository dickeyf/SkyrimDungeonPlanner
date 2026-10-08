/**
 * Walkable polygons of a tile from its collision mesh (V2 step 4, R4, D38).
 *
 * The collision is sampled on a fine grid over the tile's footprint in plan (its grid cells, see
 * `tileFrame`), or over the collision's bounding box when no footprint is given:
 *
 * 1. every triangle facing up (slope within `maxSlope`, or steeper but no taller than a step) is
 *    a floor candidate at its height; every other triangle occupies heights: sloped or horizontal
 *    ones at their height under each sample, near-vertical ones (walls) along the band their plan
 *    outline covers;
 * 2. a floor candidate is valid when it leaves `actorHeight` free above it (obstacles lower than
 *    `stepHeight` are stepped over) and has a ceiling above it, which excludes the tops of walls
 *    and roofs;
 * 3. floors are grown from the tile's openings (from the edge without openings), each sample
 *    taking the valid floor closest to its neighbour's within a step: what cannot be reached,
 *    such as a cavity inside a thick wall or a floor enclosed under a staircase, stays out;
 * 4. neighbouring samples whose floors differ by more than `stepHeight` form a ledge; the walkable
 *    area is eroded by `actorRadius` away from obstacles, voids and ledges, but not away
 *    from the edge of the footprint, where the floor continues into the neighbouring tile;
 * 5. its outline is traced (marching squares), snapped to the footprint where it touches it,
 *    simplified (Douglas-Peucker) and lifted to the floor height.
 *
 * Output: rings in piece space, outer rings counter-clockwise and holes clockwise seen from above.
 */
import type { CellIndex, FaceDir, Piece, Vec3 } from '../catalogue/types';

export interface WalkableOptions {
  /** Sample spacing, units. */
  step: number;
  actorRadius: number;
  actorHeight: number;
  /** Obstacles up to this height above the floor do not block. */
  stepHeight: number;
  /** Steepest walkable slope, radians. */
  maxSlope: number;
  /** Douglas-Peucker tolerance of the outline, units. */
  tolerance: number;
}

/**
 * Tuned on the Imperial tiles (V2 step 4): the stairs are a ramp under step blocks whose fronts
 * rise 52 above it, so the step height is 64; a tolerance of 6 keeps the outlines straight.
 */
export const DEFAULT_WALKABLE_OPTIONS: WalkableOptions = {
  step: 4,
  actorRadius: 16,
  actorHeight: 96,
  stepHeight: 64,
  maxSlope: (50 * Math.PI) / 180,
  tolerance: 6,
};

export interface WalkableResult {
  rings: Vec3[][];
  /** Sampling grid, for display: floor height per sample, NaN where not walkable. */
  grid: { x0: number; y0: number; step: number; nx: number; ny: number; floor: Float32Array };
}

/** An open face of a tile: where actors enter it, in plan, and the floor heights it serves. */
export interface TileOpening {
  a: [number, number];
  b: [number, number];
  zMin: number;
  zMax: number;
}

/** A tile's footprint rectangle and openings, in piece space. */
export interface TileFrame {
  min: [number, number];
  max: [number, number];
  openings: TileOpening[];
}

/**
 * Footprint and openings of a catalogue tile at rotation 0: cell (i, j, k) spans
 * [-pivot + (i, j, k) * module, + module]; an open face lies on the matching side of its cell and
 * serves floors within half a level of that level's bottom.
 */
export function tileFrame(piece: Piece, module: { xy: number; z: number }): TileFrame {
  const [px, py, pz] = piece.pivot;
  const m = module.xy;
  const x = (i: number) => -px + i * m;
  const y = (j: number) => -py + j * m;
  const min: [number, number] = [
    Math.min(...piece.cells.map((c) => x(c[0]))),
    Math.min(...piece.cells.map((c) => y(c[1]))),
  ];
  const max: [number, number] = [
    Math.max(...piece.cells.map((c) => x(c[0] + 1))),
    Math.max(...piece.cells.map((c) => y(c[1] + 1))),
  ];
  const side = ([i, j]: CellIndex, dir: FaceDir): [[number, number], [number, number]] | null => {
    switch (dir) {
      case '+X':
        return [
          [x(i + 1), y(j)],
          [x(i + 1), y(j + 1)],
        ];
      case '-X':
        return [
          [x(i), y(j)],
          [x(i), y(j + 1)],
        ];
      case '+Y':
        return [
          [x(i), y(j + 1)],
          [x(i + 1), y(j + 1)],
        ];
      case '-Y':
        return [
          [x(i), y(j)],
          [x(i + 1), y(j)],
        ];
      default:
        return null;
    }
  };
  const openings: TileOpening[] = [];
  for (const face of piece.faces) {
    const seg = side(face.cell, face.dir);
    if (!seg) continue;
    const bottom = -pz + face.cell[2] * module.z;
    openings.push({
      a: seg[0],
      b: seg[1],
      zMin: bottom - module.z / 2,
      zMax: bottom + module.z / 2,
    });
  }
  return { min, max, openings };
}

interface Span {
  lo: number;
  hi: number;
}

/**
 * What the walkable analysis takes a collision triangle for (the 3D view of the Walkable tab
 * shows it): `floor` (flat enough, or a steep face leaning back no taller than a step, not
 * nearly vertical), `ceiling` (turned down), `wall` (nearly vertical: blocks its height band),
 * `lowWall` (a wall no taller than a step, which the actor steps over), `soffit` (nearly vertical
 * and turned down: a wall that also roofs what is under it), `obstacle` (too steep to walk, not a
 * wall). Null for a degenerate triangle.
 */
export type FaceKind = 'floor' | 'ceiling' | 'wall' | 'lowWall' | 'soffit' | 'obstacle';

const WALL_NZ = 0.2;

export function faceKind(
  a: Vec3,
  b: Vec3,
  c: Vec3,
  options: Partial<WalkableOptions> = {},
): FaceKind | null {
  const o = { ...DEFAULT_WALKABLE_OPTIONS, ...options };
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nX = uy * vz - uz * vy;
  const nY = uz * vx - ux * vz;
  const nZ = ux * vy - uy * vx;
  const len = Math.hypot(nX, nY, nZ);
  if (len === 0) return null;
  const nz = nZ / len;
  const height = Math.max(a[2], b[2], c[2]) - Math.min(a[2], b[2], c[2]);
  if (Math.abs(nz) < WALL_NZ) {
    if (nz < 0) return 'soffit';
    return height <= o.stepHeight ? 'lowWall' : 'wall';
  }
  // A steep face no taller than a step (a bevel, a sloped riser) is stepped onto like a floor.
  if (nz >= Math.cos(o.maxSlope) || (nz > 0 && height <= o.stepHeight)) return 'floor';
  return nz <= -WALL_NZ ? 'ceiling' : 'obstacle';
}

export function walkablePolygons(
  positions: Float32Array,
  indices: Uint32Array,
  options: Partial<WalkableOptions> = {},
  frame?: TileFrame,
): WalkableResult {
  const o = { ...DEFAULT_WALKABLE_OPTIONS, ...options };
  const s = o.step;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  if (frame) {
    [minX, minY] = frame.min;
    [maxX, maxY] = frame.max;
  } else {
    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]!);
      maxX = Math.max(maxX, positions[i]!);
      minY = Math.min(minY, positions[i + 1]!);
      maxY = Math.max(maxY, positions[i + 1]!);
    }
  }
  const nx = Math.max(1, Math.round((maxX - minX) / s));
  const ny = Math.max(1, Math.round((maxY - minY) / s));
  const sx = (maxX - minX) / nx;
  const sy = (maxY - minY) / ny;
  // Sample (i, j) sits at the centre of its square.
  const cx = (i: number) => minX + (i + 0.5) * sx;
  const cy = (j: number) => minY + (j + 0.5) * sy;

  const floors: number[][] = Array.from({ length: nx * ny }, () => []);
  const ceilings: number[][] = Array.from({ length: nx * ny }, () => []);
  const spans: Span[][] = Array.from({ length: nx * ny }, () => []);

  const p = (k: number): Vec3 => [positions[k * 3]!, positions[k * 3 + 1]!, positions[k * 3 + 2]!];
  for (let t = 0; t < indices.length; t += 3) {
    const a = p(indices[t]!);
    const b = p(indices[t + 1]!);
    const c = p(indices[t + 2]!);
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const nX = uy * vz - uz * vy;
    const nY = uz * vx - ux * vz;
    const nZ = ux * vy - uy * vx;
    const kind = faceKind(a, b, c, o);
    if (!kind) continue;
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - minX) / sx - 0.5));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(a[0], b[0], c[0]) - minX) / sx - 0.5));
    const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1], c[1]) - minY) / sy - 0.5));
    const j1 = Math.min(ny - 1, Math.ceil((Math.max(a[1], b[1], c[1]) - minY) / sy - 0.5));

    if (kind === 'wall' || kind === 'lowWall' || kind === 'soffit') {
      // Wall: mark its height band on every sample within half a sample of its plan outline.
      const lo = Math.min(a[2], b[2], c[2]);
      const hi = Math.max(a[2], b[2], c[2]);
      const reach = Math.hypot(sx, sy) / 2;
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          if (distanceToTriangle2d(cx(i), cy(j), a, b, c) <= reach) {
            spans[j * nx + i]!.push({ lo, hi });
            // a steep face turned down (an arch's soffit) roofs what is under it, at its height
            // over the sample (its plane there, within the face's own heights)
            if (kind === 'soffit') {
              const z = a[2] - (nX * (cx(i) - a[0]) + nY * (cy(j) - a[1])) / nZ;
              ceilings[j * nx + i]!.push(Math.min(hi, Math.max(lo, z)));
            }
          }
        }
      continue;
    }
    const det = ux * vy - uy * vx;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const px = cx(i) - a[0];
        const py = cy(j) - a[1];
        const l1 = (px * vy - py * vx) / det;
        const l2 = (ux * py - uy * px) / det;
        if (l1 < -1e-4 || l2 < -1e-4 || l1 + l2 > 1 + 1e-4) continue;
        const z = a[2] + l1 * uz + l2 * vz;
        const k = j * nx + i;
        if (kind === 'floor') floors[k]!.push(z);
        else if (kind === 'ceiling') ceilings[k]!.push(z);
        else spans[k]!.push({ lo: z, hi: z });
      }
  }

  // 2. Floor height per sample. The ceiling test looks at the highest ceiling of the sample and
  // its 8 neighbours: a sample right under the seam between two ceiling faces hits neither.
  const topCeiling = new Float32Array(nx * ny).fill(-Infinity);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      let top = -Infinity;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
          for (const z of ceilings[jj * nx + ii]!) top = Math.max(top, z);
        }
      topCeiling[j * nx + i] = top;
    }
  const valid: number[][] = floors.map((candidates, k) =>
    candidates
      .sort((x, y) => x - y)
      .filter((z) => {
        const clear = (lo: number, hi: number) => hi <= z + o.stepHeight || lo >= z + o.actorHeight;
        return (
          candidates.every((f) => clear(f, f)) &&
          ceilings[k]!.every((f) => clear(f, f)) &&
          spans[k]!.every((sp) => clear(sp.lo, sp.hi)) &&
          topCeiling[k]! >= z + o.actorHeight
        );
      }),
  );

  // Floors are grown from the entry samples (on an opening, at its level; the edge without
  // openings): each neighbour takes its valid floor closest in height, within a step. Walking up
  // a staircase follows the steps, never a floor enclosed under them.
  const reach = Math.max(sx, sy);
  const entryFloor = (i: number, j: number): number | undefined => {
    const list = valid[j * nx + i]!;
    if (!frame || frame.openings.length === 0)
      return i === 0 || j === 0 || i === nx - 1 || j === ny - 1 ? list[0] : undefined;
    const near = frame.openings.filter(
      (op) => distanceToSegment(cx(i), cy(j), op.a, op.b) <= reach,
    );
    return list.find((z) => near.some((op) => z >= op.zMin && z <= op.zMax));
  };
  const floor = new Float32Array(nx * ny).fill(NaN);
  const queue: number[] = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const z = entryFloor(i, j);
      if (z === undefined) continue;
      floor[j * nx + i] = z;
      queue.push(j * nx + i);
    }
  while (queue.length > 0) {
    const k = queue.shift()!;
    const z = floor[k]!;
    const i = k % nx;
    const next: number[] = [];
    if (i > 0) next.push(k - 1);
    if (i < nx - 1) next.push(k + 1);
    if (k >= nx) next.push(k - nx);
    if (k < (ny - 1) * nx) next.push(k + nx);
    for (const n of next) {
      if (!Number.isNaN(floor[n]!)) continue;
      let best: number | undefined;
      for (const c of valid[n]!)
        if (
          Math.abs(c - z) <= o.stepHeight &&
          (best === undefined || Math.abs(c - z) < Math.abs(best - z))
        )
          best = c;
      if (best === undefined) continue;
      floor[n] = best;
      queue.push(n);
    }
  }

  // Ledges: a sample whose floor is more than a step above or below a neighbour's blocks, so
  // two floors at different heights never join (a ramp rises by far less than a step per sample).
  const ledge = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const z = floor[j * nx + i]!;
      if (Number.isNaN(z)) continue;
      for (const [di, dj] of [
        [1, 0],
        [0, 1],
      ] as const) {
        if (i + di >= nx || j + dj >= ny) continue;
        const k2 = (j + dj) * nx + i + di;
        const z2 = floor[k2]!;
        if (!Number.isNaN(z2) && Math.abs(z2 - z) > o.stepHeight) {
          ledge[j * nx + i] = 1;
          ledge[k2] = 1;
        }
      }
    }

  // 4. Erosion: distance (in units) to the nearest blocked sample, two-pass chamfer.
  const dist = new Float32Array(nx * ny);
  for (let k = 0; k < nx * ny; k++) dist[k] = Number.isNaN(floor[k]!) || ledge[k] ? 0 : Infinity;
  const diag = Math.hypot(sx, sy);
  const relax = (k: number, from: number, d: number) => {
    const v = dist[from]! + d;
    if (v < dist[k]!) dist[k] = v;
  };
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (i > 0) relax(k, k - 1, sx);
      if (j > 0) relax(k, k - nx, sy);
      if (i > 0 && j > 0) relax(k, k - nx - 1, diag);
      if (i < nx - 1 && j > 0) relax(k, k - nx + 1, diag);
    }
  for (let j = ny - 1; j >= 0; j--)
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      if (i < nx - 1) relax(k, k + 1, sx);
      if (j < ny - 1) relax(k, k + nx, sy);
      if (i < nx - 1 && j < ny - 1) relax(k, k + nx + 1, diag);
      if (i > 0 && j < ny - 1) relax(k, k + nx - 1, diag);
    }
  const inside = new Uint8Array(nx * ny);
  // A sample's distance is to a blocked sample centre; the obstacle itself lies about half a
  // sample closer.
  for (let k = 0; k < nx * ny; k++)
    inside[k] = dist[k]! - Math.max(sx, sy) / 2 >= o.actorRadius ? 1 : 0;

  // Erosion may cut a narrow passage: keep what an entry sample still reaches.
  keepReachable(inside, nx, ny, (i, j) => {
    const z = entryFloor(i, j);
    return z !== undefined && Math.fround(z) === floor[j * nx + i];
  });

  // 5. Outline.
  const rings = traceRings(inside, nx, ny).map((ring) => {
    const world = ring.map(([gx, gy]) => {
      // Grid corner coordinates: corners on the outer border snap to the bounding box.
      const x = gx <= 0 ? minX : gx >= nx ? maxX : minX + gx * sx;
      const y = gy <= 0 ? minY : gy >= ny ? maxY : minY + gy * sy;
      return [x, y] as [number, number];
    });
    return simplifyRing(world, o.tolerance).map(([x, y]): Vec3 => [x, y, floorAt(x, y)]);
  });

  function floorAt(x: number, y: number): number {
    const i = Math.min(nx - 1, Math.max(0, Math.floor((x - minX) / sx)));
    const j = Math.min(ny - 1, Math.max(0, Math.floor((y - minY) / sy)));
    let best = NaN;
    let bestD = Infinity;
    for (let dj = -2; dj <= 2; dj++)
      for (let di = -2; di <= 2; di++) {
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const z = floor[jj * nx + ii]!;
        if (Number.isNaN(z) || !inside[jj * nx + ii]) continue;
        const d = Math.hypot(cx(ii) - x, cy(jj) - y);
        if (d < bestD) {
          bestD = d;
          best = z;
        }
      }
    return best;
  }

  const shown = new Float32Array(nx * ny).fill(NaN);
  for (let k = 0; k < nx * ny; k++) if (inside[k]) shown[k] = floor[k]!;
  return { rings, grid: { x0: minX, y0: minY, step: s, nx, ny, floor: shown } };
}

/**
 * Clear the walkable areas not connected to an entry sample: actors enter a tile through its
 * openings, so an area enclosed inside (a cavity in a thick wall) is unreachable.
 */
function keepReachable(
  mask: Uint8Array,
  nx: number,
  ny: number,
  entry: (i: number, j: number) => boolean,
): void {
  const reached = new Uint8Array(nx * ny);
  const queue: number[] = [];
  const seed = (k: number) => {
    if (mask[k] && !reached[k]) {
      reached[k] = 1;
      queue.push(k);
    }
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (entry(i, j)) seed(j * nx + i);
  while (queue.length > 0) {
    const k = queue.pop()!;
    const i = k % nx;
    if (i > 0) seed(k - 1);
    if (i < nx - 1) seed(k + 1);
    if (k >= nx) seed(k - nx);
    if (k < (ny - 1) * nx) seed(k + nx);
  }
  mask.set(reached);
}

function distanceToSegment(x: number, y: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}

function distanceToTriangle2d(x: number, y: number, a: Vec3, b: Vec3, c: Vec3): number {
  const seg = (p: Vec3, q: Vec3) => {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / l2));
    return Math.hypot(x - p[0] - t * dx, y - p[1] - t * dy);
  };
  return Math.min(seg(a, b), seg(b, c), seg(c, a));
}

/**
 * Closed outlines of the cells set in `mask` (nx * ny), in grid-corner coordinates: outer rings
 * counter-clockwise, holes clockwise (y up). Built from the directed boundary edges of the set
 * cells, walked with the set cells kept on the left.
 */
export function traceRings(mask: Uint8Array, nx: number, ny: number): [number, number][][] {
  const at = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < nx && j < ny && mask[j * nx + i] === 1;
  // Directed edges keyed by their start corner; a corner may start two edges (pinch points).
  const next = new Map<string, [number, number][]>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const key = `${x0},${y0}`;
    const list = next.get(key) ?? [];
    list.push([x1, y1]);
    next.set(key, list);
  };
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (!at(i, j)) continue;
      if (!at(i, j - 1)) add(i, j, i + 1, j); // bottom, left to right
      if (!at(i + 1, j)) add(i + 1, j, i + 1, j + 1); // right, upwards
      if (!at(i, j + 1)) add(i + 1, j + 1, i, j + 1); // top, right to left
      if (!at(i - 1, j)) add(i, j + 1, i, j); // left, downwards
    }
  const rings: [number, number][][] = [];
  for (;;) {
    const start = next.keys().next();
    if (start.done) break;
    const [sx, sy] = start.value.split(',').map(Number) as [number, number];
    const ring: [number, number][] = [];
    let x = sx;
    let y = sy;
    let dx = 0;
    let dy = 0;
    do {
      ring.push([x, y]);
      const key = `${x},${y}`;
      const options = next.get(key)!;
      // At a pinch point, turn left first so each ring stays simple.
      let pick = 0;
      if (options.length > 1) {
        const turn = (o: [number, number]) => dx * (o[1] - y) - dy * (o[0] - x);
        pick = options.findIndex((o) => turn(o) > 0);
        if (pick < 0) pick = 0;
      }
      const [nxp, nyp] = options.splice(pick, 1)[0]!;
      if (options.length === 0) next.delete(key);
      dx = nxp - x;
      dy = nyp - y;
      x = nxp;
      y = nyp;
    } while (x !== sx || y !== sy);
    rings.push(removeCollinear(ring));
  }
  return rings;
}

function removeCollinear(ring: [number, number][]): [number, number][] {
  return ring.filter((p, i) => {
    const a = ring[(i + ring.length - 1) % ring.length]!;
    const b = ring[(i + 1) % ring.length]!;
    return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
  });
}

/** Douglas-Peucker on a closed ring, split at its two farthest-apart vertices. */
export function simplifyRing(ring: [number, number][], tolerance: number): [number, number][] {
  if (ring.length <= 4) return ring;
  let far = 0;
  let farD = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i]![0] - ring[0]![0], ring[i]![1] - ring[0]![1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const first = simplifyPath(ring.slice(0, far + 1), tolerance);
  const second = simplifyPath([...ring.slice(far), ring[0]!], tolerance);
  const out = [...first.slice(0, -1), ...second.slice(0, -1)];
  return out.length >= 3 ? out : ring;
}

function simplifyPath(path: [number, number][], tolerance: number): [number, number][] {
  if (path.length <= 2) return path;
  const a = path[0]!;
  const b = path[path.length - 1]!;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  let worst = 0;
  let index = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const p = path[i]!;
    const d =
      l === 0
        ? Math.hypot(p[0] - a[0], p[1] - a[1])
        : Math.abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / l;
    if (d > worst) {
      worst = d;
      index = i;
    }
  }
  if (worst <= tolerance) return [a, b];
  const left = simplifyPath(path.slice(0, index + 1), tolerance);
  const right = simplifyPath(path.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}
