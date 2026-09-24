import { describe, expect, it } from 'vitest';
import type { Piece } from '../catalogue/types';
import { buildPlugin, refrRecord } from '../format/esp/testPlugin';
import { Plugin } from '../format/esp/plugin';
import { FakeDir, FakeFile } from '../fs/fakeFs';
import { addTile, changes, layoutFromGrid, moveTile, removeTile, type Layout } from '../grid/edit';
import { editsFromChanges } from './edits';
import { EspLevelStore } from './espStore';
import { loadCell } from './loadCell';
import { BACKUP_FOLDER, backupName, savePlugin, stampOf } from './save';

const HALL_ID = 0x00035b77;
const HALL_KEY = '0x00035B77:Skyrim.esm';
const CELL = '0x00000D62:MyDungeon.esp';

const HALL: Piece = {
  editorId: 'ImpHall1Way01',
  formKey: HALL_KEY,
  model: 'hall.nif',
  kit: 'Imperial',
  class: 'tile',
  category: 'hall',
  pivot: [128, 128, 0],
  cells: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
  ],
  faces: [],
  walkable: null,
  obstacle: null,
  review: { auto: true, validated: true },
};
const PIECES = new Map([[HALL_KEY, HALL]]);
const CATALOGUE = {
  version: 1 as const,
  kits: [{ kit: 'Imperial', module: { xy: 128, z: 128 } }],
  connectionTypes: [],
  pieces: [HALL],
};

function bytes(): Uint8Array {
  return buildPlugin({
    refs: [
      refrRecord(0x01000d63, { base: HALL_ID, pos: [128, 128, -512], rot: [0, 0, 0] }),
      refrRecord(0x01000d64, { base: HALL_ID, pos: [128, 384, -512], rot: [0, 0, 0] }),
      refrRecord(0x00012345, { base: HALL_ID, pos: [128, 640, -512], rot: [0, 0, 0] }),
    ],
  });
}

async function edited(store: EspLevelStore) {
  const loaded = await loadCell(store, CELL, CATALOGUE);
  const original = layoutFromGrid(loaded.grid, new Map(loaded.refs.map((r) => [r.key, r.own])));
  let layout: Layout = original;
  for (const step of [
    (l: Layout) => addTile(l, PIECES, HALL_KEY, [4, 0, 0], 1),
    (l: Layout) => moveTile(l, PIECES, '0x00000D64:MyDungeon.esp', [4, 2, 0]),
    (l: Layout) => removeTile(l, '0x00000D63:MyDungeon.esp'),
  ]) {
    const r = step(layout);
    if (!r.ok) throw new Error('edit refused');
    layout = r.layout;
  }
  return editsFromChanges(changes(original, layout), PIECES, loaded.grid.anchor);
}

describe('applying edits to the plugin', () => {
  it('adds, moves and removes references, and reads back as edited', async () => {
    const store = EspLevelStore.parse(bytes(), 'MyDungeon.esp');
    const edits = await edited(store);
    expect(edits.map((e) => e.kind)).toEqual(['remove', 'move', 'add']);
    const added = await store.applyEdits(CELL, edits);
    expect(added).toEqual(['0x00000D70:MyDungeon.esp']);

    const out = store.serialize();
    const again = EspLevelStore.parse(out, 'MyDungeon.esp');
    const refs = await again.readRefs(CELL);
    expect(refs.map((r) => [r.key, r.pos])).toEqual([
      ['0x00000D64:MyDungeon.esp', [640, 384, -512]],
      ['0x00012345:Skyrim.esm', [128, 640, -512]],
      ['0x00000D70:MyDungeon.esp', [384, 128, -512]],
    ]);
    // the added hall is turned a quarter: stored as a clockwise heading of -90 degrees
    expect(refs[2]!.rot[2]).toBeCloseTo(-Math.PI / 2 + 2 * Math.PI, 5);
    const loaded = await loadCell(again, CELL, CATALOGUE);
    expect(loaded.grid.tiles.map((t) => [t.cell, t.rotation])).toEqual([
      [[4, 2, 0], 0],
      [[0, 4, 0], 0],
      [[4, 0, 0], 1],
    ]);
    expect(Plugin.parse(out, 'MyDungeon.esp').header.nextObjectId).toBe(0x0d71);
  });

  it('refuses the whole batch when one edit is not allowed', async () => {
    const original = bytes();
    const store = EspLevelStore.parse(original, 'MyDungeon.esp');
    const edits = await edited(store);
    await expect(
      store.applyEdits(CELL, [...edits, { kind: 'remove', ref: '0x00012345:Skyrim.esm' }]),
    ).rejects.toThrow('belongs to a master');
    await expect(
      store.applyEdits(CELL, [
        { kind: 'add', base: '0x00000001:Other.esp', pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 },
      ]),
    ).rejects.toThrow('not a master');
    expect(store.serialize()).toEqual(original);
  });
});

describe('savePlugin', () => {
  const when = new Date(2026, 8, 24, 14, 5, 9);

  it('names backups with a timestamp and a .bak extension', () => {
    expect(backupName('MyDungeon.esp', when)).toBe('MyDungeon.20260924-140509.esp.bak');
  });

  it('backs up the current file, then replaces it', async () => {
    const plugin = new FakeFile('MyDungeon.esp', new Uint8Array([1, 2, 3]));
    const dir = new FakeDir('mod', { 'MyDungeon.esp': plugin });
    const loaded = await stampOf(dir, 'MyDungeon.esp');
    const result = await savePlugin({
      dir,
      name: 'MyDungeon.esp',
      loaded,
      bytes: new Uint8Array([4, 5]),
      now: when,
    });
    expect(result.backup).toBe(`${BACKUP_FOLDER}/MyDungeon.20260924-140509.esp.bak`);
    const backups = dir.children.get(BACKUP_FOLDER) as FakeDir;
    const copy = backups.children.get('MyDungeon.20260924-140509.esp.bak') as FakeFile;
    expect([...copy.content]).toEqual([1, 2, 3]);
    expect([...plugin.content]).toEqual([4, 5]);
    expect(result.stamp).toEqual(await stampOf(dir, 'MyDungeon.esp'));
  });

  it('refuses to overwrite a file changed on disk since it was loaded', async () => {
    const plugin = new FakeFile('MyDungeon.esp', new Uint8Array([1, 2, 3]));
    const dir = new FakeDir('mod', { 'MyDungeon.esp': plugin });
    const loaded = await stampOf(dir, 'MyDungeon.esp');
    plugin.lastModified += 1; // the CK saved it
    await expect(
      savePlugin({ dir, name: 'MyDungeon.esp', loaded, bytes: new Uint8Array([9]) }),
    ).rejects.toThrow('changed on disk');
    expect([...plugin.content]).toEqual([1, 2, 3]);
    expect(dir.children.has(BACKUP_FOLDER)).toBe(false);
  });
});
