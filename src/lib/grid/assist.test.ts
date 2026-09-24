import { describe, expect, it } from 'vitest';
import type { ConnectionType, Face, FaceDir, Piece } from '../catalogue/types';
import {
  badJoints,
  candidatesFor,
  faceAt,
  faceRect,
  openFaces,
  openingsOf,
  sharedCells,
} from './assist';
import { addTile, type Layout } from './edit';

/** A w x h piece with the given openings, each spanning its whole side. */
function piece(formKey: string, w: number, h: number, sides: [FaceDir, string][]): Piece {
  const cells: Piece['cells'] = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) cells.push([i, j, 0]);
  const faces: Face[] = [];
  for (const [dir, conn] of sides) {
    for (const c of cells) {
      const onSide =
        (dir === '+X' && c[0] === w - 1) ||
        (dir === '-X' && c[0] === 0) ||
        (dir === '+Y' && c[1] === h - 1) ||
        (dir === '-Y' && c[1] === 0);
      if (onSide) faces.push({ cell: c, dir, conn });
    }
  }
  return {
    editorId: formKey,
    formKey,
    model: `${formKey}.nif`,
    kit: 'Imperial',
    class: 'tile',
    category: 'hall',
    pivot: [0, 0, 0],
    cells,
    faces,
    walkable: null,
    obstacle: null,
    review: { auto: true, validated: true },
  };
}

const type = (id: string, mate = id): ConnectionType => ({
  id,
  kit: 'Imperial',
  signature: null,
  mate,
  navEdge: null,
});
// H: symmetric hall profile; L and R: a left/right pair that only mate with each other
const TYPES = new Map([type('H'), type('L', 'R'), type('R', 'L'), type('D')].map((t) => [t.id, t]));

const STRAIGHT = piece('Straight', 2, 2, [
  ['-X', 'H'],
  ['+X', 'H'],
]);
const CORNER = piece('Corner', 2, 2, [
  ['-X', 'H'],
  ['+Y', 'H'],
]);
const LEFT = piece('Left', 2, 2, [['+X', 'L']]);
const RIGHT = piece('Right', 2, 2, [['-X', 'R']]);
const NARROW = piece('Narrow', 1, 1, [['-X', 'H']]);
const DOOR = piece('Door', 2, 2, [['-X', 'D']]);
const PIECES = new Map([STRAIGHT, CORNER, LEFT, RIGHT, NARROW, DOOR].map((p) => [p.formKey, p]));

function place(
  l: Layout,
  key: string,
  cell: [number, number, number],
  r: 0 | 1 | 2 | 3,
  pieces: ReadonlyMap<string, Piece> = PIECES,
) {
  const res = addTile(l, pieces, key, cell, r);
  if (!res.ok) throw new Error(`cannot place ${key}`);
  return res.layout;
}

const EMPTY: Layout = { tiles: new Map(), nextNew: 1 };

describe('openingsOf', () => {
  it('groups adjacent faces of one side into a single opening', () => {
    const o = openingsOf(STRAIGHT);
    expect(o.map((x) => [x.dir, x.cells.length])).toEqual([
      ['-X', 2],
      ['+X', 2],
    ]);
  });
});

describe('openFaces', () => {
  it('lists openings onto free cells only, in world directions', () => {
    let l = place(EMPTY, 'Straight', [0, 0, 0], 0);
    expect(openFaces(l, PIECES).map((f) => f.dir)).toEqual(['-X', '+X']);
    l = place(l, 'Straight', [2, 0, 0], 0);
    // the shared junction is closed, the two outer ends stay open
    const open = openFaces(l, PIECES);
    expect(open.map((f) => f.outside[0])).toEqual([
      [-1, 0, 0],
      [4, 0, 0],
    ]);
  });

  it('turns the faces with the tile', () => {
    const l = place(EMPTY, 'Straight', [0, 0, 0], 1);
    expect(openFaces(l, PIECES).map((f) => f.dir)).toEqual(['-Y', '+Y']);
  });
});

