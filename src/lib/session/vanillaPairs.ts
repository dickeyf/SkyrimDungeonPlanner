/**
 * The committed pairs of pieces the game puts together, per kit (`data/vanilla/<kit>.json`,
 * V4 step 9b), bundled at build time like the annotations.
 */
import { parseVanillaPairs, type VanillaPair } from '$lib/catalogue/vanillaPairs';

const files = import.meta.glob<unknown>('../../../data/vanilla/*.json', {
  eager: true,
  import: 'default',
});

const byKit = new Map<string, VanillaPair[]>();
for (const json of Object.values(files)) {
  const v = parseVanillaPairs(json);
  byKit.set(v.kit, v.pairs);
}

/** The pairs of one kit, empty when none are committed. */
export function vanillaPairsOf(kit: string): VanillaPair[] {
  return byKit.get(kit) ?? [];
}

/** The pairs of every kit. */
export function allVanillaPairs(): VanillaPair[] {
  return [...byKit.values()].flat();
}
