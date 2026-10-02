/** `.esp` backend of the level store (D57): a parsed plugin, read in place. */
import { formIdIndex, fromFormKey, toFormKey } from '../format/esp/formId';
import { Plugin, type CellEntry } from '../format/esp/plugin';
import type { FormKey } from '../catalogue/types';
import type { LevelEdit } from './edits';
import type {
  FinalizeReport,
  LevelCell,
  LevelNavMesh,
  LevelRef,
  LevelStore,
  MasterNavi,
} from './store';
import type { Vec3 } from '../catalogue/types';
import { decodeNvmi, encodeNvmi } from '../format/esp/navi';
import { findSubrecord, recordSubrecords, type Subrecord } from '../format/esp/subrecords';
import { BinaryWriter } from '../binary/BinaryWriter';
import { finalizeCell } from '../navmesh/finalize';

export class EspLevelStore implements LevelStore {
  private cells: Map<FormKey, CellEntry> | null = null;

  constructor(readonly plugin: Plugin) {}

  static parse(bytes: Uint8Array, name: string): EspLevelStore {
    return new EspLevelStore(Plugin.parse(bytes, name));
  }

  get name(): string {
    return this.plugin.name;
  }

  get masters(): readonly string[] {
    return this.plugin.masters;
  }

  private formKey(formId: number): FormKey {
    return toFormKey(formId, this.plugin.masters, this.plugin.name);
  }

  private async cellMap(): Promise<Map<FormKey, CellEntry>> {
    if (!this.cells) {
      this.cells = new Map();
      for (const entry of await this.plugin.interiorCells()) {
        this.cells.set(this.formKey(entry.record.formId), entry);
      }
    }
    return this.cells;
  }

  async listCells(): Promise<LevelCell[]> {
    const out: LevelCell[] = [];
    for (const [key, entry] of await this.cellMap()) {
      out.push({
        key,
        editorId: entry.info.editorId,
        name: entry.info.name,
        placedCount: this.plugin.cellPlacedCount(entry),
      });
    }
    return out.sort((a, b) => a.editorId.localeCompare(b.editorId));
  }

  async readRefs(cell: FormKey): Promise<LevelRef[]> {
    const entry = (await this.cellMap()).get(cell);
    if (!entry) throw new Error(`cell ${cell} is not an interior cell of ${this.name}`);
    const own = this.plugin.ownIndex;
    return (await this.plugin.cellRefs(entry)).map((r) => ({
      key: this.formKey(r.record.formId),
      base: this.formKey(r.info.base),
      pos: r.info.pos,
      rot: r.info.rot,
      scale: r.info.scale,
      own: formIdIndex(r.record.formId) === own,
    }));
  }

  async readNavMeshes(cell: FormKey): Promise<LevelNavMesh[]> {
    const entry = (await this.cellMap()).get(cell);
    if (!entry) throw new Error(`cell ${cell} is not an interior cell of ${this.name}`);
    const own = this.plugin.ownIndex;
    return (await this.plugin.cellNavms(entry)).map(({ record, nav }) => ({
      key: this.formKey(record.formId),
      own: formIdIndex(record.formId) === own,
      nav,
    }));
  }

  async applyEdits(cell: FormKey, edits: readonly LevelEdit[]): Promise<FormKey[]> {
    const entry = (await this.cellMap()).get(cell);
    if (!entry) throw new Error(`cell ${cell} is not an interior cell of ${this.name}`);
    const refs = new Map(
      (await this.plugin.cellRefs(entry)).map((r) => [this.formKey(r.record.formId), r]),
    );
    const own = this.plugin.ownIndex;
    const { masters, name } = this.plugin;
    // check everything first, so a refused edit leaves the plugin untouched
    const navms = new Map(
      (await this.plugin.cellNavms(entry)).map((n) => [this.formKey(n.record.formId), n.record]),
    );
    for (const edit of edits) {
      if (edit.kind === 'add') {
        fromFormKey(edit.base, masters, name); // throws when the base's plugin is not a master
        continue;
      }
      if (edit.kind === 'navmesh') {
        if (!edit.navm) {
          if (!edit.nav) throw new Error('a NavMesh edit without NAVM must carry a NavMesh');
          continue;
        }
        const record = navms.get(edit.navm);
        if (!record) throw new Error(`NavMesh ${edit.navm} is not in cell ${cell}`);
        if (formIdIndex(record.formId) !== own)
          throw new Error(`NavMesh ${edit.navm} belongs to a master and is not edited (D22)`);
        continue;
      }
      const ref = refs.get(edit.ref);
      if (!ref) throw new Error(`reference ${edit.ref} is not in cell ${cell}`);
      if (formIdIndex(ref.record.formId) !== own)
        throw new Error(`reference ${edit.ref} belongs to a master and is not edited (D22)`);
    }
    const added: FormKey[] = [];
    for (const edit of edits) {
      if (edit.kind === 'navmesh') {
        if (edit.navm && !edit.nav) this.plugin.deleteNavm(entry, navms.get(edit.navm)!);
        else if (edit.navm) await this.plugin.setNavm(navms.get(edit.navm)!, edit.nav!);
        else added.push(this.formKey(this.plugin.addNavm(entry, edit.nav!).formId));
      } else if (edit.kind === 'remove') this.plugin.deleteRefr(entry, refs.get(edit.ref)!);
      else if (edit.kind === 'move') this.plugin.moveRefr(refs.get(edit.ref)!, edit);
      else {
        const record = this.plugin.addRefr(entry, {
          base: fromFormKey(edit.base, masters, name),
          pos: edit.pos,
          rot: edit.rot,
          scale: edit.scale,
        });
        added.push(this.formKey(record.formId));
      }
    }
    return added;
  }

