/** CELL and REFR record fields the tool needs (docs/design/planning/02-data-model.md §2). */
import type { Vec3 } from '../../catalogue/types';
import { BinaryWriter } from '../../binary/BinaryWriter';
import type { EspRecord } from './records';
import {
  f32Of,
  findSubrecord,
  parseSubrecords,
  recordSubrecords,
  u32Of,
  writeSubrecords,
  zStringBytes,
  zStringOf,
  type Subrecord,
} from './subrecords';

export const CellFlags = {
  interior: 0x0001,
  hasWater: 0x0002,
} as const;

export interface CellInfo {
  editorId: string;
  name: string;
  flags: number;
  interior: boolean;
}

export async function decodeCell(record: EspRecord): Promise<CellInfo> {
  const subs = await recordSubrecords(record);
  const data = findSubrecord(subs, 'DATA');
  const flags = data
    ? data.data.byteLength >= 2
      ? data.data[0]! | (data.data[1]! << 8)
      : data.data[0]!
    : 0;
  return {
    editorId: zStringOf(findSubrecord(subs, 'EDID')) ?? '',
    name: zStringOf(findSubrecord(subs, 'FULL')) ?? '',
    flags,
    interior: (flags & CellFlags.interior) !== 0,
  };
}

export interface RefrInfo {
  editorId?: string;
  /** Base object FormID (NAME). */
  base: number;
  pos: Vec3;
  /** Euler angles in radians (rx, ry, rz). */
  rot: Vec3;
  scale: number;
}

export async function decodeRefr(record: EspRecord): Promise<RefrInfo> {
  const subs = await recordSubrecords(record);
  const data = findSubrecord(subs, 'DATA');
  if (!data || data.data.byteLength < 24)
    throw new Error(`REFR ${record.formId.toString(16)} without DATA`);
  const v = new DataView(data.data.buffer, data.data.byteOffset, 24);
  const base = u32Of(findSubrecord(subs, 'NAME'));
  if (base === undefined) throw new Error(`REFR ${record.formId.toString(16)} without NAME`);
  return {
    editorId: zStringOf(findSubrecord(subs, 'EDID')),
    base,
    pos: [v.getFloat32(0, true), v.getFloat32(4, true), v.getFloat32(8, true)],
    rot: [v.getFloat32(12, true), v.getFloat32(16, true), v.getFloat32(20, true)],
    scale: f32Of(findSubrecord(subs, 'XSCL')) ?? 1,
  };
}

function dataSubrecord(pos: Vec3, rot: Vec3): Subrecord {
  const w = new BinaryWriter(24);
  for (const v of [...pos, ...rot]) w.f32(v);
  return { type: 'DATA', data: w.toUint8Array() };
}

function scaleSubrecord(scale: number): Subrecord {
  return { type: 'XSCL', data: new BinaryWriter(4).f32(scale).toUint8Array() };
}

/** Minimal REFR data for a new placed object: [EDID] NAME [XSCL] DATA. */
export function encodeRefr(info: Omit<RefrInfo, 'scale'> & { scale?: number }): Uint8Array {
  const subs: Subrecord[] = [];
  if (info.editorId) subs.push({ type: 'EDID', data: zStringBytes(info.editorId) });
  subs.push({ type: 'NAME', data: new BinaryWriter(4).u32(info.base).toUint8Array() });
  if (info.scale !== undefined && info.scale !== 1) subs.push(scaleSubrecord(info.scale));
  subs.push(dataSubrecord(info.pos, info.rot));
  return writeSubrecords(subs);
}

/**
 * Change an existing (uncompressed) REFR's placement, keeping every other field verbatim.
 * DATA is replaced in place; XSCL is replaced, added before DATA, or removed when 1.
 */
export function patchRefrPlacement(
  record: EspRecord,
  placement: { pos: Vec3; rot: Vec3; scale?: number },
): void {
  const subs = parseSubrecords(record.data).filter((s) => s.type !== 'XSCL');
  const dataIndex = subs.findIndex((s) => s.type === 'DATA');
  if (dataIndex === -1) throw new Error('REFR without DATA');
  subs[dataIndex] = dataSubrecord(placement.pos, placement.rot);
  if (placement.scale !== undefined && placement.scale !== 1)
    subs.splice(dataIndex, 0, scaleSubrecord(placement.scale));
  record.data = writeSubrecords(subs);
}
