/**
 * Subrecords (fields) inside a record's data: type[4] size u16 data. A field larger than
 * 65535 bytes is preceded by an `XXXX` field holding its real u32 size, and carries size 0.
 */
import { BinaryReader, latin1 } from '../../binary/BinaryReader';
import { BinaryWriter, latin1Bytes } from '../../binary/BinaryWriter';
import { RecordFlags, type EspRecord } from './records';

export interface Subrecord {
  type: string;
  data: Uint8Array;
}

export function parseSubrecords(data: Uint8Array): Subrecord[] {
  const r = new BinaryReader(data.buffer, data.byteOffset, data.byteLength);
  const out: Subrecord[] = [];
  let override: number | undefined;
  while (!r.eof) {
    const type = r.tag();
    let size = r.u16();
    if (type === 'XXXX') {
      override = r.u32();
      continue;
    }
    if (size === 0 && override !== undefined) size = override;
    override = undefined;
    out.push({ type, data: r.bytesView(size) });
  }
  return out;
}

export function writeSubrecords(subrecords: readonly Subrecord[]): Uint8Array {
  const w = new BinaryWriter(256);
  for (const sub of subrecords) {
    const size = sub.data.byteLength;
    if (size > 0xffff) {
      w.raw(latin1Bytes('XXXX')).u16(4).u32(size);
      w.raw(latin1Bytes(sub.type)).u16(0).raw(sub.data);
    } else {
      w.raw(latin1Bytes(sub.type)).u16(size).raw(sub.data);
    }
  }
  return w.toUint8Array();
}

export function findSubrecord(
  subrecords: readonly Subrecord[],
  type: string,
): Subrecord | undefined {
  return subrecords.find((s) => s.type === type);
}

export function zStringOf(sub: Subrecord | undefined): string | undefined {
  if (!sub) return undefined;
  const end = sub.data.indexOf(0);
  return latin1(end === -1 ? sub.data : sub.data.subarray(0, end));
}

export function zStringBytes(s: string): Uint8Array {
  const b = latin1Bytes(s);
  const out = new Uint8Array(b.length + 1);
  out.set(b);
  return out;
}

export function u32Of(sub: Subrecord | undefined): number | undefined {
  if (!sub || sub.data.byteLength < 4) return undefined;
  return new DataView(sub.data.buffer, sub.data.byteOffset, 4).getUint32(0, true);
}

export function f32Of(sub: Subrecord | undefined): number | undefined {
  if (!sub || sub.data.byteLength < 4) return undefined;
  return new DataView(sub.data.buffer, sub.data.byteOffset, 4).getFloat32(0, true);
}

/**
 * The record's data, inflated when the record is compressed (u32 size + zlib stream).
 * Uses the platform DecompressionStream (browser and Node 18+).
 */
export async function recordData(record: EspRecord): Promise<Uint8Array> {
  if (!(record.flags & RecordFlags.compressed)) return record.data;
  const expected = new DataView(record.data.buffer, record.data.byteOffset, 4).getUint32(0, true);
  const stream = new Blob([record.data.slice(4)])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'));
  const inflated = new Uint8Array(await new Response(stream).arrayBuffer());
  if (inflated.byteLength !== expected) {
    throw new Error(
      `${record.type}: inflated ${inflated.byteLength} bytes, header says ${expected}`,
    );
  }
  return inflated;
}

export async function recordSubrecords(record: EspRecord): Promise<Subrecord[]> {
  return parseSubrecords(await recordData(record));
}
