/** `.esp` backend of the level store (D57): a parsed plugin, read in place. */
import { formIdIndex, toFormKey } from '../format/esp/formId';
import { Plugin, type CellEntry } from '../format/esp/plugin';
import type { FormKey } from '../catalogue/types';
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
}
