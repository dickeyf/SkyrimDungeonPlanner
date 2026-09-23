/**
 * Step 11: load a cell of the level store and derive its grid view with the kit catalogue
 * (docs/02-modele-de-donnees.md §2, R10, D23, D58).
 */
import type { Catalogue, Piece } from '../catalogue/types';
import { deriveGrid, type DeriveResult } from '../grid/derive';
import type { PlacedRef } from '../grid/types';
import type { LevelRef, LevelStore } from './store';

export interface LoadedCell {
  cell: string;
  refs: LevelRef[];
  grid: DeriveResult;
  /** Tiles whose REFR belongs to a master (overrides): shown, never edited (D22). */
  foreignTiles: number;
}

export function piecesByFormKey(catalogue: Catalogue): Map<string, Piece> {
  return new Map(catalogue.pieces.map((p) => [p.formKey, p]));
}

export async function loadCell(
  store: LevelStore,
  cell: string,
  catalogue: Catalogue,
): Promise<LoadedCell> {
  const kit = catalogue.kits[0];
  if (!kit?.module.xy || !kit.module.z) throw new Error('catalogue has no measured kit module');
  const refs = await store.readRefs(cell);
  const placed: PlacedRef[] = refs.map((r) => ({
    refFormKey: r.key,
    base: r.base,
    pos: r.pos,
    rot: r.rot,
    scale: r.scale,
  }));
  const grid = deriveGrid(placed, piecesByFormKey(catalogue), {
    module: kit.module.xy,
    zModule: kit.module.z,
  });
  const own = new Map(refs.map((r) => [r.key, r.own]));
  return {
    cell,
    refs,
    grid,
    foreignTiles: grid.tiles.filter((t) => !own.get(t.ref.refFormKey)).length,
  };
}
