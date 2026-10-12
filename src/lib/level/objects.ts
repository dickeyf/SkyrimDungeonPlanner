/**
 * The objects of a cell other than tiles (V5 step 5, D71): what their base is (furniture,
 * light, marker...), read from the base records of the plugin and its masters. Why: showing,
 * hiding and selecting objects by kind needs to know what they are; the base record type says
 * it, with the EditorID and model for the markers, which are plain STATs.
 */
import type { FormKey } from '../catalogue/types';
import type { RangeSource } from '../format/bsa/RangeSource';
import { toFormKey } from '../format/esp/formId';
import type { EspRecord } from '../format/esp/records';
import { readTopGroup, scanTopGroups } from '../format/esp/scan';
import { findSubrecord, recordSubrecords, zStringOf } from '../format/esp/subrecords';
import { decodeTes4 } from '../format/esp/tes4';

/** What the editor shows, hides and selects objects by. */
export type ObjectCategory =
  | 'furniture'
  | 'container'
  | 'light'
  | 'clutter'
  | 'activator'
  | 'marker'
  | 'door'
  | 'actor'
  | 'sound'
  | 'decal'
  | 'other';

export const OBJECT_CATEGORIES: readonly ObjectCategory[] = [
  'furniture',
  'container',
  'light',
  'clutter',
  'activator',
  'marker',
  'door',
  'actor',
  'sound',
  'decal',
  'other',
];

/** A placed object's base record. */
export interface BaseInfo {
  /** Record type: `FURN`, `LIGH`, `STAT`... */
  type: string;
  editorId: string;
  /** Model path (MODL), as stored, when the base has one. */
  model?: string;
}

/** The record types a placed reference (REFR) may point at, read into the index. */
export const BASE_TYPES = [
  'STAT',
  'MSTT',
  'FURN',
  'CONT',
  'LIGH',
  'MISC',
  'ACTI',
  'TACT',
  'DOOR',
  'FLOR',
  'TREE',
  'IDLM',
  'TXST',
  'SOUN',
  'BOOK',
  'WEAP',
  'ARMO',
  'ALCH',
  'INGR',
  'KEYM',
  'SLGM',
  'AMMO',
  'SCRL',
  'NPC_',
  'LVLN',
  'HAZD',
  'ADDN',
] as const;

const BY_TYPE: Record<string, ObjectCategory> = {
  FURN: 'furniture',
  CONT: 'container',
  LIGH: 'light',
  ACTI: 'activator',
  TACT: 'activator',
  DOOR: 'door',
  IDLM: 'marker',
  NPC_: 'actor',
  LVLN: 'actor',
  SOUN: 'sound',
  TXST: 'decal',
  ADDN: 'other',
  HAZD: 'other',
};

/**
 * The category of an object from its base. The markers (`XMarker`, `XMarkerHeading`, the
 * navigation and room markers...) are STATs: their EditorID or model says so. Invisible ones
 * go with them: the furniture markers (`LeanTableMarker`, a spot to lean or sit, a FURN) and
 * the triggers (an ACTI without a model, `TriggerBox`).
 */
export function objectCategory(base: BaseInfo | undefined): ObjectCategory {
  if (!base) return 'other';
  if (base.type === 'FURN' && /marker/i.test(base.editorId)) return 'marker';
  if ((base.type === 'ACTI' || base.type === 'TACT') && !base.model) return 'marker';
  const byType = BY_TYPE[base.type];
  if (byType) return byType;
  if (/marker/i.test(base.editorId) || /(^|[\\/])markers?[\\/]|marker/i.test(base.model ?? ''))
    return 'marker';
  return 'clutter';
}

/**
 * The base records of one plugin, by FormKey (its own records and its overrides). A later
 * plugin's entry replaces an earlier one's: index the masters first, the working plugin last.
 */
export async function indexPluginBases(
  source: RangeSource,
  name: string,
): Promise<Map<FormKey, BaseInfo>> {
  const index = await scanTopGroups(source);
  const masters = decodeTes4(index.tes4).masters;
  const out = new Map<FormKey, BaseInfo>();
  for (const type of BASE_TYPES) {
    const group = await readTopGroup(source, index, type);
    for (const node of group?.children ?? []) {
      if (node.kind !== 'record' || node.type !== type) continue;
      out.set(toFormKey(node.formId, masters, name), await baseInfo(node));
    }
  }
  return out;
}

async function baseInfo(record: EspRecord): Promise<BaseInfo> {
  const subs = await recordSubrecords(record);
  const model = zStringOf(findSubrecord(subs, 'MODL'));
  return {
    type: record.type,
    editorId: zStringOf(findSubrecord(subs, 'EDID')) ?? '',
    ...(model ? { model } : {}),
  };
}
