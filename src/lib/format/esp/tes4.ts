/** TES4 plugin header record: HEDR, author, description, masters. */
import { RecordFlags, type EspRecord } from './records';
import {
  findSubrecord,
  parseSubrecords,
  writeSubrecords,
  zStringOf,
  type Subrecord,
} from './subrecords';

export interface PluginHeader {
  version: number;
  /** Records and groups in the file, TES4 excluded. */
  numRecords: number;
  /** Next free local object id (low 24 bits of new FormIDs). */
  nextObjectId: number;
  author: string;
  description: string;
  masters: string[];
  isMaster: boolean;
  isLight: boolean;
}

export function decodeTes4(record: EspRecord): PluginHeader {
  if (record.type !== 'TES4') throw new Error(`expected TES4, got ${record.type}`);
  const subs = parseSubrecords(record.data);
  const hedr = findSubrecord(subs, 'HEDR');
  if (!hedr || hedr.data.byteLength < 12) throw new Error('TES4 without a valid HEDR');
  const v = new DataView(hedr.data.buffer, hedr.data.byteOffset, 12);
  return {
    version: v.getFloat32(0, true),
    numRecords: v.getUint32(4, true),
    nextObjectId: v.getUint32(8, true),
    author: zStringOf(findSubrecord(subs, 'CNAM')) ?? '',
    description: zStringOf(findSubrecord(subs, 'SNAM')) ?? '',
    masters: subs.filter((s) => s.type === 'MAST').map((s) => zStringOf(s) ?? ''),
    isMaster: (record.flags & RecordFlags.master) !== 0,
    isLight: (record.flags & RecordFlags.light) !== 0,
  };
}

/** Rewrite HEDR's counters in place; every other field is kept verbatim. */
export function patchHedr(
  record: EspRecord,
  values: { numRecords?: number; nextObjectId?: number },
): void {
  const subs = parseSubrecords(record.data);
  const hedr = findSubrecord(subs, 'HEDR');
  if (!hedr) throw new Error('TES4 without HEDR');
  const data = hedr.data.slice();
  const v = new DataView(data.buffer);
  if (values.numRecords !== undefined) v.setUint32(4, values.numRecords, true);
  if (values.nextObjectId !== undefined) v.setUint32(8, values.nextObjectId, true);
  const patched: Subrecord[] = subs.map((s) => (s === hedr ? { type: 'HEDR', data } : s));
  record.data = writeSubrecords(patched);
}
