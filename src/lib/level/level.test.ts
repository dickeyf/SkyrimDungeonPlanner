import { describe, expect, it } from 'vitest';
import type { Catalogue, Piece } from '../catalogue/types';
import { buildPlugin, refrRecord } from '../format/esp/testPlugin';
import { EspLevelStore } from './espStore';
import { loadCell, piecesByFormKey } from './loadCell';
import { summarizeCell } from './summary';

const HALL_ID = 0x00035b77; // a Skyrim.esm STAT (master index 0)
const HALL_KEY = '0x00035B77:Skyrim.esm';

function catalogue(): Catalogue {
  const hall: Piece = {
    editorId: 'ImpHall1Way01',
    formKey: HALL_KEY,
    model: 'Dungeons\\Imperial\\SmallHall\\ImpHall1Way01.nif',
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
  return {
    version: 1,
    kits: [{ kit: 'Imperial', module: { xy: 128, z: 128 } }],
    connectionTypes: [],
    pieces: [hall],
  };
}

function store(): EspLevelStore {
  const bytes = buildPlugin({
    cellFormId: 0x01000d62,
    cellEditorId: 'MyDungeonCell01',
    refs: [
      refrRecord(0x01000d63, { base: HALL_ID, pos: [128, 128, -512], rot: [0, 0, 0] }),
      refrRecord(0x01000d64, { base: HALL_ID, pos: [128, 384, -512], rot: [0, 0, 0] }),
      refrRecord(0x01000d65, { base: 0x000abcde, pos: [300, 300, -500], rot: [0, 0, 0] }),
      refrRecord(0x00012345, { base: HALL_ID, pos: [128, 640, -512], rot: [0, 0, 0] }),
    ],
  });
  return EspLevelStore.parse(bytes, 'MyDungeon.esp');
}

describe('EspLevelStore', () => {
  it('lists interior cells by FormKey', async () => {
    const cells = await store().listCells();
    expect(cells).toEqual([
      { key: '0x00000D62:MyDungeon.esp', editorId: 'MyDungeonCell01', name: '', placedCount: 4 },
    ]);
  });

  it('reads references with FormKeys and ownership', async () => {
    const s = store();
    const refs = await s.readRefs('0x00000D62:MyDungeon.esp');
    expect(refs.map((r) => [r.key, r.base, r.own])).toEqual([
      ['0x00000D63:MyDungeon.esp', HALL_KEY, true],
      ['0x00000D64:MyDungeon.esp', HALL_KEY, true],
      ['0x00000D65:MyDungeon.esp', '0x000ABCDE:Skyrim.esm', true],
      ['0x00012345:Skyrim.esm', HALL_KEY, false],
    ]);
    await expect(s.readRefs('0x00000001:MyDungeon.esp')).rejects.toThrow('not an interior cell');
  });
});

describe('loadCell', () => {
  it('derives the grid with the catalogue and counts master overrides', async () => {
    const loaded = await loadCell(store(), '0x00000D62:MyDungeon.esp', catalogue());
    expect(loaded.grid.tiles.map((t) => t.cell)).toEqual([
      [0, 0, 0],
      [0, 2, 0],
      [0, 4, 0],
    ]);
    expect(loaded.grid.anchor.origin).toEqual([0, 0, -512]);
    expect(loaded.grid.opaque.map((o) => o.reason)).toEqual(['unknown-base']);
    expect(loaded.foreignTiles).toBe(1);
  });

  it('refuses a catalogue without a measured module', async () => {
    const c = catalogue();
    c.kits[0]!.module = { xy: null, z: null };
    await expect(loadCell(store(), '0x00000D62:MyDungeon.esp', c)).rejects.toThrow('module');
  });
});

describe('summarizeCell', () => {
  it('counts tiles by category and opaque references by reason and base', async () => {
    const c = catalogue();
    const loaded = await loadCell(store(), '0x00000D62:MyDungeon.esp', c);
    expect(summarizeCell(loaded, piecesByFormKey(c))).toEqual({
      byCategory: [['hall', 3]],
      reasons: [['unknown-base', 1]],
      topBases: [['0x000ABCDE:Skyrim.esm', 1]],
    });
  });
});

describe('scene objects', () => {
  it('draws own tiles in category colours, master tiles and other objects apart', async () => {
    const { sceneObjects, sceneGrid, CATEGORY_COLORS } = await import('../render/sceneObjects');
    const c = catalogue();
    const loaded = await loadCell(store(), '0x00000D62:MyDungeon.esp', c);
    const objects = sceneObjects(
      loaded,
      c,
      new Map([['0x000ABCDE:Skyrim.esm', 'Clutter/Pot.nif']]),
    );
    expect(objects.map((o) => [o.color, o.pickable, o.modelPath])).toEqual([
      [CATEGORY_COLORS.hall, true, 'meshes/dungeons/imperial/smallhall/imphall1way01.nif'],
      [CATEGORY_COLORS.hall, true, 'meshes/dungeons/imperial/smallhall/imphall1way01.nif'],
      [CATEGORY_COLORS.foreign, true, 'meshes/dungeons/imperial/smallhall/imphall1way01.nif'],
      [CATEGORY_COLORS.opaque, false, 'meshes/clutter/pot.nif'],
    ]);
    expect(sceneGrid(loaded, 1)!.range).toEqual([-1, 3, -1, 7]);
  });
});
