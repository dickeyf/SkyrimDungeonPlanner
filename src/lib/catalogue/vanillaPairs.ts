/**
 * The pairs of pieces the game puts together (V4 step 9b): two pieces meeting at an opening,
 * in one relative placement, as found in the master's CELLs by the Vanilla check. Generated,
 * then committed per kit (`data/vanilla/<kit>.json`); the junction checks take such a pair as
 * right. Why: the profile and texture checks flag some pairs Bethesda uses everywhere (damaged
 * walls against room middles, texture seams that do not show); what the game ships looks right,
 * and a designer new to a kit cannot tell those flags from real ones.
 */
import type { PieceOverlap } from './types';

export interface VanillaPair extends PieceOverlap {
  /** How many times the game places the pair like this. */
  count: number;
}

export interface VanillaPairs {
  version: 1;
  kit: string;
  /** The master the pairs were read from. */
  master: string;
  pairs: VanillaPair[];
}

/** A pair is kept once the game uses it this many times (a one-off may be a mistake). */
export const MIN_VANILLA_COUNT = 2;

export function parseVanillaPairs(json: unknown): VanillaPairs {
  const v = json as Partial<VanillaPairs>;
  if (v?.version !== 1 || typeof v.kit !== 'string' || !Array.isArray(v.pairs))
    throw new Error('vanilla pairs: unsupported file');
  return { version: 1, kit: v.kit, master: v.master ?? 'Skyrim.esm', pairs: v.pairs };
}

export function serializeVanillaPairs(v: VanillaPairs): string {
  const pairs = [...v.pairs].sort(
    (a, b) =>
      a.pieces[0].localeCompare(b.pieces[0]) ||
      a.pieces[1].localeCompare(b.pieces[1]) ||
      a.rotation - b.rotation ||
      a.offset.join(',').localeCompare(b.offset.join(',')),
  );
  return `${JSON.stringify({ ...v, pairs }, null, 1)}\n`;
}
