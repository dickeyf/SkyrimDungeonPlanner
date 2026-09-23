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
      [0, 1, 0],
      [1, 1, 0],
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

function auto(): Catalogue {
  return {
    version: 1,
    kits: [{ kit: 'Imperial', module: { xy: 128, z: 128 } }],
    connectionTypes: [
      { id: 'Imperial:G0', kit: 'Imperial', signature: 'w208', mate: 'Imperial:G0', navEdge: null },
      { id: 'Imperial:G1', kit: 'Imperial', signature: 'w463', mate: 'Imperial:G1', navEdge: null },
      { id: 'Imperial:G3', kit: 'Imperial', signature: 'w232', mate: 'Imperial:G4', navEdge: null },
      { id: 'Imperial:G4', kit: 'Imperial', signature: 'w232', mate: 'Imperial:G3', navEdge: null },
      {
        id: 'Imperial:G9',
        kit: 'Imperial',
        signature: 'w512',
        mate: 'Imperial:G10',
        navEdge: null,
      },
      {
        id: 'Imperial:G10',
        kit: 'Imperial',
        signature: 'w512',
        mate: 'Imperial:G9',
        navEdge: null,
      },
      {
        id: 'Imperial:G12',
        kit: 'Imperial',
        signature: 'w512',
        mate: 'Imperial:G12',
        navEdge: null,
      },
    ],
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

describe('faceIndex', () => {
  it('maps EditorID:dir to the automatic type', () => {
    const idx = faceIndex(auto());
    expect(idx.get('ImpHall1Way01:+Y')).toBe('Imperial:G0');
    expect(idx.get('ImpLRoomMid01:-X')).toBe('Imperial:G12');
    expect(idx.get('ImpHall1Way01:+X')).toBeUndefined();
  });
});

describe('applyAnnotations', () => {
  it('leaves the catalogue unchanged with empty annotations', () => {
    const result = applyAnnotations(auto(), emptyAnnotations('Imperial'));
    expect(result.issues).toEqual([]);
    expect(result.catalogue.connectionTypes.map((t) => t.id)).toEqual(
      auto().connectionTypes.map((t) => t.id),
    );
    expect(result.unnamedTypes).toBe(7);
  });

  it('names types through a representative face and renames mates and piece faces', () => {
    const a: Annotations = {
      ...emptyAnnotations('Imperial'),
      connectionTypes: [
        { name: 'ImpHallSm', face: 'ImpHall1Way01:+Y', validated: true },
        { name: 'ImpRoomSmWallL', face: 'ImpRoomCorner01:+X' },
        { name: 'ImpRoomSmWallR', face: 'ImpRoomCorner01:-Y' },
      ],
    };
    const { catalogue, issues, unnamedTypes } = applyAnnotations(auto(), a);
    expect(issues).toEqual([]);
    const types = new Map(catalogue.connectionTypes.map((t) => [t.id, t]));
    expect(types.get('ImpHallSm')?.mate).toBe('ImpHallSm');
    expect(types.get('ImpRoomSmWallL')?.mate).toBe('ImpRoomSmWallR');
    expect(types.get('ImpRoomSmWallR')?.mate).toBe('ImpRoomSmWallL');
    expect(catalogue.pieces[0]!.faces.every((f) => f.conn === 'ImpHallSm')).toBe(true);
    expect(unnamedTypes).toBe(4);
  });

  it('merges near-matched groups on a same-type decision, and ignores refusals', () => {
    const a: Annotations = {
      ...emptyAnnotations('Imperial'),
      merges: [
        { faces: ['ImpLRoomMid01:-X', 'ImpLRoomMid01:+Y'], decision: 'same-type' },
        { faces: ['ImpHall1Way01:+Y', 'ImpLHallDoor01:+Y'], decision: 'distinct' },
      ],
      connectionTypes: [{ name: 'ImpRoomLgSideB', face: 'ImpLRoomMid01:+Y' }],
    };
    const { catalogue, issues } = applyAnnotations(auto(), a);
    expect(issues).toEqual([]);
    const mid = catalogue.pieces.find((p) => p.editorId === 'ImpLRoomMid01')!;
    const conn = (dir: string) => mid.faces.find((f) => f.dir === dir)!.conn;
    expect(conn('-X')).toBe('ImpRoomLgSideB');
    expect(conn('+Y')).toBe('ImpRoomLgSideB');
    expect(conn('-Y')).toBe('Imperial:G9');
    expect(catalogue.connectionTypes.length).toBe(6);
    // the merged group keeps its root's mate, renamed
    const merged = catalogue.connectionTypes.find((t) => t.id === 'ImpRoomLgSideB')!;
    expect(merged.mate).toBe('Imperial:G9');
  });

  it('adds extra types to composite faces, excludes and re-categorizes pieces', () => {
    const a: Annotations = {
      ...emptyAnnotations('Imperial'),
      connectionTypes: [
        { name: 'ImpHallSm', face: 'ImpHall1Way01:+Y' },
        { name: 'ImpHallLg', face: 'ImpLHallDoor01:+Y' },
      ],
      faces: { 'ImpLHallDoor01:-Y': { extraTypes: ['ImpHallSm'] } },
      pieces: {
        ImpHall1Way64D01: { exclude: 'not on the 128 grid' },
        ImpLHallDoor01: { category: 'door', validated: true },
      },
    };
    const { catalogue, excludedPieces, issues } = applyAnnotations(auto(), a);
    expect(issues).toEqual([]);
    expect(excludedPieces).toEqual(['ImpHall1Way64D01']);
    const door = catalogue.pieces.find((p) => p.editorId === 'ImpLHallDoor01')!;
    expect(door.category).toBe('door');
    expect(door.review.validated).toBe(true);
    expect(
      door.faces
        .filter((f) => f.dir === '-Y')
        .every((f) => f.conn === 'ImpHallLg' && f.extraConn?.[0] === 'ImpHallSm'),
    ).toBe(true);
    expect(door.faces.find((f) => f.dir === '+Y')!.extraConn).toBeUndefined();
  });

  it('reports orphans, unknown names and conflicts instead of failing', () => {
    const a: Annotations = {
      ...emptyAnnotations('Imperial'),
      connectionTypes: [
        { name: 'A', face: 'ImpHall1Way01:+Y' },
        { name: 'B', face: 'ImpHall1Way01:-Y' },
        { name: 'A', face: 'ImpLHallDoor01:+Y' },
        { name: 'Gone', face: 'ImpRemoved01:+Y' },
      ],
      faces: { 'ImpHall1Way01:-Y': { extraTypes: ['Nope'] } },
      pieces: { ImpRemoved01: { validated: true } },
    };
    const kinds = applyAnnotations(auto(), a)
      .issues.map((i) => i.kind)
      .sort();
    expect(kinds).toEqual([
      'duplicate-name',
      'name-conflict',
      'unknown-face',
      'unknown-piece',
      'unknown-type-name',
    ]);
  });
});

describe('serialization', () => {
  it('round-trips with sorted keys', () => {
    const a: Annotations = {
      ...emptyAnnotations('Imperial'),
      connectionTypes: [
        { name: 'Z', face: 'ImpHall1Way01:+Y' },
        { name: 'A', face: 'ImpLHallDoor01:+Y' },
      ],
      pieces: { Zeta: { validated: true }, Alpha: { exclude: 'x' } },
    };
    const text = serializeAnnotations(a);
    expect(text.indexOf('"Alpha"')).toBeLessThan(text.indexOf('"Zeta"'));
    expect(text.indexOf('"name": "A"')).toBeLessThan(text.indexOf('"name": "Z"'));
    expect(parseAnnotations(JSON.parse(text))).toEqual({
      ...a,
      connectionTypes: [a.connectionTypes[1], a.connectionTypes[0]],
    });
    expect(() => parseAnnotations({ version: 2, kit: 'x' })).toThrow('version');
  });
});
