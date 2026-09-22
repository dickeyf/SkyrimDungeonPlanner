/**
 * Read one top-level group of a large plugin (Skyrim.esm is 238 MB) without loading the
 * file: the TES4 header and the group headers are read one by one, then only the wanted
 * group's bytes are fetched and parsed.
 */
import type { RangeSource } from '../bsa/RangeSource';
import { BinaryReader } from '../../binary/BinaryReader';
import { HEADER_SIZE, labelToType, parseNodes, type EspGroup, type EspRecord } from './records';

export interface TopGroupHeader {
  type: string;
  offset: number;
  size: number;
}

export interface PluginIndex {
  tes4: EspRecord;
  groups: TopGroupHeader[];
}

export async function scanTopGroups(source: RangeSource): Promise<PluginIndex> {
  const head = await source.read(0, HEADER_SIZE);
  const hr = new BinaryReader(head.buffer, head.byteOffset, head.byteLength);
  if (hr.tag() !== 'TES4') throw new Error('not a plugin (no TES4 header)');
  const tes4Size = hr.u32();
  const tes4Bytes = await source.read(0, HEADER_SIZE + tes4Size);
  const tes4 = parseNodes(tes4Bytes)[0] as EspRecord;

  const groups: TopGroupHeader[] = [];
  let offset = HEADER_SIZE + tes4Size;
  while (offset + HEADER_SIZE <= source.size) {
    const bytes = await source.read(offset, HEADER_SIZE);
    const r = new BinaryReader(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (r.tag() !== 'GRUP') throw new Error(`expected GRUP at ${offset}`);
    const size = r.u32();
    const label = r.u32();
    groups.push({ type: labelToType(label), offset, size });
    offset += size;
  }
  return { tes4, groups };
}

export async function readTopGroup(
  source: RangeSource,
  index: PluginIndex,
  type: string,
): Promise<EspGroup | undefined> {
  const header = index.groups.find((g) => g.type === type);
  if (!header) return undefined;
  const bytes = await source.read(header.offset, header.size);
  return parseNodes(bytes)[0] as EspGroup;
}