describe('candidatesFor', () => {
  it('offers only mating openings of the same width, placed flush', () => {
    const l = place(EMPTY, 'Straight', [0, 0, 0], 0);
    const east = openFaces(l, PIECES).find((f) => f.dir === '+X')!;
    const c = candidatesFor(east, l, PIECES, TYPES);
    // Straight and Corner by either side; not Narrow (width), Door or L/R (type)
    expect(c.map((x) => `${x.piece}:${x.opening.dir}:r${x.rotation}`).sort()).toEqual([
      'Corner:+Y:r1',
      'Corner:-X:r0',
      'Straight:+X:r2',
      'Straight:-X:r0',
    ]);
    const corner = c.find((x) => x.piece === 'Corner' && x.rotation === 0)!;
    expect(corner.cell).toEqual([2, 0, 0]);
  });

  it('matches a left profile with its right mate only', () => {
    const l = place(EMPTY, 'Left', [0, 0, 0], 0);
    const [open] = openFaces(l, PIECES);
    expect(candidatesFor(open!, l, PIECES, TYPES).map((x) => x.piece)).toEqual(['Right']);
  });

  it('finds the rotation for a turned opening and refuses overlaps', () => {
    let l = place(EMPTY, 'Corner', [0, 0, 0], 0);
    const north = openFaces(l, PIECES).find((f) => f.dir === '+Y')!;
    const straight = candidatesFor(north, l, PIECES, TYPES).filter((x) => x.piece === 'Straight');
    expect(straight.map((x) => [x.rotation, x.cell])).toEqual([
      [1, [2, 2, 0]],
      [3, [0, 4, 0]],
    ]);
    // block part of the space north of the corner: no 2x2 piece fits any more
    l = place(l, 'Narrow', [1, 3, 0], 0);
    const blocked = openFaces(l, PIECES).find((f) => f.dir === '+Y')!;
    expect(candidatesFor(blocked, l, PIECES, TYPES)).toEqual([]);
  });
});

describe('faceRect', () => {
  it('draws a strip just outside the face and finds it under the pointer', () => {
    const anchor = { origin: [0, 0, -512] as const, module: { xy: 128, z: 128 } };
    const l = place(EMPTY, 'Straight', [0, 0, 0], 0);
    const opens = openFaces(l, PIECES);
    const east = opens.find((f) => f.dir === '+X')!;
    const west = opens.find((f) => f.dir === '-X')!;
    expect(faceRect(east, anchor)).toEqual({ min: [256, 0], max: [300.8, 256] });
    expect(faceRect(west, anchor).max).toEqual([0, 256]);
    expect(faceAt([270, 100, 0], opens, anchor)).toBe(east);
    expect(faceAt([128, 128, 0], opens, anchor)).toBeUndefined();
  });
});

describe('levels', () => {
  // a ramp: enters at level 0 on -X, leaves one level up on +X, and spans both levels
  const RAMP: Piece = {
    ...piece('Ramp', 2, 2, []),
    cells: piece('Ramp', 2, 2, []).cells.flatMap((c) => [c, [c[0], c[1], 1] as const]),
    faces: [
      { cell: [0, 0, 0], dir: '-X', conn: 'H' },
      { cell: [0, 1, 0], dir: '-X', conn: 'H' },
      { cell: [1, 0, 1], dir: '+X', conn: 'H' },
      { cell: [1, 1, 1], dir: '+X', conn: 'H' },
    ],
  };
  const ALL = new Map([...PIECES, [RAMP.formKey, RAMP]]);

  it('joins pieces at the level of each opening', () => {
    let l: Layout = EMPTY;
    for (const [key, cell] of [
      ['Straight', [0, 0, 0]],
      ['Ramp', [2, 0, 0]],
      ['Straight', [4, 0, 1]],
    ] as const) {
      const r = addTile(l, ALL, key, cell, 0);
      if (!r.ok) throw new Error(`cannot place ${key}`);
      l = r.layout;
    }
    // only the two outer ends remain open, one level apart
    expect(openFaces(l, ALL).map((f) => f.outside[0])).toEqual([
      [-1, 0, 0],
      [6, 0, 1],
    ]);
  });

  it('offers a ramp going up or down, each end at its own level', () => {
    const l = place(EMPTY, 'Straight', [0, 0, 1], 0);
    const east = openFaces(l, PIECES).find((f) => f.dir === '+X')!;
    const ramp = candidatesFor(east, l, new Map([[RAMP.formKey, RAMP]]), TYPES);
    // up: its low end on the face; down: turned half a turn, its high end on the face
    expect(ramp.map((c) => [c.opening.dir, c.rotation, c.cell])).toEqual([
      ['-X', 0, [2, 0, 1]],
      ['+X', 2, [4, 2, 0]],
    ]);
  });
});

