/**
 * NavMesh on several levels (V3 step 8, R7). The bake cuts the walkable polygons in plan, per
 * grid cell: two floors stacked above each other would be merged into one. So the tiles are
 * baked one level at a time (a tile on its lowest level: a staircase or ramp goes with the
 * floor it starts from), and the levels are then welded where they meet, at the top of a
 * staircase, by `mergeNavMesh` as any bake is welded onto a NavMesh already there. The area an
 * existing NavMesh covers is left out per level: only its triangles at that level's heights.
 */
import type { Vec3 } from '../catalogue/types';
import { bake, type BakeGrid, type BakeOptions, type BakeResult, type BakeTile } from './bake';

export interface LevelTile extends BakeTile {
  /** The tile's lowest grid level. */
  level: number;
}

type Triangle = readonly [Vec3, Vec3, Vec3];

/** Heights of a tile's walkable rings, placed in the world (rotation is around Z only). */
function heights(tile: BakeTile): number[] {
  return tile.rings.flatMap((r) => r.map((p) => p[2] + tile.pos[2]));
}

/**
 * One bake per level, lowest first. `band`: how far above and below a level's own floors an
 * existing triangle still counts as the same level (half a grid level is a good value).
 */
export function bakeLevels(
  tiles: readonly LevelTile[],
  options: Partial<BakeOptions>,
  grid: BakeGrid,
  exclude: readonly Triangle[],
  band: number,
): { level: number; result: BakeResult }[] {
  const levels = [...new Set(tiles.map((t) => t.level))].sort((a, b) => a - b);
  return levels.map((level) => {
    const group = tiles.filter((t) => t.level === level);
    const zs = group.flatMap(heights);
    const lo = Math.min(...zs) - band;
    const hi = Math.max(...zs) + band;
    const near = exclude.filter((t) => t.some((p) => p[2] >= lo && p[2] <= hi));
    return { level, result: bake(group, options, grid, near) };
  });
}
