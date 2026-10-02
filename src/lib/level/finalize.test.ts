import { describe, expect, it } from 'vitest';
import { BinaryWriter } from '../binary/BinaryWriter';
import type { Vec3 } from '../catalogue/types';
import { encodeRefr } from '../format/esp/cellRefr';
import { decodeNvmi, PATHING_DOOR_CRC } from '../format/esp/navi';
import { findSubrecord, recordSubrecords, writeSubrecords } from '../format/esp/subrecords';
import { buildPlugin, record } from '../format/esp/testPlugin';
import { buildNavMesh } from '../navmesh/build';
import { EspLevelStore } from './espStore';

const CELL = '0x00000D62:MyDungeon.esp';
const DOOR_BASE = 0x00031897; // a Skyrim.esm DOOR

/** A door reference with a teleport to `to`, landing at `arrival`. */
function door(formId: number, pos: Vec3, to: number, arrival: Vec3) {
  const xtel = new BinaryWriter(32).u32(to);
  for (const v of [...arrival, 0, 0, 0]) xtel.f32(v);
  xtel.u32(0);
  const data = encodeRefr({ base: DOOR_BASE, pos, rot: [0, 0, 0] });
  const tail = writeSubrecords([{ type: 'XTEL', data: xtel.toUint8Array() }]);
  const bytes = new Uint8Array(data.length + tail.length);
  bytes.set(data);
  bytes.set(tail, data.length);
  return record('REFR', formId, bytes);
}

describe('EspLevelStore.finalize', () => {
  it('links the load doors, writes their XNDP and the NAVI override', async () => {
    // two doors of the cell leading to each other; each lands in front of the other
    const level = EspLevelStore.parse(
      buildPlugin({
        refs: [
          door(0x01000d70, [10, 300, 0], 0x01000d71, [180, 20, 0]),
          door(0x01000d71, [200, -100, 0], 0x01000d70, [20, 180, 0]),
        ],
      }),
      'MyDungeon.esp',
    );
    const nav = buildNavMesh(
      0x01000d62,
      [
        [0, 0, 0],
        [200, 0, 0],
        [200, 200, 0],
        [0, 200, 0],
      ],
      [
        [0, 1, 2],
        [0, 2, 3],
      ],
    );
    const [navm] = await level.applyEdits(CELL, [{ kind: 'navmesh', nav }]);
    const nvpp = new Uint8Array([1, 2, 3, 4]);
    const report = await level.finalize(CELL, async () => ({
      key: '0x00012FB4:Skyrim.esm',
      version: 12,
      nvpp,
    }));
    expect(report).toMatchObject({ navmeshes: 1, doors: 2, missed: [], islands: 0 });

    const reread = EspLevelStore.parse(level.serialize(), 'MyDungeon.esp');
    const [after] = await reread.readNavMeshes(CELL);
    // door 0x...D70 lands at (20, 180): triangle 1; door 0x...D71 at (180, 20): triangle 0
    expect(after!.nav.doorLinks).toEqual([
      { triangle: 1, crc: PATHING_DOOR_CRC, door: 0x01000d70 },
      { triangle: 0, crc: PATHING_DOOR_CRC, door: 0x01000d71 },
    ]);
    expect(after!.nav.triangles.every((t) => t.flags & 0x400)).toBe(true);
    const navmId = reread.plugin.recordsOfType('NAVM')[0]!.formId;
    expect(navm).toContain('MyDungeon.esp');

    const xndp = async (formId: number) => {
      const r = reread.plugin.recordsOfType('REFR').find((x) => x.formId === formId)!;
      const f = findSubrecord(await recordSubrecords(r), 'XNDP')!;
      const v = new DataView(f.data.buffer, f.data.byteOffset, 8);
      return [v.getUint32(0, true), v.getInt16(4, true)];
    };
    expect(await xndp(0x01000d70)).toEqual([navmId, 1]);
    expect(await xndp(0x01000d71)).toEqual([navmId, 0]);

    const navi = reread.plugin.navi()!;
    expect(navi.formId).toBe(0x00012fb4);
    const fields = await recordSubrecords(navi);
    expect(fields.map((f) => f.type)).toEqual(['NVER', 'NVMI', 'NVPP']);
    expect(fields[2]!.data).toEqual(nvpp);
    const info = decodeNvmi(fields[1]!.data);
    expect(info).toMatchObject({
      navMesh: navmId,
      flags: 0,
      location: [100, 100, 0],
      doorLinks: [
        { crc: PATHING_DOOR_CRC, door: 0x01000d70 },
        { crc: PATHING_DOOR_CRC, door: 0x01000d71 },
      ],
      parent: { kind: 'cell', cell: 0x01000d62 },
    });

    // a second Finalize replaces the cell's entry instead of adding one
    await reread.finalize(CELL, async () => undefined);
    const again = await recordSubrecords(reread.plugin.navi()!);
    expect(again.filter((f) => f.type === 'NVMI')).toHaveLength(1);
  });
});
