/**
 * Builder for small synthetic plugins used by tests: a TES4 header with masters, a CELL
 * top group with one interior cell and its references. Not used by the app.
 */
import { BinaryWriter } from '../../binary/BinaryWriter';
import { encodeRefr, type RefrInfo } from './cellRefr';
import {
  GroupType,
  typeToLabel,
  writeNodes,
  type EspGroup,
  type EspNode,
  type EspRecord,
} from './records';
import { writeSubrecords, zStringBytes, type Subrecord } from './subrecords';

export function record(type: string, formId: number, data: Uint8Array, flags = 0): EspRecord {
  return {
    kind: 'record',
    type,
    flags,
    formId,
    timestamp: 0x1234,
    vcsInfo: 0,
    formVersion: 44,
    vcsInfo2: 0,
    data,
  };
}

export function group(label: number, groupType: number, children: EspNode[]): EspGroup {
  return { kind: 'group', label, groupType, timestamp: 0, vcsInfo: 0, unknown: 0, children };
}

export function tes4Record(options: {
  masters: string[];
  nextObjectId: number;
  numRecords: number;
  flags?: number;
}): EspRecord {
  const hedr = new BinaryWriter(12)
    .f32(1.7)
    .u32(options.numRecords)
    .u32(options.nextObjectId)
    .toUint8Array();
  const subs: Subrecord[] = [
    { type: 'HEDR', data: hedr },
    { type: 'CNAM', data: zStringBytes('tests') },
    { type: 'SNAM', data: zStringBytes('synthetic plugin') },
  ];
  for (const m of options.masters) {
    subs.push({ type: 'MAST', data: zStringBytes(m) });
    subs.push({ type: 'DATA', data: new Uint8Array(8) });
  }
  subs.push({ type: 'INTV', data: new BinaryWriter(4).u32(1).toUint8Array() });
  return record('TES4', 0, writeSubrecords(subs), options.flags ?? 0);
}

export function cellRecord(formId: number, editorId: string, interior = true): EspRecord {
  const subs: Subrecord[] = [
    { type: 'EDID', data: zStringBytes(editorId) },
    { type: 'DATA', data: new Uint8Array([interior ? 1 : 0, 0]) },
    { type: 'XCLL', data: new Uint8Array(92) },
  ];
  return record('CELL', formId, writeSubrecords(subs));
}

export function refrRecord(
  formId: number,
  info: Omit<RefrInfo, 'scale'> & { scale?: number },
): EspRecord {
  return record('REFR', formId, encodeRefr(info));
}

/** Plugin bytes: TES4 + a CELL top group with one interior cell holding `refs`. */
export function buildPlugin(options: {
  masters?: string[];
  cellFormId?: number;
  cellEditorId?: string;
  refs?: EspRecord[];
  withChildren?: boolean;
  nextObjectId?: number;
}): Uint8Array {
  const masters = options.masters ?? ['Skyrim.esm'];
  const cellFormId = options.cellFormId ?? 0x01000d62;
  const cell = cellRecord(cellFormId, options.cellEditorId ?? 'MyDungeonCell01');
  const cellNodes: EspNode[] = [cell];
  if (options.withChildren ?? true) {
    cellNodes.push(
      group(cellFormId, GroupType.cellChildren, [
        group(cellFormId, GroupType.cellPersistentChildren, []),
        group(cellFormId, GroupType.cellTemporaryChildren, options.refs ?? []),
      ]),
    );
  }
  const top = group(typeToLabel('CELL'), GroupType.top, [
    group(2, GroupType.interiorCellBlock, [group(6, GroupType.interiorCellSubBlock, cellNodes)]),
  ]);
  const nodes: EspNode[] = [top];
  const numRecords = countAll(nodes);
  const tes4 = tes4Record({ masters, nextObjectId: options.nextObjectId ?? 0x0d70, numRecords });
  const w = new BinaryWriter(4096);
  writeNodes(w, [tes4, ...nodes]);
  return w.toUint8Array();
}

function countAll(nodes: EspNode[]): number {
  let n = 0;
  for (const node of nodes) {
    n++;
    if (node.kind === 'group') n += countAll(node.children);
  }
  return n;
}
