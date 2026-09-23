/** Counts shown when a cell is loaded (step 11). */
import type { Piece } from '../catalogue/types';
import type { LoadedCell } from './loadCell';

export interface CellSummary {
  /** Tile count per piece category. */
  byCategory: [string, number][];
  /** Opaque reference count per reason. */
  reasons: [string, number][];
  /** Most frequent base objects among the opaque references. */
  topBases: [string, number][];
}

function countBy<T>(items: readonly T[], key: (item: T) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function summarizeCell(
  loaded: LoadedCell,
  pieceOf: ReadonlyMap<string, Piece>,
  topCount = 15,
): CellSummary {
  return {
    byCategory: countBy(loaded.grid.tiles, (t) => pieceOf.get(t.ref.base)?.category ?? '?'),
    reasons: countBy(loaded.grid.opaque, (o) => o.reason),
    topBases: countBy(loaded.grid.opaque, (o) => o.ref.base).slice(0, topCount),
  };
}
