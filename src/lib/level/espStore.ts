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

interface Placement {
  pos: Vec3;
  rot: Vec3;
}

/**
 * Where a placement tied to a reference goes when the reference moves from `from` to `to`:
 * its offset turns by the Z angle the reference turned (a clockwise heading) and follows it.
 */
export function followPlacement(p: Placement, from: Placement, to: Placement): Placement {
  const turn = to.rot[2] - from.rot[2];
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const x = p.pos[0] - from.pos[0];
  const y = p.pos[1] - from.pos[1];
  const z = (((p.rot[2] + turn) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return {
    pos: [to.pos[0] + x * c + y * s, to.pos[1] - x * s + y * c, to.pos[2] + p.pos[2] - from.pos[2]],
    rot: [p.rot[0], p.rot[1], z],
  };
}

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

  async applyEdits(
    cell: FormKey,
    edits: readonly LevelEdit[],
    notes?: string[],
  ): Promise<FormKey[]> {
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
    const moved = new Map<number, { from: Placement; to: Placement }>();
    for (const edit of edits) {
      if (edit.kind === 'navmesh') {
        if (edit.navm && !edit.nav) this.plugin.deleteNavm(entry, navms.get(edit.navm)!);
        else if (edit.navm) await this.plugin.setNavm(navms.get(edit.navm)!, edit.nav!);
        else added.push(this.formKey(this.plugin.addNavm(entry, edit.nav!).formId));
      } else if (edit.kind === 'remove') this.plugin.deleteRefr(entry, refs.get(edit.ref)!);
      else if (edit.kind === 'move') {
        const ref = refs.get(edit.ref)!;
        moved.set(ref.record.formId, { from: ref.info, to: edit });
        this.plugin.moveRefr(ref, edit);
      } else {
        const record = this.plugin.addRefr(entry, {
          base: fromFormKey(edit.base, masters, name),
          pos: edit.pos,
          rot: edit.rot,
          scale: edit.scale,
        });
        added.push(this.formKey(record.formId));
      }
    }
    await this.followMovedDoors(moved, notes);
    return added;
  }

  /**
   * The doors leading to a moved door (R23): their XTEL arrival sits in front of it, so it
   * moves and turns with it. Only the plugin's own doors are written (D22); a master's door
   * or an override is left as it is and noted, to fix in the Creation Kit.
   */
  private async followMovedDoors(
    moved: ReadonlyMap<number, { from: Placement; to: Placement }>,
    notes?: string[],
  ): Promise<void> {
    if (!moved.size) return;
    const own = this.plugin.ownIndex;
    const leadsTo = new Map<number, number>();
    const followed = new Set<number>();
    for (const record of this.plugin.recordsOfType('REFR')) {
      const xtel = findSubrecord(await recordSubrecords(record), 'XTEL');
      if (!xtel || xtel.data.byteLength < 28) continue;
      const v = new DataView(xtel.data.buffer, xtel.data.byteOffset, xtel.data.byteLength);
      const to = v.getUint32(0, true);
      if (moved.has(record.formId)) leadsTo.set(record.formId, to);
      const move = moved.get(to);
      if (!move) continue;
      followed.add(record.formId);
      if (formIdIndex(record.formId) !== own) {
        notes?.push(
          `door ${this.formKey(record.formId)} leads to a moved door but is not this plugin's own: ` +
            'set its teleport again in the Creation Kit',
        );
        continue;
      }
      const f = (i: number) => v.getFloat32(4 + i * 4, true);
      const arrival = followPlacement(
        { pos: [f(0), f(1), f(2)], rot: [f(3), f(4), f(5)] },
        move.from,
        move.to,
      );
      await this.plugin.setTeleportArrival(record, arrival.pos, arrival.rot);
    }
    // a master's door not overridden here is not in the plugin at all
    for (const [door, to] of leadsTo)
      if (!followed.has(to))
        notes?.push(
          `moved door ${this.formKey(door)} leads to ${this.formKey(to)}, which is not in this ` +
            "plugin: set that door's teleport again in the Creation Kit",
        );
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
