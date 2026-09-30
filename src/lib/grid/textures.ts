/**
 * Texture continuity at a junction (V2 step 7, 14b): identical profiles do not guarantee that
 * the texture runs on across the joint (a symmetric room piece placed the wrong way round).
 *
 * The surfaces of each piece that end on the junction plane leave edges lying in it. Where an
 * edge of one piece runs along an edge of the other, both carry a texture and coordinates: the
 * texture continues when the file is the same and the coordinates differ by the same whole
 * number of repeats all along (a texture may be tiled, never shifted by a fraction or flipped).
 */
import type { Vec3 } from '../catalogue/types';
import type { MergedMesh } from '../format/nif/geometry';
import type { JunctionFrame } from './leaks';

/** A merged mesh placed in the world, with its texture coordinates and textures. */
export interface TexturedMesh {
  positions: Float64Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** Texture of each triangle. */
  textures: string[];
}

/** Place a merged mesh: turned by Skyrim's clockwise Z angle about its origin, then moved. */
export function placeTextured(mesh: MergedMesh, pos: Vec3, heading: number): TexturedMesh {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const positions = new Float64Array(mesh.positions.length);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i]!;
    const y = mesh.positions[i + 1]!;
    positions[i] = x * c + y * s + pos[0];
    positions[i + 1] = -x * s + y * c + pos[1];
    positions[i + 2] = mesh.positions[i + 2]! + pos[2];
  }
  const textures: string[] = new Array<string>(mesh.indices.length / 3).fill('');
  for (const r of mesh.ranges)
    for (let t = r.start / 3; t < (r.start + r.count) / 3; t++) textures[t] = r.texture;
  return { positions, uvs: mesh.uvs, indices: mesh.indices, textures };
}

export interface TextureOptions {
  /** How far from the plane an edge may lie and still be on it (units). */
  planeTol: number;
  /** Largest gap between two edges running along each other (units). */
  lineTol: number;
  /** Largest mismatch of texture coordinates (in repeats) that does not show. */
  uvTol: number;
  /** Breaks shorter than this (units) are ignored. */
  minLength: number;
}

export const DEFAULT_TEXTURE_OPTIONS: TextureOptions = {
  planeTol: 0.5,
  lineTol: 0.5,
  uvTol: 0.02,
  minLength: 4,
};

export type BreakCause = 'texture' | 'offset';

export interface TextureBreak {
  cause: BreakCause;
  /** Texture of the opening's piece, and of the facing piece when it differs. */
  texture: string;
  other?: string;
  /** Length of edge along which the texture breaks (units). */
  length: number;
  /** Largest coordinate mismatch, in repeats, away from a whole number. */
  offset: number;
  centre: Vec3;
}

interface RimEdge {
  /** Endpoints in plane coordinates (u along the plane, z up). */
  a: [number, number];
  b: [number, number];
  uvA: [number, number];
  uvB: [number, number];
  texture: string;
  /** Third coordinate: the plane position, for the break centres. */
  w: number;
}

/**
 * Edges of triangles that end on the plane, within the opening (triangles lying in the plane
 * itself excluded).
 */
function rimEdges(m: TexturedMesh, f: JunctionFrame, o: TextureOptions): RimEdge[] {
  const out: RimEdge[] = [];
  const u = 1 - f.axis;
  const P = m.positions;
  const onPlane = (v: number) => Math.abs(P[v * 3 + f.axis]! - f.plane) <= o.planeTol;
  // Within the opening's grid level only: higher up, the pieces' outer shells (the backs of
  // walls, roofs) meet on the plane too, never seen and rarely matching (tried: they flag
  // almost every junction).
  const inside = (v: number) =>
    P[v * 3 + u]! >= f.uMin - o.lineTol &&
    P[v * 3 + u]! <= f.uMax + o.lineTol &&
    P[v * 3 + 2]! >= f.zMin - o.lineTol &&
    P[v * 3 + 2]! <= f.zMax + o.lineTol;
  for (let t = 0; t < m.indices.length; t += 3) {
    const tri = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!];
    const flat = tri.filter(onPlane).length === 3;
    if (flat) continue;
    for (let k = 0; k < 3; k++) {
      const p = tri[k]!;
      const q = tri[(k + 1) % 3]!;
      if (!onPlane(p) || !onPlane(q) || !inside(p) || !inside(q)) continue;
      out.push({
        a: [P[p * 3 + u]!, P[p * 3 + 2]!],
        b: [P[q * 3 + u]!, P[q * 3 + 2]!],
        uvA: [m.uvs[p * 2]!, m.uvs[p * 2 + 1]!],
        uvB: [m.uvs[q * 2]!, m.uvs[q * 2 + 1]!],
        texture: m.textures[t / 3]!,
        w: f.plane,
      });
    }
  }
  return out;
}

