import { describe, expect, it } from 'vitest';
import type { Piece, Vec3 } from '../catalogue/types';
import { deriveGrid } from './derive';
import {
  addTile,
  cellAt,
  changeCount,
  changes,
  commit,
  historyOf,
  layoutFromGrid,
  moveTile,
  placeTile,
  redo,
  removeTile,
  rotateTile,
  tileWorldPlacement,
  turnedPlacement,
  undo,
  withoutTile,
  type Layout,
} from './edit';
import type { GridAnchor, PlacedRef } from './types';

function piece(formKey: string, w: number, h: number, pivot: Vec3): Piece {
  const cells: Piece['cells'] = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) cells.push([i, j, 0]);
  return {
    editorId: formKey,
    formKey,
    model: `${formKey}.nif`,
    kit: 'Imperial',
    class: 'tile',
    category: 'hall',
    pivot,
    cells,
    faces: [],
    walkable: null,
    obstacle: null,
    review: { auto: true, validated: true },
  };
}

const HALL = piece('Hall', 2, 2, [128, 128, 0]);
const JOG = piece('Jog', 3, 2, [256, 128, 0]);
const PIECES = new Map([
  [HALL.formKey, HALL],
  [JOG.formKey, JOG],
]);
const ANCHOR: GridAnchor = { origin: [0, 0, -512], module: { xy: 128, z: 128 } };

const ref = (key: string, base: string, pos: Vec3): PlacedRef => ({
  refFormKey: key,
  base,
  pos,
  rot: [0, 0, 0],
  scale: 1,
});

/** Two own halls side by side, one master hall, and a pre-existing overlap. */
function layout(): Layout {
  const refs = [
    ref('A', 'Hall', [128, 128, -512]),
    ref('B', 'Hall', [384, 128, -512]),
    ref('M', 'Hall', [128, 640, -512]),
    ref('X', 'Hall', [128, 768, -512]), // overlaps M: tolerated
  ];
  const grid = deriveGrid(refs, PIECES, { module: 128, zModule: 128 });
  return layoutFromGrid(
    grid,
    new Map([
      ['A', true],
      ['B', true],
      ['M', false],
      ['X', true],
    ]),
  );
}

