import { describe, expect, it } from 'vitest';
import {
  isComposite,
  mergeDecision,
  setComposite,
  setMergeDecision,
  setOverlap,
  setPiece,
  validateUsed,
  variantBase,
} from './annotationEdits';
import { emptyAnnotations } from './annotations';

describe('annotation edits', () => {
  it('records, replaces and clears a merge decision in either face order', () => {
    let a = setMergeDecision(emptyAnnotations('Imperial'), ['A:+Y', 'B:-X'], 'same-type');
    expect(mergeDecision(a, ['B:-X', 'A:+Y'])).toBe('same-type');
    a = setMergeDecision(a, ['B:-X', 'A:+Y'], 'distinct');
    expect(a.merges).toEqual([{ faces: ['B:-X', 'A:+Y'], decision: 'distinct' }]);
    a = setMergeDecision(a, ['A:+Y', 'B:-X'], undefined);
    expect(a.merges).toEqual([]);
  });

  it('toggles a composite without duplicating it', () => {
    let a = setComposite(emptyAnnotations('Imperial'), 'Door:-Y', 'Hall:+Y', true);
    a = setComposite(a, 'Door:-Y', 'Hall:+Y', true);
    expect(a.composites).toEqual([{ face: 'Door:-Y', accepts: 'Hall:+Y' }]);
    expect(isComposite(a, 'Door:-Y', 'Hall:+Y')).toBe(true);
    a = setComposite(a, 'Door:-Y', 'Hall:+Y', false);
    expect(a.composites).toEqual([]);
  });

  it('patches pieces and removes empty entries', () => {
    let a = setPiece(emptyAnnotations('Imperial'), 'P', { validated: true });
    a = setPiece(a, 'P', { exclude: 'off grid' });
    expect(a.pieces.P).toEqual({ validated: true, exclude: 'off grid' });
    a = setPiece(a, 'P', { validated: false, exclude: undefined });
    expect(a.pieces).toEqual({});
  });

  it('records and removes accepted overlaps', () => {
    const nested = {
      pieces: ['Room', 'Door'] as [string, string],
      rotation: 0 as const,
      offset: [3, 0, 0] as [number, number, number],
    };
    let a = setOverlap(emptyAnnotations('Imperial'), nested, true);
    a = setOverlap(a, { ...nested, offset: [3, 0, 0] }, true);
    expect(a.overlaps).toEqual([nested]);
    a = setOverlap(a, nested, false);
    expect(a.overlaps).toEqual([]);
  });

  it('validates the pieces the game uses and excludes the others, keeping the rest (V5)', () => {
    const before = setPiece(emptyAnnotations('Dwemer'), 'B', { walkable: 'reviewed' });
    const a = validateUsed(
      before,
      ['A', 'B', 'C'].map((editorId) => ({ editorId, faces: [] })),
      { A: 5, B: 1 },
      2,
      'Skyrim.esm',
    );
    expect(a.pieces['A']).toEqual({ validated: true });
    expect(a.pieces['B']).toEqual({
      walkable: 'reviewed',
      exclude: "not used by the game (1 in Skyrim.esm's CELLs)",
    });
    expect(a.pieces['C']!.exclude).toContain('0 in');
  });

  it('validates the snow and ice variants of a piece the game uses (V5)', () => {
    expect(variantBase('DweFacadeHallSm1way01snow')).toBe('DweFacadeHallSm1way01');
    expect(variantBase('NorRmBgWallFront01_HeavySN')).toBe('NorRmBgWallFront01');
    expect(variantBase('NorCatHallBg1wayRamp256LtSnow')).toBe('NorCatHallBg1wayRamp256');
    expect(variantBase('NorHallSm4way01SnowLight')).toBe('NorHallSm4way01');
    expect(variantBase('DweRmSmWallHalf01')).toBe('DweRmSmWallHalf01');
    const a = validateUsed(
      emptyAnnotations('Dwemer'),
      ['A01', 'A01Snow', 'B01ice'].map((editorId) => ({ editorId, faces: [] })),
      { A01: 3 },
      2,
      'X',
    );
    expect(a.pieces['A01Snow']).toEqual({ validated: true });
    expect(a.pieces['B01ice']!.exclude).toBeDefined();
  });

  it('confirms a light-rimmed opening the game joins most of the time, not one it leaves open', () => {
    const pieces = [
      {
        editorId: 'Cap',
        faces: [
          { dir: '-Y' as const },
          { dir: '+Y' as const, confirm: true as const },
          { dir: '+X' as const, confirm: true as const },
        ],
      },
    ];
    const stats = { 'Cap:+Y': { placed: 20, open: 3 }, 'Cap:+X': { placed: 20, open: 19 } };
    const a = validateUsed(emptyAnnotations('Dwemer'), pieces, { Cap: 20 }, 2, 'X', stats);
    expect(a.pieces['Cap']).toEqual({ validated: true, openings: ['+Y'] });
    // too few placements: not confirmed
    const b = validateUsed(emptyAnnotations('Dwemer'), pieces, { Cap: 3 }, 2, 'X', {
      'Cap:+Y': { placed: 3, open: 0 },
    });
    expect(b.pieces['Cap']).toEqual({ validated: true });
  });
});
