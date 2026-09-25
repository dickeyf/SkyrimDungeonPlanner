import { describe, expect, it } from 'vitest';
import {
  FIRST_OBJECT_ID,
  PLUGIN_VERSION,
  interiorBlockOf,
  newPluginBytes,
} from '../format/esp/create';
import { Plugin } from '../format/esp/plugin';
import { GroupType, labelToType, typeToLabel, type EspGroup } from '../format/esp/records';
import { FakeDir } from '../fs/fakeFs';
import { EspLevelStore } from './espStore';
import { mastersFor } from './masters';
import { createPluginFile } from './save';

const HALL_KEY = '0x00035B77:Skyrim.esm';

describe('a new plugin', () => {
  it('starts with a bare header and the given masters', () => {
    const plugin = Plugin.parse(
      newPluginBytes({ masters: ['Skyrim.esm', 'Update.esm'] }),
      'NewDungeon.esp',
    );
    const h = plugin.header;
    expect(h.version).toBeCloseTo(PLUGIN_VERSION, 5);
    expect(h.masters).toEqual(['Skyrim.esm', 'Update.esm']);
    expect(h.nextObjectId).toBe(FIRST_OBJECT_ID);
    expect(h.numRecords).toBe(0);
    expect(plugin.nodes).toEqual([]);
  });

  it('gets interior cells in their block and sub-block, and tiles in them', async () => {
    const store = EspLevelStore.parse(newPluginBytes({ masters: ['Skyrim.esm'] }), 'New.esp');
    const first = await store.addCell('NewDungeon01');
    const second = await store.addCell('NewDungeon02');
    expect([first, second]).toEqual(['0x00000800:New.esp', '0x00000801:New.esp']);
    await expect(store.addCell('newdungeon01')).rejects.toThrow('already has a cell');
    await expect(store.addCell('Bad name')).rejects.toThrow('not a valid EditorID');
    await store.applyEdits(first, [
      { kind: 'add', base: HALL_KEY, pos: [128, 128, 0], rot: [0, 0, 0], scale: 1 },
    ]);

    const again = EspLevelStore.parse(store.serialize(), 'New.esp');
    expect((await again.listCells()).map((c) => [c.key, c.editorId, c.placedCount])).toEqual([
      ['0x00000800:New.esp', 'NewDungeon01', 1],
      ['0x00000801:New.esp', 'NewDungeon02', 0],
    ]);
    const plugin = again.plugin;
    expect(plugin.header.nextObjectId).toBe(0x803);
    // top group, 2 blocks, 2 sub-blocks, 2 cells, the first cell's children + temporary groups
    // and its reference
    expect(plugin.header.numRecords).toBe(plugin.countNodes());
    const top = plugin.topGroup('CELL')!;
    const { block, subBlock } = interiorBlockOf(0x800); // 2048: block 8, sub-block 4
    expect([block, subBlock]).toEqual([8, 4]);
    const b = top.children.find((n): n is EspGroup => n.kind === 'group' && n.label === 8)!;
    expect(b.groupType).toBe(GroupType.interiorCellBlock);
    expect((b.children[0] as EspGroup).label).toBe(4);
  });

  it('puts a new CELL group before the groups that follow it', async () => {
    const bytes = newPluginBytes({ masters: ['Skyrim.esm'] });
    const plugin = Plugin.parse(bytes, 'X.esp');
    plugin.nodes.push({
      kind: 'group',
      label: typeToLabel('WRLD'),
      groupType: 0,
      timestamp: 0,
      vcsInfo: 0,
      unknown: 0,
      children: [],
    });
    plugin.addInteriorCell('Cell01');
    expect(plugin.nodes.map((n) => (n.kind === 'group' ? labelToType(n.label) : n.type))).toEqual([
      'CELL',
      'WRLD',
    ]);
  });
});

describe('createPluginFile', () => {
  it('writes a new .esp and refuses to overwrite one', async () => {
    const dir = new FakeDir('MyMod', { 'Existing.esp': new Uint8Array([1]) });
    const bytes = newPluginBytes({ masters: ['Skyrim.esm'] });
    const stamp = await createPluginFile(dir, 'NewDungeon.esp', bytes);
    expect(stamp.size).toBe(bytes.byteLength);
    await expect(createPluginFile(dir, 'existing.ESP', bytes)).rejects.toThrow('already exists');
    await expect(createPluginFile(dir, 'Nope.esm', bytes)).rejects.toThrow('.esp');
  });
});

describe('mastersFor', () => {
  it('keeps Skyrim.esm and the owners of the pieces, in load order', () => {
    const order = ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'Other.esp'];
    expect(mastersFor(['0x1:Dawnguard.esm', '0x2:skyrim.esm'], order)).toEqual([
      'Skyrim.esm',
      'Dawnguard.esm',
    ]);
  });
});
