/**
 * Load a kit's STAT list from the master file through the virtual Data view, with an
 * IndexedDB cache keyed on the master's size and modification time.
 */
import { kvGet, kvSet } from '../fs/handleStore';
import { FileRangeSource } from '../format/bsa/RangeSource';
import { readTopGroup, scanTopGroups } from '../format/esp/scan';
import { decodeStat, type StatInfo } from '../format/esp/stat';
import type { Overlay } from '../vfs/overlay';
import { extractKitStats, type KitStat } from './extract';
import type { KitDefinition } from './kits';

export interface KitStatsResult {
  master: string;
  stats: KitStat[];
  /** Total STAT records in the master, for the report. */
  totalStats: number;
  fromCache: boolean;
  elapsedMs: number;
  /** Identifies the master file version; analysis caches derive their key from it. */
  cacheKey: string;
}

export async function loadKitStats(
  overlay: Overlay,
  kit: KitDefinition,
  master = 'Skyrim.esm',
  options: { useCache?: boolean } = {},
): Promise<KitStatsResult> {
  const started = performance.now();
  const found = await overlay.resolveFile(master);
  if (!found) throw new Error(`${master} not found in the Data view`);
  const file = await found.file.getFile();
  // the kit's definition is in the key: a family added to the kit (V5 step 8) must be read
  const cacheKey = `kitstats:${kit.kit}:${definitionStamp(kit)}:${master}:${file.size}:${file.lastModified}`;
  if (options.useCache !== false) {
    const cached = await kvGet<{ stats: KitStat[]; totalStats: number }>(cacheKey);
    if (cached) {
      return {
        master,
        ...cached,
        fromCache: true,
        elapsedMs: performance.now() - started,
        cacheKey,
      };
    }
  }
  const source = await FileRangeSource.open(found.file);
  const index = await scanTopGroups(source);
  const group = await readTopGroup(source, index, 'STAT');
  const all: StatInfo[] = [];
  for (const node of group?.children ?? []) {
    if (node.kind === 'record' && node.type === 'STAT') all.push(await decodeStat(node));
  }
  const stats = extractKitStats(all, kit, master);
  await kvSet(cacheKey, { stats, totalStats: all.length });
  return {
    master,
    stats,
    totalStats: all.length,
    fromCache: false,
    elapsedMs: performance.now() - started,
    cacheKey,
  };
}

/** A short hash of a kit's definition (FNV-1a over its JSON). */
function definitionStamp(kit: KitDefinition): string {
  const text = JSON.stringify(kit);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
