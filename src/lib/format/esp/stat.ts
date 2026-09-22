/** STAT (static object) records: the base objects of kit tiles (D11). */
import type { EspRecord } from './records';
import { findSubrecord, recordSubrecords, zStringOf } from './subrecords';

export interface StatInfo {
  formId: number;
  editorId: string;
  /** Model path relative to `meshes\`, as stored, e.g. `Dungeons\Imperial\SmallHall\ImpHall1Way01.nif`. */
  model: string;
  /** Object bounds (OBND): min x y z, max x y z, in units. */
  bounds?: { min: [number, number, number]; max: [number, number, number] };
}

export async function decodeStat(record: EspRecord): Promise<StatInfo> {
  const subs = await recordSubrecords(record);
  const obnd = findSubrecord(subs, 'OBND');
  let bounds: StatInfo['bounds'];
  if (obnd && obnd.data.byteLength >= 12) {
    const v = new DataView(obnd.data.buffer, obnd.data.byteOffset, 12);
    bounds = {
      min: [v.getInt16(0, true), v.getInt16(2, true), v.getInt16(4, true)],
      max: [v.getInt16(6, true), v.getInt16(8, true), v.getInt16(10, true)],
    };
  }
  return {
    formId: record.formId,
    editorId: zStringOf(findSubrecord(subs, 'EDID')) ?? '',
    model: zStringOf(findSubrecord(subs, 'MODL')) ?? '',
    bounds,
  };
}

/** `meshes/dungeons/imperial/smallhall/imphall1way01.nif` form of a MODL path. */
export function modelArchivePath(model: string): string {
  const p = model.replace(/\\/g, '/').toLowerCase().replace(/^\/+/, '');
  return p.startsWith('meshes/') ? p : `meshes/${p}`;
}
