/** What the cell view draws for a loaded cell (step 12): tiles in category colours, other objects in grey. */
import type { Catalogue, FormKey, PieceCategory } from '../catalogue/types';
import { modelArchivePath } from '../format/esp/stat';
import type { LoadedCell } from '../level/loadCell';
import type { GridSpec, SceneObject } from './CellScene';

export const CATEGORY_COLORS: Record<PieceCategory | 'foreign' | 'opaque', string> = {
  hall: '#6fa8dc',
  room: '#93c47d',
  door: '#d9c27a',
  other: '#999999',
  foreign: '#8a7aa8',
  opaque: '#5a5866',
};

/**
 * @param models base FormKey -> model path (MODL) for objects that are not tiles; objects
 *   without a known model are drawn as markers.
 */
export function sceneObjects(
  loaded: LoadedCell,
  catalogue: Catalogue,
  models: ReadonlyMap<FormKey, string>,
): SceneObject[] {
  const pieces = new Map(catalogue.pieces.map((p) => [p.formKey, p]));
  const own = new Map(loaded.refs.map((r) => [r.key, r.own]));
  const out: SceneObject[] = [];
  for (const t of loaded.grid.tiles) {
    const piece = pieces.get(t.ref.base)!;
    out.push({
      key: t.ref.refFormKey,
      modelPath: modelArchivePath(piece.model),
      pos: t.ref.pos,
      rot: t.ref.rot,
      scale: t.ref.scale,
      color: own.get(t.ref.refFormKey) ? CATEGORY_COLORS[piece.category] : CATEGORY_COLORS.foreign,
      pickable: true,
    });
  }
  for (const o of loaded.grid.opaque) {
    const model = models.get(o.ref.base) ?? pieces.get(o.ref.base)?.model;
    out.push({
      key: o.ref.refFormKey,
      modelPath: model ? modelArchivePath(model) : undefined,
      pos: o.ref.pos,
      rot: o.ref.rot,
      scale: o.ref.scale,
      color: CATEGORY_COLORS.opaque,
      pickable: false,
    });
  }
  return out;
}

/** Grid covering the occupied cells plus a margin, at the anchor's Z. */
export function sceneGrid(loaded: LoadedCell, margin = 4): GridSpec | null {
  const cells = loaded.grid.tiles.flatMap((t) => t.occupied);
  if (cells.length === 0) return null;
  const is = cells.map((c) => c[0]);
  const js = cells.map((c) => c[1]);
  return {
    origin: loaded.grid.anchor.origin,
    module: loaded.grid.anchor.module.xy,
    range: [
      Math.min(...is) - margin,
      Math.max(...is) + 1 + margin,
      Math.min(...js) - margin,
      Math.max(...js) + 1 + margin,
    ],
  };
}
