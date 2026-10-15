import { describe, expect, it } from 'vitest';
import { BinaryWriter } from '../binary/BinaryWriter';
import type { Vec3 } from '../catalogue/types';
import { encodeRefr } from '../format/esp/cellRefr';
import { findSubrecord, recordSubrecords, writeSubrecords } from '../format/esp/subrecords';
import { buildPlugin, record } from '../format/esp/testPlugin';
import { EspLevelStore, followPlacement } from './espStore';

const CELL = '0x00000D62:MyDungeon.esp';
const DOOR_BASE = 0x00031897; // a Skyrim.esm DOOR

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

async function arrival(level: EspLevelStore, formId: number) {
  const r = level.plugin.recordsOfType('REFR').find((x) => x.formId === formId)!;
  const x = findSubrecord(await recordSubrecords(r), 'XTEL')!;
  const v = new DataView(x.data.buffer, x.data.byteOffset, x.data.byteLength);
  return {
    to: v.getUint32(0, true),
    pos: [0, 1, 2].map((i) => v.getFloat32(4 + i * 4, true)),
    z: v.getFloat32(24, true),
  };
}

describe('followPlacement', () => {
  it('moves and turns an offset with its reference (clockwise heading)', () => {
    const p = followPlacement(
      { pos: [100, 0, 5], rot: [0, 0, 0] },
      { pos: [0, 0, 0], rot: [0, 0, 0] },
      { pos: [1000, 0, 64], rot: [0, 0, Math.PI / 2] },
    );
    // +X turned a quarter clockwise is -Y
    expect(p.pos[0]).toBeCloseTo(1000);
    expect(p.pos[1]).toBeCloseTo(-100);
    expect(p.pos[2]).toBeCloseTo(69);
    expect(p.rot[2]).toBeCloseTo(Math.PI / 2);
  });
});

describe('EspLevelStore: a moved load door (R23)', () => {
  it("takes the arrival of the door leading to it along, and notes a master's door", async () => {
    const level = EspLevelStore.parse(
      buildPlugin({
        refs: [
          door(0x01000d70, [0, 0, 0], 0x01000d71, [180, 20, 0]),
          door(0x01000d71, [200, 0, 0], 0x01000d70, [50, 0, 0]),
          door(0x00000d72, [400, 0, 0], 0x01000d70, [60, 0, 0]),
        ],
      }),
      'MyDungeon.esp',
    );
    const notes: string[] = [];
    await level.applyEdits(
      CELL,
      [
        {
          kind: 'move',
          ref: '0x00000D70:MyDungeon.esp',
          pos: [0, 512, 0],
          rot: [0, 0, 0],
          scale: 1,
        },
      ],
      notes,
    );
    const back = await arrival(level, 0x01000d71);
    expect(back.to).toBe(0x01000d70);
    expect(back.pos).toEqual([50, 512, 0]);
    // the moved door's own destination is unchanged
    expect((await arrival(level, 0x01000d70)).pos).toEqual([180, 20, 0]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('Creation Kit');
  });

  it('notes a door leading to a door the plugin does not hold', async () => {
    const level = EspLevelStore.parse(
      buildPlugin({ refs: [door(0x01000d70, [0, 0, 0], 0x00012345, [180, 20, 0])] }),
      'MyDungeon.esp',
    );
    const notes: string[] = [];
    const move = { pos: [0, 512, 0] as Vec3, rot: [0, 0, 0] as Vec3, scale: 1 };
    await level.applyEdits(
      CELL,
      [{ kind: 'move', ref: '0x00000D70:MyDungeon.esp', ...move }],
      notes,
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('not in this plugin');
  });
});
