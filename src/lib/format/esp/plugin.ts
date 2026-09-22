/**
 * A plugin file: TES4 header + top groups. Edits are limited to what V1 needs (D21, D22):
 * add, move and delete REFRs in existing interior cells. Everything else passes through.
 */
import { BinaryWriter } from '../../binary/BinaryWriter';
import {
  decodeCell,
  decodeRefr,
  encodeRefr,
  patchRefrPlacement,
  type CellInfo,
  type RefrInfo,
} from './cellRefr';
import { formIdIndex, makeFormId } from './formId';
import {
  GroupType,
  RecordFlags,
  countNodes,
  labelToType,
  parseNodes,
  typeToLabel,
  writeNodes,
  type EspGroup,
  type EspNode,
  type EspRecord,
} from './records';
import { decodeTes4, patchHedr, type PluginHeader } from './tes4';

export interface CellEntry {
  record: EspRecord;
  info: CellInfo;
  /** GRUP type 6 holding the cell's references, if any. */
  children?: EspGroup;
}

export interface RefEntry {
  record: EspRecord;
  info: RefrInfo;
  /** 8 = persistent, 9 = temporary. */
  groupType: number;
}

const PLACED_TYPES = new Set(['REFR', 'ACHR', 'PGRE', 'PHZD', 'NAVM']);

/** Interior cells of a CELL top group: block -> sub-block -> CELL [+ children group]. */
export async function listInteriorCells(top: EspGroup): Promise<CellEntry[]> {
  const out: CellEntry[] = [];
  for (const block of top.children) {
    if (block.kind !== 'group' || block.groupType !== GroupType.interiorCellBlock) continue;
    for (const sub of block.children) {
      if (sub.kind !== 'group' || sub.groupType !== GroupType.interiorCellSubBlock) continue;
      for (let i = 0; i < sub.children.length; i++) {
        const node = sub.children[i]!;
        if (node.kind !== 'record' || node.type !== 'CELL') continue;
        const next = sub.children[i + 1];
        const children =
          next?.kind === 'group' &&
          next.groupType === GroupType.cellChildren &&
          next.label === node.formId
            ? next
            : undefined;
        out.push({ record: node, info: await decodeCell(node), children });
      }
    }
  }
  return out;
}

/** The REFRs of a cell (persistent and temporary groups). */
export async function collectCellRefs(cell: CellEntry): Promise<RefEntry[]> {
  const out: RefEntry[] = [];
  if (!cell.children) return out;
  for (const group of cell.children.children) {
    if (group.kind !== 'group') continue;
    for (const node of group.children) {
      if (node.kind !== 'record' || node.type !== 'REFR') continue;
      out.push({ record: node, info: await decodeRefr(node), groupType: group.groupType });
    }
  }
  return out;
}

export class Plugin {
  /** HEDR count and tree size at load time: the CK's count differs from the tree by a few
   * groups (measured: 1303 vs 1306), so edits apply a delta instead of recounting. */
  private readonly loadedNumRecords: number;
  private readonly loadedNodeCount: number;

  private constructor(
    readonly name: string,
    readonly tes4: EspRecord,
    readonly nodes: EspNode[],
  ) {
    this.loadedNumRecords = decodeTes4(tes4).numRecords;
    this.loadedNodeCount = countNodes(nodes);
  }

  static parse(bytes: Uint8Array, name: string): Plugin {
    const nodes = parseNodes(bytes);
    const first = nodes.shift();
    if (!first || first.kind !== 'record' || first.type !== 'TES4')
      throw new Error(`${name}: not a plugin (no TES4 header)`);
    if (first.flags & RecordFlags.light)
      throw new Error(`${name}: ESL-flagged plugins are not supported in V1 (V6)`);
    return new Plugin(name, first, nodes);
  }

  get header(): PluginHeader {
    return decodeTes4(this.tes4);
  }

  get masters(): string[] {
    return this.header.masters;
  }

  /** Load-order index of this plugin's own records. */
  get ownIndex(): number {
    return this.masters.length;
  }

  /** Serialize. Group sizes are recomputed; HEDR is left as is unless edits changed it. */
  write(): Uint8Array {
    const w = new BinaryWriter(1 << 20);
    writeNodes(w, [this.tes4, ...this.nodes]);
    return w.toUint8Array();
  }

  /** Records and groups below TES4 (the CK's HEDR count is a few groups lower). */
  countNodes(): number {
    return countNodes(this.nodes);
  }

  topGroup(type: string): EspGroup | undefined {
    const label = typeToLabel(type);
    return this.nodes.find(
      (n): n is EspGroup =>
        n.kind === 'group' && n.groupType === GroupType.top && n.label === label,
    );
  }

  /** Records of a given type anywhere in the tree. */
  recordsOfType(type: string): EspRecord[] {
    const out: EspRecord[] = [];
    const visit = (nodes: EspNode[]) => {
      for (const n of nodes) {
        if (n.kind === 'record') {
          if (n.type === type) out.push(n);
        } else visit(n.children);
      }
    };
    visit(this.nodes);
    return out;
  }