describe('badJoints', () => {
  it('reports openings blocked by a wall or a foreign profile, not mating junctions', () => {
    let l = place(EMPTY, 'Straight', [0, 0, 0], 0);
    l = place(l, 'Straight', [2, 0, 0], 0);
    expect(badJoints(l, PIECES, TYPES)).toEqual([]);
    // a door profile against the hall end: both sides are reported
    l = place(l, 'Door', [4, 0, 0], 0);
    const joints = badJoints(l, PIECES, TYPES);
    expect(joints.map((b) => [b.tile, b.dir, b.against])).toEqual([
      ['new:2', '+X', ['new:3']],
      ['new:3', '-X', ['new:2']],
    ]);
    expect(joints[0]!.facing.map((f) => f.opening.face.conn)).toEqual(['D']);
    // an opening against a closed wall
    const w = place(place(EMPTY, 'Left', [0, 0, 0], 0), 'Left', [2, 0, 0], 0);
    expect(badJoints(w, PIECES, TYPES).map((b) => b.tile)).toEqual(['new:1']);
  });
});

describe('composites', () => {
  // a wide door whose opening also accepts the narrow hall profile, centred (D56)
  const base = piece('Wide', 2, 4, [['+X', 'W']]);
  const WIDE: Piece = { ...base, faces: base.faces.map((f) => ({ ...f, extraConn: ['H'] })) };
  const ALL = new Map([...PIECES, [WIDE.formKey, WIDE]]);
  const types = new Map([...TYPES, ['W', type('W', 'W')]]);

  it('offers a narrower mating piece centred on a wide composite opening', () => {
    const l = place(EMPTY, 'Wide', [0, 0, 0], 0, ALL);
    const [open] = openFaces(l, ALL);
    const straight = candidatesFor(open!, l, ALL, types).filter((c) => c.piece === 'Straight');
    // by either end; both cover x 2..3, y 1..2, centred on the 4-cell opening
    expect(straight.map((c) => [c.rotation, c.cell])).toEqual([
      [0, [2, 1, 0]],
      [2, [4, 3, 0]],
    ]);
  });

  it('accepts a centred narrower junction and refuses an offset one', () => {
    const ok = place(place(EMPTY, 'Wide', [0, 0, 0], 0, ALL), 'Straight', [2, 1, 0], 0, ALL);
    expect(badJoints(ok, ALL, types).map((b) => b.tile)).toEqual([]);
    const offset = place(place(EMPTY, 'Wide', [0, 0, 0], 0, ALL), 'Straight', [2, 0, 0], 0, ALL);
    expect(badJoints(offset, ALL, types).map((b) => b.tile)).toEqual(['new:1', 'new:2']);
  });
});

describe('sharedCells', () => {
  it('lists cells claimed by more than one tile', () => {
    const one = place(EMPTY, 'Straight', [0, 0, 0], 0);
    expect(sharedCells(one, PIECES)).toEqual([]);
    // force an overlap, as a loaded level may have (D58)
    const tiles = new Map(one.tiles);
    tiles.set('X', { key: 'X', piece: 'Narrow', cell: [1, 1, 0], rotation: 0, own: true });
    expect(sharedCells({ tiles, nextNew: 2 }, PIECES)).toEqual([
      { cell: [1, 1, 0], tiles: ['new:1', 'X'] },
    ]);
  });
});

describe('badJoints with geometry', () => {
  const HALL = [
    [-128, 0, 128, 0],
    [-128, 0, -128, 256],
    [128, 0, 128, 256],
  ];
  const shift = (du: number) => HALL.map((s) => [s[0]! + du, s[1]!, s[2]! + du, s[3]!]);
  const module = { xy: 128, z: 128 };
  const pair = () => place(place(EMPTY, 'Straight', [0, 0, 0], 0), 'Corner', [2, 0, 0], 0);

  it('passes exact and included junctions, even across connection types', () => {
    const withBeam = [...HALL, [-128, 200, 128, 200]];
    const geometry = {
      module,
      profileOf: (piece: string) => (piece === 'Corner' ? withBeam : HALL),
    };
    expect(badJoints(pair(), PIECES, new Map(), geometry)).toEqual([]);
  });

  it('reports a seam with its gap on both sides', () => {
    const geometry = {
      module,
      profileOf: (piece: string) => (piece === 'Corner' ? shift(5) : HALL),
    };
    const joints = badJoints(pair(), PIECES, TYPES, geometry);
    expect(joints.map((j) => [j.tile, j.fit])).toEqual([
      ['new:1', 'seam'],
      ['new:2', 'seam'],
    ]);
    expect(joints[0]!.gap).toBeCloseTo(5, 0);
  });
});
