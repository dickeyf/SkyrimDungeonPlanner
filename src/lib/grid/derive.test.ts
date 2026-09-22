import { describe, expect, it } from 'vitest';
import type { Piece, Vec3 } from '../catalogue/types';
import {
  deriveGrid,
  footprintCorner,
  headingFromQuarterTurns,
  originFromCorner,
  quarterTurnsFromHeading,
  rotateFootprintCell,
} from './derive';
import type { PlacedRef } from './types';

const MODULE = 128;

function piece(editorId: string, cells: Piece['cells'], pivot: Vec3 = [128, 128, 0]): Piece {
  return {
    editorId,
    formKey: `0x0000${editorId.length}:Skyrim.esm`,
    model: `dungeons\\imperial\\smallhall\\${editorId}.nif`,
    kit: 'Imperial',
    class: 'tile',
    category: 'hall',
    pivot,
    cells,
    faces: [],
    walkable: null,
    obstacle: null,
    review: { auto: true, validated: false },
  };
}

const HALL = piece('ImpHall1Way01', [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
]);
const JOG = piece(
  'ImpHall1Way128L01',
  [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [2, 1, 0],
  ],
  [256, 128, 0],
);
const PIECES = new Map<string, Piece>([
  [HALL.formKey, HALL],
  [JOG.formKey, JOG],
]);

function ref(id: number, base: Piece, pos: Vec3, rz = 0, scale = 1, rx = 0): PlacedRef {
  return {
    refFormKey: `0x${id.toString(16)}:MyDungeon.esp`,
    base: base.formKey,
    pos,
    rot: [rx, 0, rz],
    scale,
  };
}

describe('rotation helpers', () => {
  it('rotates footprint cells about the corner of cell (0,0)', () => {
    const square = HALL.cells.map((c) => rotateFootprintCell(c, 1));
    expect(square.map((c) => c.slice(0, 2))).toEqual([
      [-1, 0],
      [-1, 1],
      [-2, 0],
      [-2, 1],
    ]);
    expect(rotateFootprintCell([2, 0, 0], 2)).toEqual([-3, -1, 0]);
    expect(rotateFootprintCell([2, 0, 0], 3)).toEqual([0, -3, 0]);
  });

  it('inverts corner and origin for every rotation', () => {
    const pivot: Vec3 = [256, 128, -8];
    for (const r of [0, 1, 2, 3] as const) {
      const corner = footprintCorner([1000, 2000, 30], r, pivot);
      const back = originFromCorner(corner, r, pivot);
      expect(back.map((v) => Math.round(v))).toEqual([1000, 2000, 30]);
    }
    expect(footprintCorner([0, 0, 0], 0, [128, 128, 0])).toEqual([-128, -128, 0]);
    // 90 degrees CCW: the pivot vector (128,128) rotates to (-128,128); corner = -that
    expect(footprintCorner([0, 0, 0], 1, [128, 128, 0]).map(Math.round)).toEqual([128, -128, 0]);
  });

  it('maps Skyrim headings to counter-clockwise quarter turns and back', () => {
    expect(quarterTurnsFromHeading(0)).toBe(0);
    expect(quarterTurnsFromHeading(-Math.PI / 2)).toBeCloseTo(1);
    expect(quarterTurnsFromHeading(Math.PI / 2)).toBeCloseTo(-1);
    expect(headingFromQuarterTurns(1)).toBeCloseTo((3 * Math.PI) / 2);
    expect(headingFromQuarterTurns(0)).toBe(0);
  });
});

describe('deriveGrid', () => {
  const opts = { module: MODULE, zModule: MODULE };

  it('recognizes tiles on a grid anchored anywhere and reports the anchor', () => {
    // grid origin at (1000, 2000, -512): hall origins sit at corner + pivot
    const refs = [
      ref(1, HALL, [1128, 2128, -512]),
      ref(2, HALL, [1128, 2384, -512]),
      ref(3, HALL, [1384, 2128, -512], headingFromQuarterTurns(1)),
    ];
    const result = deriveGrid(refs, PIECES, opts);
    expect(result.opaque).toEqual([]);
    expect(result.anchor.origin.map(Math.round)).toEqual([1000, 2000, -512]);
    expect(result.tiles.map((t) => [t.cell, t.rotation])).toEqual([
      [[0, 0, 0], 0],
      [[0, 2, 0], 0],
      [[4, 0, 0], 1],
    ]);
    // the rotated hall occupies the two columns left of its corner
    expect(result.tiles[2]!.occupied.map((c) => `${c[0]},${c[1]}`).sort()).toEqual([
      '2,0',
      '2,1',
      '3,0',
      '3,1',
    ]);
    expect(result.overlaps).toEqual([]);
  });

  it('classifies unknown, scaled, tilted, oddly rotated and off-grid references', () => {
    const stranger: PlacedRef = {
      refFormKey: '0x9:MyDungeon.esp',
      base: '0xABCDEF:Skyrim.esm',
      pos: [0, 0, 0],
      rot: [0, 0, 0],
      scale: 1,
    };
    const refs = [
      ref(1, HALL, [128, 128, 0]),
      ref(2, HALL, [128, 384, 0]),
      stranger,
      ref(3, HALL, [640, 128, 0], 0, 1.2),
      ref(4, HALL, [896, 128, 0], 0, 1, 0.3),
      ref(5, HALL, [1152, 128, 0], 0.4),
      ref(6, HALL, [128 + 40, 640, 0]),
    ];
    const result = deriveGrid(refs, PIECES, opts);
    expect(result.tiles.length).toBe(2);
    expect(result.opaque.map((o) => o.reason)).toEqual([
      'unknown-base',
      'scaled',
      'tilted',
      'non-quarter-rotation',
      'off-grid',
    ]);
  });

  it('tolerates small placement noise and detects overlaps', () => {
    const refs = [
      ref(1, HALL, [128.4, 127.7, 0.2]),
      ref(2, HALL, [128, 128, 0]),
      ref(3, JOG, [640, 128, 0]),
    ];
    const result = deriveGrid(refs, PIECES, opts);
    expect(result.tiles.length).toBe(3);
    expect(result.overlaps.length).toBe(4); // the two halls share their 2x2 cells
    expect(result.tiles[2]!.occupied.map((c) => c[0]).sort((a, b) => a - b)).toEqual([
      3, 3, 4, 4, 5, 5,
    ]);
  });

  it('falls back to the world origin for an empty cell', () => {
    const result = deriveGrid([], PIECES, opts);
    expect(result.anchor.origin).toEqual([0, 0, 0]);
    expect(result.tiles).toEqual([]);
  });
});