  interiorCells(): Promise<CellEntry[]> {
    const top = this.topGroup('CELL');
    return top ? listInteriorCells(top) : Promise.resolve([]);
  }

  cellRefs(cell: CellEntry): Promise<RefEntry[]> {
    return collectCellRefs(cell);
  }

  /** Every placed record (REFR, ACHR, ...) in the cell, whatever its type, for pass-through checks. */
  cellPlacedCount(cell: CellEntry): number {
    let n = 0;
    for (const group of cell.children?.children ?? []) {
      if (group.kind !== 'group') continue;
      for (const node of group.children)
        if (node.kind === 'record' && PLACED_TYPES.has(node.type)) n++;
    }
    return n;
  }

  /** Allocate a FormID for a new record of this plugin and bump HEDR's counters. */
  private allocateFormId(): number {
    const header = this.header;
    const formId = makeFormId(this.ownIndex, header.nextObjectId);
    patchHedr(this.tes4, { nextObjectId: header.nextObjectId + 1 });
    return formId;
  }

  private syncRecordCount(): void {
    const delta = this.countNodes() - this.loadedNodeCount;
    patchHedr(this.tes4, { numRecords: this.loadedNumRecords + delta });
  }

  /**
   * Add a REFR to the cell's temporary children (creating the child groups if the cell had
   * none). Returns the new record, whose FormID belongs to this plugin.
   */
  addRefr(cell: CellEntry, refr: Omit<RefrInfo, 'scale'> & { scale?: number }): EspRecord {
    const sub = this.subBlockOf(cell.record);
    if (!cell.children) {
      cell.children = {
        kind: 'group',
        label: cell.record.formId,
        groupType: GroupType.cellChildren,
        timestamp: 0,
        vcsInfo: 0,
        unknown: 0,
        children: [],
      };
      sub.children.splice(sub.children.indexOf(cell.record) + 1, 0, cell.children);
    }
    let temporary = cell.children.children.find(
      (n): n is EspGroup => n.kind === 'group' && n.groupType === GroupType.cellTemporaryChildren,
    );
    if (!temporary) {
      temporary = {
        kind: 'group',
        label: cell.record.formId,
        groupType: GroupType.cellTemporaryChildren,
        timestamp: 0,
        vcsInfo: 0,
        unknown: 0,
        children: [],
      };
      cell.children.children.push(temporary);
    }
    const record: EspRecord = {
      kind: 'record',
      type: 'REFR',
      flags: 0,
      formId: this.allocateFormId(),
      timestamp: 0,
      vcsInfo: 0,
      formVersion: 44,
      vcsInfo2: 0,
      data: encodeRefr(refr),
    };
    temporary.children.push(record);
    this.syncRecordCount();
    return record;
  }

  /** Move/rescale an existing REFR (must belong to this plugin's own records, D22). */
  moveRefr(
    ref: RefEntry,
    placement: { pos: RefrInfo['pos']; rot: RefrInfo['rot']; scale?: number },
  ): void {
    this.assertEditable(ref.record);
    patchRefrPlacement(ref.record, placement);
  }

  /** Remove a REFR created by this plugin. Overrides of master records are never deleted (D22). */
  deleteRefr(cell: CellEntry, ref: RefEntry): void {
    this.assertEditable(ref.record);
    for (const group of cell.children?.children ?? []) {
      if (group.kind !== 'group') continue;
      const i = group.children.indexOf(ref.record);
      if (i !== -1) {
        group.children.splice(i, 1);
        this.syncRecordCount();
        return;
      }
    }
    throw new Error('reference not found in cell');
  }

  private assertEditable(record: EspRecord): void {
    if (record.flags & RecordFlags.compressed)
      throw new Error('compressed records are not edited in V1');
    if (formIdIndex(record.formId) !== this.ownIndex) {
      throw new Error(
        `0x${record.formId.toString(16)} belongs to a master; overrides are not edited in V1`,
      );
    }
  }

  private subBlockOf(cell: EspRecord): EspGroup {
    const top = this.topGroup('CELL');
    for (const block of top?.children ?? []) {
      if (block.kind !== 'group') continue;
      for (const sub of block.children) {
        if (sub.kind === 'group' && sub.children.includes(cell)) return sub;
      }
    }
    throw new Error('cell not found in the CELL group');
  }

  /** Record counts by type, for diagnostics. */
  summary(): { type: string; records: number }[] {
    const counts = new Map<string, number>();
    const visit = (nodes: EspNode[]) => {
      for (const n of nodes) {
        if (n.kind === 'record') counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
        else visit(n.children);
      }
    };
    visit(this.nodes);
    return [...counts]
      .map(([type, records]) => ({ type, records }))
      .sort((a, b) => b.records - a.records);
  }
}

export { labelToType };
