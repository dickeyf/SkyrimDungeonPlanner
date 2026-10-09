import { describe, expect, it } from 'vitest';
import {
  isComposite,
  mergeDecision,
  setComposite,
  setMergeDecision,
  setOverlap,
  setPiece,
  validateUsed,
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
    const a = validateUsed(before, ['A', 'B', 'C'], { A: 5, B: 1 }, 2, 'Skyrim.esm');
    expect(a.pieces['A']).toEqual({ validated: true });
    expect(a.pieces['B']).toEqual({
      walkable: 'reviewed',
      exclude: "not used by the game (1 in Skyrim.esm's CELLs)",
    });
    expect(a.pieces['C']!.exclude).toContain('0 in');
  });
});
