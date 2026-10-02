import { describe, expect, it } from 'vitest';
import { buildNavMesh } from './build';
import { doorTriangle, finalizeCell, NAV_TRIANGLE_DOOR } from './finalize';
import { NAVI_FLAG_ISLAND, PATHING_DOOR_CRC } from '../format/esp/navi';

/** A square of two triangles over [x, x + 100] x [0, 100] at height z. */
const square = (x: number, z = 0) =>
  buildNavMesh(
    7,
    [
      [x, 0, z],
      [x + 100, 0, z],
      [x + 100, 100, z],
      [x, 100, z],
    ],
    [
      [0, 1, 2],
      [0, 2, 3],
    ],
  );

describe('doorTriangle', () => {
  it('takes the triangle containing the point, else the nearest within reach', () => {
    expect(doorTriangle(square(0), [80, 10, 0])).toEqual({ triangle: 0, distance: 0 });
    expect(doorTriangle(square(0), [10, 80, 0])).toEqual({ triangle: 1, distance: 0 });
    expect(doorTriangle(square(0), [150, 50, 0])?.triangle).toBe(0);
    expect(doorTriangle(square(0), [500, 50, 0])).toBeUndefined();
    // a floor far above or below is not the door's
    expect(doorTriangle(square(0, 400), [80, 10, 0])).toBeUndefined();
  });
});

describe('finalizeCell', () => {
  it('links doors by their arrival marker and rebuilds the door links', () => {
    const main = { ...square(0), doorLinks: [{ triangle: 1, crc: PATHING_DOOR_CRC, door: 99 }] };
    main.triangles[1] = { ...main.triangles[1]!, flags: main.triangles[1]!.flags | 0x400 };
    const r = finalizeCell(
      7,
      [{ formId: 0x10, nav: main }],
      [
        { ref: 0x21, pos: [10, 200, 0], arrival: [80, 10, 0] },
        { ref: 0x20, pos: [1000, 1000, 0] },
      ],
    );
    expect(r.links).toEqual([{ ref: 0x21, navm: 0x10, triangle: 0 }]);
    expect(r.missed).toEqual([0x20]);
    expect(r.navms[0]!.doorLinks).toEqual([{ triangle: 0, crc: PATHING_DOOR_CRC, door: 0x21 }]);
    expect(r.navms[0]!.triangles.map((t) => t.flags & NAV_TRIANGLE_DOOR)).toEqual([0x400, 0]);
    expect(r.infos[0]).toMatchObject({
      navMesh: 0x10,
      flags: 0,
      location: [50, 50, 0],
      doorLinks: [{ crc: PATHING_DOOR_CRC, door: 0x21 }],
      island: null,
      parent: { kind: 'cell', cell: 7 },
    });
  });

  it('marks as islands the NavMeshes the largest one cannot reach', () => {
    const big = buildNavMesh(
      7,
      [
        [0, 0, 0],
        [300, 0, 0],
        [300, 300, 0],
        [0, 300, 0],
        [600, 0, 0],
      ],
      [
        [0, 1, 2],
        [0, 2, 3],
        [1, 4, 2],
      ],
    );
    const r = finalizeCell(
      7,
      [
        { formId: 1, nav: square(1000) },
        { formId: 2, nav: big },
      ],
      [],
    );
    expect(r.infos.map((i) => i.flags)).toEqual([NAVI_FLAG_ISLAND, 0]);
    expect(r.infos[0]!.island).toMatchObject({
      min: [1000, 0, 0],
      max: [1100, 100, 0],
      triangles: [
        [0, 1, 2],
        [0, 2, 3],
      ],
    });
  });
});
