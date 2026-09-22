/**
 * Step 8: turn the STAT records of a master into the kit's piece list (D11).
 * Classification is by model sub-folder and EditorID; step 10 lets a human correct it.
 */
import { modelArchivePath, type StatInfo } from '../format/esp/stat';
import type { KitDefinition } from './kits';
import type { FormKey, PieceCategory } from './types';

export interface KitStat extends StatInfo {
  formKey: FormKey;
  kit: string;
  /** Model sub-folder under the kit prefix, e.g. `smallhall`. */
  subkit: string;
  category: PieceCategory;
  /** Archive-style model path: `meshes/dungeons/imperial/smallhall/imphall1way01.nif`. */
  modelPath: string;
}

/** Names that mark a prop even inside a structural sub-folder (measured by R5). */
const PROP_NAME = /pillar|brace|beam|rubble|column|chandel|sconce|banner|debris/i;

export function classifyStat(
  info: StatInfo,
  kit: KitDefinition,
): { subkit: string; category: PieceCategory } | null {
  const path = modelArchivePath(info.model);
  const prefix = `meshes/${kit.modelPrefix}`;
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  const slash = rest.indexOf('/');
  const subkit = slash === -1 ? '' : rest.slice(0, slash);
  const base = kit.subkits[subkit];
  if (!base) return { subkit, category: 'other' };
  if (PROP_NAME.test(info.editorId)) return { subkit, category: 'other' };
  return { subkit, category: /door/i.test(info.editorId) ? 'door' : base };
}

export function extractKitStats(
  stats: readonly StatInfo[],
  kit: KitDefinition,
  master: string,
): KitStat[] {
  const out: KitStat[] = [];
  for (const info of stats) {
    const classified = classifyStat(info, kit);
    if (!classified) continue;
    out.push({
      ...info,
      formKey: `0x${info.formId.toString(16).padStart(8, '0').toUpperCase()}:${master}`,
      kit: kit.kit,
      modelPath: modelArchivePath(info.model),
      ...classified,
    });
  }
  return out.sort(
    (a, b) => a.subkit.localeCompare(b.subkit) || a.editorId.localeCompare(b.editorId),
  );
}

export interface KitStatSummary {
  total: number;
  byCategory: Record<PieceCategory, number>;
  bySubkit: { subkit: string; total: number; structural: number }[];
}

export function summarize(stats: readonly KitStat[]): KitStatSummary {
  const byCategory: Record<PieceCategory, number> = { hall: 0, room: 0, door: 0, other: 0 };
  const subkits = new Map<string, { total: number; structural: number }>();
  for (const s of stats) {
    byCategory[s.category]++;
    const e = subkits.get(s.subkit) ?? { total: 0, structural: 0 };
    e.total++;
    if (s.category !== 'other') e.structural++;
    subkits.set(s.subkit, e);
  }
  return {
    total: stats.length,
    byCategory,
    bySubkit: [...subkits]
      .map(([subkit, v]) => ({ subkit, ...v }))
      .sort((a, b) => b.structural - a.structural || b.total - a.total),
  };
}