describe('editing', () => {
  it('loads existing tiles with their origin and ownership', () => {
    const l = layout();
    expect(l.tiles.size).toBe(4);
    expect(l.tiles.get('A')).toMatchObject({ cell: [0, 0, 0], rotation: 0, own: true });
    expect(l.tiles.get('M')!.own).toBe(false);
  });

  it('adds a tile on free cells and refuses one that would share a cell', () => {
    const l = layout();
    const ok = addTile(l, PIECES, 'Hall', [4, 0, 0], 0);
    expect(ok.ok && ok.key).toBe('new:1');
    const clash = addTile(l, PIECES, 'Hall', [3, 1, 0], 0);
    expect(clash).toMatchObject({ ok: false, reason: 'conflict' });
    if (!clash.ok && clash.reason === 'conflict') expect(clash.cells).toEqual([[3, 1, 0]]);
    expect(addTile(l, PIECES, 'Nope', [9, 9, 0], 0)).toMatchObject({ reason: 'unknown-piece' });
  });

  it('moves own tiles, ignoring their own old cells, and refuses master tiles', () => {
    const l = layout();
    const moved = moveTile(l, PIECES, 'A', [0, -1, 0]); // overlaps only its own old cells
    expect(moved.ok).toBe(true);
    expect(moveTile(l, PIECES, 'A', [1, 0, 0])).toMatchObject({ reason: 'conflict' });
    expect(moveTile(l, PIECES, 'M', [10, 10, 0])).toMatchObject({ reason: 'read-only' });
    expect(removeTile(l, 'M')).toMatchObject({ reason: 'read-only' });
  });

  it('moves and turns a tile in one edit, and reasons without a tile', () => {
    const l = layout();
    const r = placeTile(l, PIECES, 'A', [0, -2, 0], 1);
    expect(r.ok && r.layout.tiles.get('A')).toMatchObject({ cell: [0, -2, 0], rotation: 1 });
    expect(placeTile(l, PIECES, 'M', [9, 9, 0], 0)).toMatchObject({ reason: 'read-only' });
    const rest = withoutTile(l, 'M');
    expect([rest.tiles.has('M'), l.tiles.has('M'), rest.tiles.size]).toEqual([false, true, 3]);
  });

  it('turns a tile in place, keeping its footprint corner', () => {
    const turned = turnedPlacement(JOG, [5, 5, 0], 0, 1);
    expect(turned.rotation).toBe(1);
    // 3x2 becomes 2x3 with the same min corner
    const l0: Layout = { tiles: new Map(), nextNew: 1 };
    const add = addTile(l0, PIECES, 'Jog', [5, 5, 0], 0);
    if (!add.ok) throw new Error('add failed');
    const rot = rotateTile(add.layout, PIECES, add.key, 1);
    if (!rot.ok) throw new Error('rotate failed');
    const t = rot.layout.tiles.get(add.key)!;
    expect(t.rotation).toBe(1);
    expect(t.cell).toEqual(turned.cell);
  });

  it('keeps untouched tiles at their stored placement and places others on the grid', () => {
    const l = layout();
    const a = l.tiles.get('A')!;
    expect(tileWorldPlacement(a, HALL, ANCHOR).pos).toEqual([128, 128, -512]);
    const moved = moveTile(l, PIECES, 'A', [0, -2, 0]);
    if (!moved.ok) throw new Error('move failed');
    const p = tileWorldPlacement(moved.layout.tiles.get('A')!, HALL, ANCHOR);
    expect(p.pos).toEqual([128, -128, -512]);
    expect(p.rot).toEqual([0, 0, 0]);
  });

  it('finds the cell under the pointer, centring the footprint', () => {
    expect(cellAt([128, 128, 0], ANCHOR, HALL, 0)).toEqual([0, 0, 0]);
    expect(cellAt([140, 120, 0], ANCHOR, HALL, 0)).toEqual([0, 0, 0]);
    expect(cellAt([384, 128, 0], ANCHOR, HALL, 0)).toEqual([2, 0, 0]);
  });

  it('lists added, moved and removed tiles', () => {
    const l = layout();
    let cur = l;
    const steps = [
      (x: Layout) => addTile(x, PIECES, 'Hall', [6, 0, 0], 0),
      (x: Layout) => moveTile(x, PIECES, 'B', [2, -2, 0]),
      (x: Layout) => removeTile(x, 'X'),
    ];
    for (const step of steps) {
      const r = step(cur);
      if (!r.ok) throw new Error('step failed');
      cur = r.layout;
    }
    const c = changes(l, cur);
    expect([c.added.length, c.moved.map((t) => t.key), c.removed.map((t) => t.key)]).toEqual([
      1,
      ['B'],
      ['X'],
    ]);
    expect(changeCount(c)).toBe(3);
    // moving back to the original cell is not a change
    const back = moveTile(cur, PIECES, 'B', [2, 0, 0]);
    if (!back.ok) throw new Error('move back failed');
    expect(changes(l, back.layout).moved).toEqual([]);
  });
});

describe('history', () => {
  it('undoes and redoes, and a new edit clears the redo stack', () => {
    const l0 = layout();
    let h = historyOf(l0);
    const a = addTile(h.present, PIECES, 'Hall', [6, 0, 0], 0);
    if (!a.ok) throw new Error();
    h = commit(h, a.layout);
    h = undo(h);
    expect(h.present).toBe(l0);
    h = redo(h);
    expect(h.present).toBe(a.layout);
    h = undo(h);
    const b = addTile(h.present, PIECES, 'Hall', [8, 0, 0], 0);
    if (!b.ok) throw new Error();
    h = commit(h, b.layout);
    expect(h.future).toEqual([]);
    expect(undo(historyOf(l0))).toEqual(historyOf(l0));
  });
});
