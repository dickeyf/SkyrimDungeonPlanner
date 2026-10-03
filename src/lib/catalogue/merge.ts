/**
 * One catalogue from several kits (V4 step 4, D68): their kits, connection types, pieces and
 * accepted overlaps side by side. Connection type ids are prefixed by their kit, so faces of two
 * kits never mate. A cell is drawn on one grid: the kits must share their module, else the
 * editor would need one grid per kit.
 */
import type { Catalogue } from './types';

export function mergeCatalogues(catalogues: readonly Catalogue[]): Catalogue {
  const kits = catalogues.flatMap((c) => c.kits);
  const modules = new Set(kits.map((k) => `${k.module.xy}x${k.module.z}`));
  if (modules.size > 1)
    throw new Error(
      `kits with different modules (${[...modules].join(', ')}) cannot share a cell's grid`,
    );
  const overlaps = catalogues.flatMap((c) => c.overlaps ?? []);
  return {
    version: 1,
    kits,
    connectionTypes: catalogues.flatMap((c) => c.connectionTypes),
    pieces: catalogues.flatMap((c) => c.pieces),
    ...(overlaps.length ? { overlaps } : {}),
  };
}
