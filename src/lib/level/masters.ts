/** Masters of a new plugin (step 16). */
import type { FormKey } from '../catalogue/types';

/**
 * The official masters, always loaded first and in this order. Mod managers leave them out
 * of `plugins.txt` (MO2 does), so they are not in the Data view's load order.
 */
export const OFFICIAL_MASTERS = [
  'Skyrim.esm',
  'Update.esm',
  'Dawnguard.esm',
  'HearthFires.esm',
  'Dragonborn.esm',
];

/**
 * Skyrim.esm and every plugin that provides one of `bases`, official masters first then in
 * load order, so any of them can be placed in the new plugin without adding a master later.
 */
export function mastersFor(bases: readonly FormKey[], loadOrder: readonly string[]): string[] {
  const owners = new Set(['skyrim.esm']);
  for (const key of bases) owners.add(key.slice(key.indexOf(':') + 1).toLowerCase());
  const order = [
    ...OFFICIAL_MASTERS,
    ...loadOrder.filter((p) => !OFFICIAL_MASTERS.some((m) => m.toLowerCase() === p.toLowerCase())),
  ];
  const out = order.filter((name) => owners.delete(name.toLowerCase()));
  if (owners.size)
    throw new Error(`pieces come from plugins not in the load order: ${[...owners].join(', ')}`);
  return out;
}
