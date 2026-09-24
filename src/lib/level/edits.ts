/**
 * Layout changes (grid/edit.ts) turned into format-independent level edits (step 15).
 *
 * New and moved tiles get their grid placement (tileWorldPlacement); removed tiles are
 * deleted by FormKey. Only the working plugin's own references are ever moved or removed
 * (D22): the editor already refuses to touch master tiles, and the store checks again.
 */
import type { FormKey, Vec3 } from '../catalogue/types';
import { tileWorldPlacement, type LayoutChanges, type Pieces } from '../grid/edit';
import type { GridAnchor } from '../grid/types';

export type LevelEdit =
  | { kind: 'add'; base: FormKey; pos: Vec3; rot: Vec3; scale: number }
  | { kind: 'move'; ref: FormKey; pos: Vec3; rot: Vec3; scale: number }
  | { kind: 'remove'; ref: FormKey };

export function editsFromChanges(
  changes: LayoutChanges,
  pieces: Pieces,
  anchor: GridAnchor,
): LevelEdit[] {
  const placement = (tile: LayoutChanges['added'][number]) => {
    const piece = pieces.get(tile.piece);
    if (!piece) throw new Error(`unknown piece ${tile.piece}`);
    return tileWorldPlacement(tile, piece, anchor);
  };
  return [
    ...changes.removed.map((t): LevelEdit => ({ kind: 'remove', ref: t.key })),
    ...changes.moved.map((t): LevelEdit => ({ kind: 'move', ref: t.key, ...placement(t) })),
    ...changes.added.map((t): LevelEdit => ({ kind: 'add', base: t.piece, ...placement(t) })),
  ];
}
