import { describe, expect, it } from 'vitest';
import { PATHING_CELL_CRC, PATHING_DOOR_CRC, decodeNvmi, encodeNvmi, type NavInfo } from './navi';

const base: NavInfo = {
  navMesh: 0x01000801,
  flags: 0,
  location: [128, -256, 64],
  preferred: 0,
  edgeLinks: [0x01000802],
  preferredEdgeLinks: [],
  doorLinks: [{ crc: PATHING_DOOR_CRC, door: 0x01000900 }],
  island: null,
  crc: PATHING_CELL_CRC,
  parent: { kind: 'cell', cell: 0x01000800 },
  trailing: new Uint8Array(),
};

describe('NVMI', () => {
  it('round-trips an interior entry', () => {
    const bytes = encodeNvmi(base);
    // 4 + 4 + 12 + 4 + (4 + 4) + 4 + (4 + 8) + 1 + 4 + 4 + 4
    expect(bytes.length).toBe(61);
    expect(decodeNvmi(bytes)).toEqual(base);
  });

  it('round-trips an island in a worldspace', () => {
    const info: NavInfo = {
      ...base,
      flags: 0x20,
      island: {
        min: [0, 0, 0],
        max: [10, 10, 0],
        triangles: [[0, 1, 2]],
        vertices: [
          [0, 0, 0],
          [10, 0, 0],
          [0, 10, 0],
        ],
      },
      parent: { kind: 'grid', worldspace: 0x3c, x: -3, y: 7 },
    };
    expect(decodeNvmi(encodeNvmi(info))).toEqual(info);
  });
});
