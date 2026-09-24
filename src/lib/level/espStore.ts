/** `.esp` backend of the level store (D57): a parsed plugin, read in place. */
import { formIdIndex, fromFormKey, toFormKey } from '../format/esp/formId';
import { Plugin, type CellEntry } from '../format/esp/plugin';
import type { FormKey } from '../catalogue/types';
import type { LevelEdit } from './edits';
import type { LevelCell, LevelRef, LevelStore } from './store';

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

  async applyEdits(cell: FormKey, edits: readonly LevelEdit[]): Promise<FormKey[]> {
    const entry = (await this.cellMap()).get(cell);
    if (!entry) throw new Error(`cell ${cell} is not an interior cell of ${this.name}`);
    const refs = new Map(
      (await this.plugin.cellRefs(entry)).map((r) => [this.formKey(r.record.formId), r]),
    );
    const own = this.plugin.ownIndex;
    const { masters, name } = this.plugin;
    // check everything first, so a refused edit leaves the plugin untouched
    for (const edit of edits) {
      if (edit.kind === 'add') {
        fromFormKey(edit.base, masters, name); // throws when the base's plugin is not a master
        continue;
      }
      const ref = refs.get(edit.ref);
      if (!ref) throw new Error(`reference ${edit.ref} is not in cell ${cell}`);
      if (formIdIndex(ref.record.formId) !== own)
        throw new Error(`reference ${edit.ref} belongs to a master and is not edited (D22)`);
    }
    const added: FormKey[] = [];
    for (const edit of edits) {
      if (edit.kind === 'remove') this.plugin.deleteRefr(entry, refs.get(edit.ref)!);
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

  serialize(): Uint8Array {
    return this.plugin.write();
  }
}
