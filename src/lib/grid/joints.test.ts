import { describe, expect, it } from 'vitest';
import type { Profile } from '../mesh/profiles';
import { inFrameOf, profileFit } from './joints';

// a hall opening: floor, two jambs and a lintel, u centred, v up
const HALL: Profile = [
  [-100, 0, 100, 0],
  [-100, 0, -100, 200],
  [100, 0, 100, 200],
  [-100, 200, 100, 200],
];
const shifted = (p: Profile, du: number, dv = 0): Profile =>
  p.map((s) => [s[0]! + du, s[1]! + dv, s[2]! + du, s[3]! + dv]);

describe('profileFit', () => {
  it('tells exact, included, seam and mismatch apart', () => {
    expect(profileFit(HALL, HALL).fit).toBe('exact');
    // the other side has an extra ceiling beam
    expect(profileFit(HALL, [...HALL, [-100, 180, 100, 180]]).fit).toBe('included');
    // jambs 5 units apart: grouped by the loose tolerance, but a seam up close
    const seam = profileFit(HALL, shifted(HALL, 5));
    expect(seam.fit).toBe('seam');
    expect(seam.gap).toBeCloseTo(5, 0);
    expect(profileFit(HALL, shifted(HALL, 40)).fit).toBe('mismatch');
  });
});

describe('inFrameOf', () => {
  it('mirrors the facing profile and shifts it by the offset between centres', () => {
    const asym: Profile = [[0, 0, 50, 0]];
    // +Y face: u runs along -X; the facing opening is one cell further along +X
    const a = { dir: '+Y' as const, cells: [[0, 0, 0] as const] };
    const b = { cells: [[1, 1, 0] as const] };
    expect(inFrameOf(a, b, asym, { xy: 128, z: 128 })).toEqual([[-128, 0, -178, 0]]);
    // one level up
    const up = { cells: [[0, 1, 1] as const] };
    expect(inFrameOf(a, up, asym, { xy: 128, z: 128 })).toEqual([[0, 128, -50, 128]]);
  });
});
