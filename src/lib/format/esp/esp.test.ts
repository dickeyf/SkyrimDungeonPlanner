import { describe, expect, it } from 'vitest';
import { BinaryWriter } from '../../binary/BinaryWriter';
import { fromFormKey, toFormKey } from './formId';
import { Plugin } from './plugin';
import { GroupType, RecordFlags, countNodes, parseNodes } from './records';
import { parseSubrecords, recordData, writeSubrecords } from './subrecords';
import { buildPlugin, record, refrRecord } from './testPlugin';

const HALL = 0x00034a4c; // some STAT in Skyrim.esm (index 0)

function sample(): Uint8Array {
  return buildPlugin({
    refs: [
      refrRecord(0x01000d63, { base: HALL, pos: [0, 0, 0], rot: [0, 0, 0] }),
      refrRecord(0x01000d64, {
        base: HALL,
        pos: [256, 0, 0],
        rot: [0, 0, Math.PI / 2],
        scale: 1.5,
      }),
    ],
  });
}

describe('round trip', () => {
  it('writes an untouched plugin back byte for byte', () => {
    const bytes = sample();
    const plugin = Plugin.parse(bytes, 'Sample.esp');
    expect(plugin.write()).toEqual(bytes);
  });

  it('keeps the header counters consistent with the tree', () => {
    const plugin = Plugin.parse(sample(), 'Sample.esp');
    expect(plugin.header.numRecords).toBe(plugin.countNodes());
    expect(plugin.header.masters).toEqual(['Skyrim.esm']);
    expect(plugin.header.author).toBe('tests');
    expect(plugin.summary()).toEqual([
      { type: 'REFR', records: 2 },
      { type: 'CELL', records: 1 },
    ]);
  });

  it('rejects non-plugins and ESL-flagged plugins', () => {
    expect(() => Plugin.parse(new Uint8Array(40), 'x.esp')).toThrow();
    const esl = buildPlugin({});
    // set the light flag on TES4 (flags at offset 8)
    new DataView(esl.buffer).setUint32(8, RecordFlags.light, true);
    expect(() => Plugin.parse(esl, 'x.esp')).toThrow('ESL');
  });

  it('reports truncated or inconsistent groups', () => {
    const bytes = sample();
    expect(() => parseNodes(bytes.subarray(0, bytes.length - 10))).toThrow();
  });
});