/** Distance from a whole number. */
const fromWhole = (x: number) => Math.abs(x - Math.round(x));

/**
 * Texture breaks where the opening's piece `mine` meets the pieces facing it: runs of their rim
 * edges along each other whose texture differs, or whose coordinates differ by anything but
 * the same whole number of repeats.
 */
export function textureBreaks(
  mine: TexturedMesh,
  facing: TexturedMesh,
  frame: JunctionFrame,
  options: Partial<TextureOptions> = {},
): TextureBreak[] {
  const o = { ...DEFAULT_TEXTURE_OPTIONS, ...options };
  const ours = rimEdges(mine, frame, o);
  const theirs = rimEdges(facing, frame, o);
  const breaks: TextureBreak[] = [];
  for (const e of ours) {
    const dx = e.b[0] - e.a[0];
    const dz = e.b[1] - e.a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const dir: [number, number] = [dx / len, dz / len];
    const along = (p: [number, number]) => (p[0] - e.a[0]) * dir[0] + (p[1] - e.a[1]) * dir[1];
    const off = (p: [number, number]) =>
      Math.abs((p[0] - e.a[0]) * dir[1] - (p[1] - e.a[1]) * dir[0]);
    for (const g of theirs) {
      if (off(g.a) > o.lineTol || off(g.b) > o.lineTol) continue;
      const ga = along(g.a);
      const gb = along(g.b);
      const lo = Math.max(0, Math.min(ga, gb));
      const hi = Math.min(len, Math.max(ga, gb));
      if (hi - lo < 1e-3) continue;
      const lerp = (uv0: [number, number], uv1: [number, number], t: number): [number, number] => [
        uv0[0] + (uv1[0] - uv0[0]) * t,
        uv0[1] + (uv1[1] - uv0[1]) * t,
      ];
      const diffs: [number, number][] = [];
      for (const s of [lo, (lo + hi) / 2, hi]) {
        const mineUv = lerp(e.uvA, e.uvB, s / len);
        const theirUv = lerp(g.uvA, g.uvB, (s - ga) / (gb - ga));
        diffs.push([mineUv[0] - theirUv[0], mineUv[1] - theirUv[1]]);
      }
      const offset = Math.max(
        ...diffs.flatMap((d) => [fromWhole(d[0]), fromWhole(d[1])]),
        ...[0, 1].map(
          (k) => Math.max(...diffs.map((d) => d[k]!)) - Math.min(...diffs.map((d) => d[k]!)),
        ),
      );
      const cause: BreakCause | null =
        e.texture !== g.texture ? 'texture' : offset > o.uvTol ? 'offset' : null;
      if (!cause) continue;
      const mid = e.a.map((v, k) => v + dir[k]! * ((lo + hi) / 2)) as [number, number];
      const centre: Vec3 = frame.axis === 0 ? [e.w, mid[0], mid[1]] : [mid[0], e.w, mid[1]];
      breaks.push({
        cause,
        texture: e.texture,
        ...(cause === 'texture' ? { other: g.texture } : {}),
        length: hi - lo,
        offset,
        centre,
      });
    }
  }
  return mergeBreaks(breaks).filter((b) => b.length >= o.minLength);
}

/** One break per cause and texture pair, summing lengths (centre of the longest part). */
function mergeBreaks(breaks: readonly TextureBreak[]): TextureBreak[] {
  const byKey = new Map<string, TextureBreak>();
  for (const b of breaks) {
    const key = `${b.cause}|${b.texture}|${b.other ?? ''}`;
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, { ...b });
    else
      byKey.set(key, {
        ...prev,
        length: prev.length + b.length,
        offset: Math.max(prev.offset, b.offset),
        centre: b.length > prev.length ? b.centre : prev.centre,
      });
  }
  return [...byKey.values()].sort((x, y) => y.length - x.length);
}
