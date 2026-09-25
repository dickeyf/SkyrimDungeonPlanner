import { describe, expect, it } from 'vitest';
import {
  applyAnnotations,
  emptyAnnotations,
  faceIndex,
  parseAnnotations,
  serializeAnnotations,
  type Annotations,
} from './annotations';
import type { Catalogue, Face, Piece } from './types';

function piece(editorId: string, faces: [Face['dir'], string][]): Piece {
  return {
    editorId,
    formKey: `0x${editorId.length.toString(16)}:Skyrim.esm`,
    model: `${editorId}.nif`,
    kit: 'Imperial',
    class: 'tile',
    category: 'hall',
    pivot: [128, 128, 0],
    cells: [
      [0, 0, 0],
      [1, 0, 0],
    ],
    // two cells per opening, same type, like the analysis produces
    faces: faces.flatMap(([dir, conn]) => [
      { cell: [0, 0, 0], dir, conn },
      { cell: [1, 0, 0], dir, conn },
    ]),
    walkable: null,
    obstacle: null,
    review: { auto: true, validated: false },
  };
}

const type = (g: number, mate = g) => ({
  id: `Imperial:G${g}`,
  kit: 'Imperial',
  signature: null,
  mate: `Imperial:G${mate}`,
  navEdge: null,
});

function auto(): Catalogue {
  return {
    version: 1,
    kits: [{ kit: 'Imperial', module: { xy: 128, z: 128 } }],
    connectionTypes: [type(0), type(1), type(3, 4), type(4, 3), type(9, 10), type(10, 9), type(12)],
    pieces: [
      piece('ImpHall1Way01', [
        ['-Y', 'Imperial:G0'],
        ['+Y', 'Imperial:G0'],
      ]),
      piece('ImpLHallDoor01', [
        ['-Y', 'Imperial:G1'],
        ['+Y', 'Imperial:G1'],
      ]),
      piece('ImpRoomCorner01', [
        ['+X', 'Imperial:G3'],
        ['-Y', 'Imperial:G4'],
      ]),
      piece('ImpLRoomMid01', [
        ['-X', 'Imperial:G12'],
        ['-Y', 'Imperial:G9'],
        ['+Y', 'Imperial:G10'],
      ]),
      piece('ImpHall1Way64D01', [['-Y', 'Imperial:G0']]),
    ],
  };
}

const conn = (c: Catalogue, editorId: string, dir: string) =>
  c.pieces.find((p) => p.editorId === editorId)!.faces.find((f) => f.dir === dir)!;

describe('faceIndex', () => {
  it('maps EditorID:dir to the automatic type', () => {
    const idx = faceIndex(auto());
    expect(idx.get('ImpHall1Way01:+Y')).toBe('Imperial:G0');
    expect(idx.get('ImpLRoomMid01:-X')).toBe('Imperial:G12');
    expect(idx.get('ImpHall1Way01:+X')).toBeUndefined();
  });
});