  async finalize(
    cell: FormKey,
    masterNavi: () => Promise<MasterNavi | undefined>,
  ): Promise<FinalizeReport> {
    const entry = (await this.cellMap()).get(cell);
    if (!entry) throw new Error(`cell ${cell} is not an interior cell of ${this.name}`);
    const own = this.plugin.ownIndex;
    const navms = await this.plugin.cellNavms(entry);
    if (!navms.length) throw new Error('the cell has no NavMesh');
    const foreign = navms.find((n) => formIdIndex(n.record.formId) !== own);
    if (foreign)
      throw new Error(
        `NavMesh ${this.formKey(foreign.record.formId)} belongs to a master: finalize in the Creation Kit`,
      );

    // load doors: every reference with a teleport; the arrival marker of a door is in the
    // XTEL of the door leading to it (any cell of the plugin, overrides included)
    const teleports = new Map<number, { to: number; pos: Vec3 }>();
    const records = new Map<number, (typeof navms)[number]['record']>();
    for (const record of this.plugin.recordsOfType('REFR')) {
      const xtel = findSubrecord(await recordSubrecords(record), 'XTEL');
      if (!xtel || xtel.data.byteLength < 16) continue;
      const v = new DataView(xtel.data.buffer, xtel.data.byteOffset, xtel.data.byteLength);
      teleports.set(record.formId, {
        to: v.getUint32(0, true),
        pos: [v.getFloat32(4, true), v.getFloat32(8, true), v.getFloat32(12, true)],
      });
      records.set(record.formId, record);
    }
    const doors = (await this.plugin.cellRefs(entry))
      .filter((r) => teleports.has(r.record.formId))
      .map((r) => {
        const back = teleports.get(teleports.get(r.record.formId)!.to);
        return { ref: r.record.formId, pos: r.info.pos, ...(back ? { arrival: back.pos } : {}) };
      });

    const result = finalizeCell(
      entry.record.formId,
      navms.map((n) => ({ formId: n.record.formId, nav: n.nav })),
      doors,
    );
    for (let i = 0; i < navms.length; i++)
      await this.plugin.setNavm(navms[i]!.record, result.navms[i]!);
    const masterDoors: FormKey[] = [];
    for (const link of result.links) {
      const record = records.get(link.ref)!;
      if (formIdIndex(record.formId) !== own) masterDoors.push(this.formKey(record.formId));
      else await this.plugin.setDoorNavmesh(record, link.navm, link.triangle);
    }

    // the NAVI override: the cell's entries replaced, the others kept as they are
    const existing = this.plugin.navi();
    let fields: Subrecord[];
    let naviId: number;
    if (existing) {
      fields = await recordSubrecords(existing);
      naviId = existing.formId;
    } else {
      const master = await masterNavi();
      if (!master) throw new Error('no NAVI record found in the masters');
      naviId = fromFormKey(master.key, this.plugin.masters, this.plugin.name);
      fields = [
        { type: 'NVER', data: new BinaryWriter(4).u32(master.version).toUint8Array() },
        ...(master.nvpp ? [{ type: 'NVPP', data: master.nvpp }] : []),
      ];
    }
    const cellId = entry.record.formId;
    const kept = fields.filter((f) => {
      if (f.type !== 'NVMI') return false;
      const info = decodeNvmi(f.data);
      // the cell's own entries are rewritten, those of NAVMs gone from it dropped
      return !(info.parent.kind === 'cell' && info.parent.cell === cellId);
    });
    this.plugin.setNavi(naviId, [
      ...fields.filter((f) => f.type === 'EDID' || f.type === 'NVER'),
      ...kept,
      ...result.infos.map((info) => ({ type: 'NVMI', data: encodeNvmi(info) })),
      ...fields.filter((f) => !['EDID', 'NVER', 'NVMI'].includes(f.type)),
    ]);
    return {
      navmeshes: navms.length,
      doors: result.links.length,
      missed: result.missed.map((id) => this.formKey(id)),
      masterDoors,
      islands: result.infos.filter((i) => i.island).length,
    };
  }

  async addCell(editorId: string): Promise<FormKey> {
    if (!/^[A-Za-z0-9_]+$/.test(editorId))
      throw new Error(`"${editorId}" is not a valid EditorID (letters, digits and _ only)`);
    const cells = await this.cellMap();
    for (const entry of cells.values()) {
      if (entry.info.editorId.toLowerCase() === editorId.toLowerCase())
        throw new Error(`${this.name} already has a cell named ${editorId}`);
    }
    const entry = this.plugin.addInteriorCell(editorId);
    const key = this.formKey(entry.record.formId);
    cells.set(key, entry);
    return key;
  }

  serialize(): Uint8Array {
    return this.plugin.write();
  }
}