describe('cells and references', () => {
  it('lists interior cells with their references', async () => {
    const plugin = Plugin.parse(sample(), 'Sample.esp');
    const cells = await plugin.interiorCells();
    expect(cells.map((c) => c.info.editorId)).toEqual(['MyDungeonCell01']);
    expect(cells[0]!.info.interior).toBe(true);
    const refs = await plugin.cellRefs(cells[0]!);
    expect(refs.map((r) => r.groupType)).toEqual([
      GroupType.cellTemporaryChildren,
      GroupType.cellTemporaryChildren,
    ]);
    expect(refs[1]!.info).toEqual({
      editorId: undefined,
      base: HALL,
      pos: [256, 0, 0],
      rot: [0, 0, expect.closeTo(Math.PI / 2, 6)],
      scale: 1.5,
    });
  });

  it('adds a reference: new FormID, counters and group sizes updated, re-parseable', async () => {
    const bytes = sample();
    const plugin = Plugin.parse(bytes, 'Sample.esp');
    const before = plugin.header;
    const cell = (await plugin.interiorCells())[0]!;
    const added = plugin.addRefr(cell, { base: HALL, pos: [512, 0, 0], rot: [0, 0, Math.PI] });
    expect(added.formId).toBe(0x01000d70);
    expect(plugin.header.nextObjectId).toBe(before.nextObjectId + 1);
    expect(plugin.header.numRecords).toBe(before.numRecords + 1);

    const out = plugin.write();
    expect(out.length).toBe(bytes.length + 24 + added.data.length);
    const again = Plugin.parse(out, 'Sample.esp');
    const refs = await again.cellRefs((await again.interiorCells())[0]!);
    expect(refs.map((r) => r.record.formId)).toEqual([0x01000d63, 0x01000d64, 0x01000d70]);
    expect(refs[2]!.info.pos).toEqual([512, 0, 0]);
  });

  it('creates the child groups when a cell has none', async () => {
    const plugin = Plugin.parse(buildPlugin({ withChildren: false }), 'Sample.esp');
    const cell = (await plugin.interiorCells())[0]!;
    expect(cell.children).toBeUndefined();
    plugin.addRefr(cell, { base: HALL, pos: [0, 0, 0], rot: [0, 0, 0] });
    const again = Plugin.parse(plugin.write(), 'Sample.esp');
    const cells = await again.interiorCells();
    expect(
      cells[0]!.children?.children.map((g) => (g.kind === 'group' ? g.groupType : -1)),
    ).toEqual([GroupType.cellTemporaryChildren]);
    expect((await again.cellRefs(cells[0]!)).length).toBe(1);
    expect(again.header.numRecords).toBe(again.countNodes());
  });

  it('moves and deletes own references, refuses master overrides', async () => {
    const plugin = Plugin.parse(sample(), 'Sample.esp');
    const cell = (await plugin.interiorCells())[0]!;
    const refs = await plugin.cellRefs(cell);
    plugin.moveRefr(refs[1]!, { pos: [1, 2, 3], rot: [0, 0, 0], scale: 1 });
    const moved = await plugin.cellRefs(cell);
    expect(moved[1]!.info.pos).toEqual([1, 2, 3]);
    expect(moved[1]!.info.scale).toBe(1); // XSCL removed
    plugin.deleteRefr(cell, moved[0]!);
    expect((await plugin.cellRefs(cell)).length).toBe(1);
    expect(plugin.header.numRecords).toBe(plugin.countNodes());

    const foreign = { ...moved[1]!, record: { ...moved[1]!.record, formId: 0x00012345 } };
    expect(() => plugin.moveRefr(foreign, { pos: [0, 0, 0], rot: [0, 0, 0] })).toThrow('master');
  });
});

describe('subrecords', () => {
  it('handles XXXX oversized fields both ways', () => {
    const big = new Uint8Array(70000).fill(7);
    const bytes = writeSubrecords([
      { type: 'EDID', data: new Uint8Array([65, 0]) },
      { type: 'BLOB', data: big },
    ]);
    const subs = parseSubrecords(bytes);
    expect(subs.map((s) => [s.type, s.data.length])).toEqual([
      ['EDID', 2],
      ['BLOB', 70000],
    ]);
  });

  it('inflates compressed records', async () => {
    const plain = writeSubrecords([{ type: 'EDID', data: new Uint8Array([66, 0]) }]);
    const zipped = new Uint8Array(
      await new Response(
        new Blob([plain.slice().buffer as ArrayBuffer])
          .stream()
          .pipeThrough(new CompressionStream('deflate')),
      ).arrayBuffer(),
    );
    const data = new BinaryWriter().u32(plain.length).raw(zipped).toUint8Array();
    const rec = record('STAT', 0x00000abc, data, RecordFlags.compressed);
    expect(await recordData(rec)).toEqual(plain);
  });
});

describe('form keys', () => {
  it('maps FormIDs to load-order independent keys and back', () => {
    const masters = ['Skyrim.esm', 'Update.esm'];
    expect(toFormKey(0x00034a4c, masters, 'MyDungeon.esp')).toBe('0x00034A4C:Skyrim.esm');
    expect(toFormKey(0x01000800, masters, 'MyDungeon.esp')).toBe('0x00000800:Update.esm');
    expect(toFormKey(0x02000d62, masters, 'MyDungeon.esp')).toBe('0x00000D62:MyDungeon.esp');
    expect(fromFormKey('0x00000D62:mydungeon.esp', masters, 'MyDungeon.esp')).toBe(0x02000d62);
    expect(() => fromFormKey('0x1:Nope.esm', masters, 'MyDungeon.esp')).toThrow('not a master');
  });

  it('counts nodes like HEDR does', () => {
    // top + block + sub-block + CELL + children + persistent + temporary + 2 REFR
    expect(countNodes(parseNodes(sample()).slice(1))).toBe(9);
  });
});