describe('applyAnnotations', () => {
  it('gives every type a stable id from its smallest face key, mates included', () => {
    const { catalogue, issues } = applyAnnotations(auto(), emptyAnnotations('Imperial'));
    expect(issues).toEqual([]);
    const ids = catalogue.connectionTypes.map((t) => t.id);
    expect(ids).toContain('Imperial/ImpHall1Way01:+Y'); // G0: +Y < -Y in code-unit order
    const g3 = catalogue.connectionTypes.find((t) => t.id === 'Imperial/ImpRoomCorner01:+X')!;
    expect(g3.mate).toBe('Imperial/ImpRoomCorner01:-Y');
    expect(conn(catalogue, 'ImpHall1Way64D01', '-Y').conn).toBe('Imperial/ImpHall1Way01:+Y');
  });

  it('merges near-matched groups on a same-type decision, and ignores refusals', () => {
    const a: Annotations = {
      ...emptyAnnotations('Imperial'),
      merges: [
        { faces: ['ImpLRoomMid01:-X', 'ImpLRoomMid01:+Y'], decision: 'same-type' },
        { faces: ['ImpHall1Way01:+Y', 'ImpLHallDoor01:+Y'], decision: 'distinct' },
      ],
    };
    const { catalogue, issues } = applyAnnotations(auto(), a);
    expect(issues).toEqual([]);
    expect(catalogue.connectionTypes.length).toBe(6);
    expect(conn(catalogue, 'ImpLRoomMid01', '-X').conn).toBe(
      conn(catalogue, 'ImpLRoomMid01', '+Y').conn,
    );
    expect(conn(catalogue, 'ImpLRoomMid01', '-Y').conn).not.toBe(
      conn(catalogue, 'ImpLRoomMid01', '+Y').conn,
    );
    expect(conn(catalogue, 'ImpHall1Way01', '+Y').conn).not.toBe(
      conn(catalogue, 'ImpLHallDoor01', '+Y').conn,
    );
  });

  it('lets every face of a composite type accept another type', () => {
    const a: Annotations = {
      ...emptyAnnotations('Imperial'),
      composites: [{ face: 'ImpLHallDoor01:-Y', accepts: 'ImpHall1Way01:+Y' }],
    };
    const { catalogue } = applyAnnotations(auto(), a);
    const door = catalogue.pieces.find((p) => p.editorId === 'ImpLHallDoor01')!;
    // G1 is the type of both faces of the door piece in this fixture
    expect(door.faces.every((f) => f.extraConn?.[0] === 'Imperial/ImpHall1Way01:+Y')).toBe(true);
    expect(conn(catalogue, 'ImpHall1Way01', '+Y').extraConn).toBeUndefined();
  });

  it('excludes, re-categorizes and validates pieces', () => {
    const a: Annotations = {
      ...emptyAnnotations('Imperial'),
      pieces: {
        ImpHall1Way64D01: { exclude: 'not on the 128 grid' },
        ImpLHallDoor01: { category: 'door', validated: true },
      },
    };
    const { catalogue, excludedPieces } = applyAnnotations(auto(), a);
    expect(excludedPieces).toEqual(['ImpHall1Way64D01']);
    const door = catalogue.pieces.find((p) => p.editorId === 'ImpLHallDoor01')!;
    expect(door.category).toBe('door');
    expect(door.review.validated).toBe(true);
  });

  it('reports faces and pieces that no longer exist instead of failing', () => {
    const a: Annotations = {
      ...emptyAnnotations('Imperial'),
      merges: [{ faces: ['ImpGone01:+Y', 'ImpHall1Way01:+Y'], decision: 'same-type' }],
      composites: [{ face: 'ImpLHallDoor01:-Y', accepts: 'ImpGone02:-X' }],
      pieces: { ImpRemoved01: { validated: true } },
    };
    const issues = applyAnnotations(auto(), a).issues;
    expect(issues).toEqual([
      { kind: 'unknown-face', face: 'ImpGone01:+Y', where: 'merge' },
      { kind: 'unknown-face', face: 'ImpGone02:-X', where: 'composite' },
      { kind: 'unknown-piece', piece: 'ImpRemoved01' },
    ]);
  });
});

describe('accepted overlaps', () => {
  it('are carried into the catalogue by FormKey, unknown pieces reported', () => {
    const a: Annotations = {
      ...emptyAnnotations('Imperial'),
      overlaps: [
        { pieces: ['ImpLHallDoor01', 'ImpHall1Way01'], rotation: 2, offset: [1, 3, 0] },
        { pieces: ['ImpGone03', 'ImpHall1Way01'], rotation: 0, offset: [1, 0, 0] },
      ],
    };
    const { catalogue, issues } = applyAnnotations(auto(), a);
    const key = (id: string) => catalogue.pieces.find((p) => p.editorId === id)!.formKey;
    expect(catalogue.overlaps).toEqual([
      { pieces: [key('ImpLHallDoor01'), key('ImpHall1Way01')], rotation: 2, offset: [1, 3, 0] },
    ]);
    expect(issues).toEqual([{ kind: 'unknown-piece', piece: 'ImpGone03' }]);
    expect(
      applyAnnotations(auto(), emptyAnnotations('Imperial')).catalogue.overlaps,
    ).toBeUndefined();
    const back = parseAnnotations(JSON.parse(serializeAnnotations(a)));
    expect(back.overlaps).toHaveLength(2);
  });
});

describe('serialization', () => {
  it('round-trips with sorted entries', () => {
    const a: Annotations = {
      ...emptyAnnotations('Imperial'),
      composites: [
        { face: 'Z:+Y', accepts: 'A:+Y' },
        { face: 'B:+Y', accepts: 'A:+Y' },
      ],
      pieces: { Zeta: { validated: true }, Alpha: { exclude: 'x' } },
    };
    const text = serializeAnnotations(a);
    expect(text.indexOf('"Alpha"')).toBeLessThan(text.indexOf('"Zeta"'));
    expect(text.indexOf('"B:+Y"')).toBeLessThan(text.indexOf('"Z:+Y"'));
    const back = parseAnnotations(JSON.parse(text));
    expect(back.composites.map((c) => c.face)).toEqual(['B:+Y', 'Z:+Y']);
    expect(back.pieces).toEqual(a.pieces);
    expect(() => parseAnnotations({ version: 2, kit: 'x' })).toThrow('version');
  });
});
