/** Masters of a new plugin (step 16). */
import type { FormKey } from '../catalogue/types';

/**
 * Skyrim.esm and every plugin that provides one of `bases`, in load order, so any of them
 * can be placed in the new plugin without adding a master later.
 */
export function mastersFor(bases: readonly FormKey[], loadOrder: readonly string[]): string[] {
  const owners = new Set(['skyrim.esm']);
  for (const key of bases) owners.add(key.slice(key.indexOf(':') + 1).toLowerCase());
  return loadOrder.filter((name) => owners.has(name.toLowerCase()));
}
