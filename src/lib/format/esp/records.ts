/**
 * Plugin (ESP/ESM) record and group tree, kept opaque: record data is stored raw so an
 * untouched plugin writes back byte for byte. Group sizes are recomputed from the children.
 *
 * Skyrim SE layout (all little-endian):
 *   record header, 24 bytes: type[4] dataSize u32 flags u32 formId u32 timestamp u16
 *                            vcsInfo u16 formVersion u16 vcsInfo2 u16, then dataSize bytes
 *   group header, 24 bytes:  'GRUP' groupSize u32 (header included) label[4] groupType i32
 *                            timestamp u16 vcsInfo u16 unknown u32, then the children
 *
 * Reference: https://en.uesp.net/wiki/Skyrim_Mod:Mod_File_Format
 */
import { BinaryReader, latin1 } from '../../binary/BinaryReader';
import { BinaryWriter, latin1Bytes } from '../../binary/BinaryWriter';

export const HEADER_SIZE = 24;

export const RecordFlags = {
  /** TES4: the plugin is a master (ESM). */
  master: 0x00000001,
  deleted: 0x00000020,
  /** TES4: light plugin (ESL); refused in V1 (V6). */
  light: 0x00000200,
  initiallyDisabled: 0x00000800,
  ignored: 0x00001000,
  /** Record data is `u32 decompressedSize` + a zlib stream. */
  compressed: 0x00040000,
} as const;

export const GroupType = {
  top: 0,
  worldChildren: 1,
  interiorCellBlock: 2,
  interiorCellSubBlock: 3,
  exteriorCellBlock: 4,
  exteriorCellSubBlock: 5,
  cellChildren: 6,
  topicChildren: 7,
  cellPersistentChildren: 8,
  cellTemporaryChildren: 9,
} as const;

export interface EspRecord {
  kind: 'record';
  type: string;
  flags: number;
  formId: number;
  timestamp: number;
  vcsInfo: number;
  formVersion: number;
  vcsInfo2: number;
  /** Raw record data (compressed when the flag says so). */
  data: Uint8Array;
}

export interface EspGroup {
  kind: 'group';
  /** Raw 4-byte label as u32: a record type (top groups), a FormID, or a block number. */
  label: number;
  groupType: number;
  timestamp: number;
  vcsInfo: number;
  unknown: number;
  children: EspNode[];
}

export type EspNode = EspRecord | EspGroup;

export function labelToType(label: number): string {
  return String.fromCharCode(
    label & 0xff,
    (label >>> 8) & 0xff,
    (label >>> 16) & 0xff,
    (label >>> 24) & 0xff,
  );
}

export function typeToLabel(type: string): number {
  if (type.length !== 4) throw new RangeError(`record type "${type}" must be 4 characters`);
  return (
    (type.charCodeAt(0) |
      (type.charCodeAt(1) << 8) |
      (type.charCodeAt(2) << 16) |
      (type.charCodeAt(3) << 24)) >>>
    0
  );
}

/** Parse the nodes found in `bytes[start, end)`. */
export function parseNodes(bytes: Uint8Array, start = 0, end = bytes.byteLength): EspNode[] {
  const r = new BinaryReader(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  r.seek(start);
  const nodes: EspNode[] = [];
  while (r.position < end) {
    if (end - r.position < HEADER_SIZE) throw new Error(`truncated header at ${r.position}`);
    const type = r.tag();
    if (type === 'GRUP') {
      const groupSize = r.u32();
      const label = r.u32();
      const groupType = r.i32();
      const timestamp = r.u16();
      const vcsInfo = r.u16();
      const unknown = r.u32();
      const groupStart = r.position - HEADER_SIZE;
      const groupEnd = groupStart + groupSize;
      if (groupSize < HEADER_SIZE || groupEnd > end) {
        throw new Error(
          `group ${labelToType(label)} at ${groupStart}: size ${groupSize} exceeds parent`,
        );
      }
      const children = parseNodes(bytes, r.position, groupEnd);
      nodes.push({ kind: 'group', label, groupType, timestamp, vcsInfo, unknown, children });
      r.seek(groupEnd);
    } else {
      const dataSize = r.u32();
      const flags = r.u32();
      const formId = r.u32();
      const timestamp = r.u16();
      const vcsInfo = r.u16();
      const formVersion = r.u16();
      const vcsInfo2 = r.u16();
      if (r.position + dataSize > end)
        throw new Error(`record ${type} at ${r.position - HEADER_SIZE}: data exceeds parent`);
      const data = bytes.subarray(r.position, r.position + dataSize);
      nodes.push({
        kind: 'record',
        type,
        flags,
        formId,
        timestamp,
        vcsInfo,
        formVersion,
        vcsInfo2,
        data,
      });
      r.skip(dataSize);
    }
  }
  return nodes;
}

/** Bytes this node will occupy when written. */
export function nodeSize(node: EspNode): number {
  if (node.kind === 'record') return HEADER_SIZE + node.data.byteLength;
  let size = HEADER_SIZE;
  for (const child of node.children) size += nodeSize(child);
  return size;
}

export function writeNodes(w: BinaryWriter, nodes: readonly EspNode[]): void {
  for (const node of nodes) {
    if (node.kind === 'record') {
      w.raw(latin1Bytes(node.type))
        .u32(node.data.byteLength)
        .u32(node.flags)
        .u32(node.formId)
        .u16(node.timestamp)
        .u16(node.vcsInfo)
        .u16(node.formVersion)
        .u16(node.vcsInfo2)
        .raw(node.data);
    } else {
      w.tag('GRUP')
        .u32(nodeSize(node))
        .u32(node.label)
        .i32(node.groupType)
        .u16(node.timestamp)
        .u16(node.vcsInfo)
        .u32(node.unknown);
      writeNodes(w, node.children);
    }
  }
}

/** Number of records and groups in the tree (what HEDR counts, TES4 excluded). */
export function countNodes(nodes: readonly EspNode[]): number {
  let n = 0;
  for (const node of nodes) {
    n += 1;
    if (node.kind === 'group') n += countNodes(node.children);
  }
  return n;
}

/** Depth-first walk over records. */
export function* walkRecords(
  nodes: readonly EspNode[],
  parents: EspGroup[] = [],
): Generator<{ record: EspRecord; parents: EspGroup[] }> {
  for (const node of nodes) {
    if (node.kind === 'record') yield { record: node, parents };
    else yield* walkRecords(node.children, [...parents, node]);
  }
}

export function describeRecord(record: EspRecord): string {
  return `${record.type} 0x${record.formId.toString(16).padStart(8, '0')} (${record.data.byteLength} bytes${record.flags & RecordFlags.compressed ? ', compressed' : ''})`;
}

export { latin1 };
