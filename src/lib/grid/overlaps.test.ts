import { describe, expect, it } from 'vitest';
import type { CellIndex, Piece } from '../catalogue/types';
import { badJoints, sharedCells } from './assist';
import { addTile, moveTile, type Layout } from './edit';
import { acceptedOverlaps, overlapAccepted, relativePlacement } from './overlaps';
import { rotateCell, type Rotation } from './rotation';

function piece(formKey: string, w: number, h: number): Piece {
  const cells: Piece['cells'] = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) cells.push([i, j, 0]);
  return {
    editorId: formKey,
    formKey,
    model: `${formKey}.nif`,
    kit: 'Imperial',
    class: 'tile',
    category: 'door',
    pivot: [0, 0, 0],
    cells,
    faces: [],
    walkable: null,
    obstacle: null,
    review: { auto: true, validated: true },
  };
}

const DOOR = piece('Door', 2, 2);
const ROOM = {
  ...piece('Room', 4, 2),
  faces: [0, 1].map((j) => ({ cell: [3, j, 0] as CellIndex, dir: '+X' as const, conn: 'H' })),
};
const PIECES = new Map([DOOR, ROOM].map((p) => [p.formKey, p]));
// the door nests one cell into the room's side
const NESTED = acceptedOverlaps([{ pieces: ['Room', 'Door'], rotation: 0, offset: [3, 0, 0] }]);

const at = (p: string, cell: CellIndex, rotation: Rotation) => ({ piece: p, cell, rotation });

describe('relativePlacement', () => {
  it('does not depend on where and how the pair is turned', () => {
    const room = at('Room', [0, 0, 0], 0);
    const door = at('Door', [3, 0, 0], 0);
    const base = relativePlacement(room, door);
    for (const r of [1, 2, 3] as const) {
      const turn = (t: ReturnType<typeof at>) =>
        at(
          t.piece,
          rotateCell([t.cell[0] + 5, t.cell[1] - 2, t.cell[2]] as CellIndex, r),
          ((t.rotation + r) % 4) as Rotation,
        );
      expect(relativePlacement(turn(room), turn(door))).toEqual(base);
    }
  });

  it('accepts the pair from either side and only in its placement', () => {
    const room = at('Room', [10, 4, 0], 1);
    const door = at('Door', [10, 7, 0], 1); // [3, 0] turned a quarter
    expect(overlapAccepted(NESTED, room, door)).toBe(true);
    expect(overlapAccepted(NESTED, door, room)).toBe(true);
    expect(overlapAccepted(NESTED, room, at('Door', [10, 6, 0], 1))).toBe(false);
    expect(overlapAccepted(NESTED, room, at('Door', [10, 7, 0], 2))).toBe(false);
  });
});

describe('accepted overlaps in a layout', () => {
  const start = (accepted = NESTED): Layout => {
    const r = addTile({ tiles: new Map(), nextNew: 1, accepted }, PIECES, 'Room', [0, 0, 0], 0);
    if (!r.ok) throw new Error();
    return r.layout;
  };

  it('allows placing the pair and does not flag its shared cells', () => {
    const r = addTile(start(), PIECES, 'Door', [3, 0, 0], 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(sharedCells(r.layout, PIECES)).toEqual([]);
    // nor judged as a junction: the room's opening meets the door's wall on purpose
    expect(badJoints(r.layout, PIECES, new Map())).toEqual([]);
    // any other overlap is still refused
    expect(moveTile(r.layout, PIECES, r.key, [2, 0, 0])).toMatchObject({ reason: 'conflict' });
    expect(addTile(start(new Set()), PIECES, 'Door', [3, 0, 0], 0)).toMatchObject({
      reason: 'conflict',
    });
  });
});
