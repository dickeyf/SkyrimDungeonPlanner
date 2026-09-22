import { describe, expect, it } from 'vitest';
import { computeFootprint, gridPhase, overlappedCells } from './footprint';
import { weldMesh } from './geometry';
import { findOpenings } from './openings';
import { extractProfile, mergeCollinear, mirror, profileExtent } from './profiles';
import { groupProfiles } from './signatures';
import { corridorMesh } from './testShapes';

const MODULE = 128;

describe('weldMesh', () => {
  it('welds shared vertices and finds the open edges of a corridor', () => {
    const g = weldMesh(corridorMesh());
    // subdivided quads share their edges once welded
    expect(g.count).toBeLessThan((g.triangles.length / 6) * 4);
    expect(g.openEdges.length / 2).toBeGreaterThan(0);
    expect(g.min).toEqual([-128, -128, 8]);
    expect(g.max).toEqual([128, 128, 310]);
  });
});

describe('findOpenings', () => {
  it('finds the two open ends and no opening on the walled sides', () => {
    const g = weldMesh(corridorMesh());
    const openings = findOpenings(g);
    expect(openings.map((o) => o.dir).sort()).toEqual(['+Y', '-Y']);
    for (const o of openings) {
      expect(o.width).toBe(192);
      expect(o.zMin).toBe(8);
      expect(o.zMax).toBe(310);
      expect(o.centre).toBe(0);
    }
  });

  it('follows a jogged exit', () => {
    const openings = findOpenings(weldMesh(corridorMesh({ jog: -128 })));
    const exit = openings.find((o) => o.dir === '+Y')!;
    expect(exit.centre).toBe(-128);
  });
});

describe('footprint', () => {
  it('computes phase and overlapped cells like the Python reference', () => {
    expect(gridPhase([-128, 128], [-128, 128], MODULE)).toEqual({ phase: 0, ok: true });
    expect(gridPhase([-64, 64], [-64, 64], MODULE)).toEqual({ phase: 64, ok: true });
    expect(gridPhase([-32, 32], [-32, 32], MODULE).ok).toBe(false);
    expect(overlappedCells(-128, 128, MODULE)).toEqual([-1, 0]);
    expect(overlappedCells(-130.4, 123.1, MODULE)).toEqual([-1, 0]);
    expect(overlappedCells(-232, 104, MODULE)).toEqual([-2, -1, 0]);
  });

  it('gives a straight hall 2x2 cells with a central pivot, and a jog 3x2', () => {
    const g = weldMesh(corridorMesh());
    const fp = computeFootprint(g, findOpenings(g), MODULE, MODULE);
    expect(fp.fits).toBe(true);
    expect(fp.cells.map((c) => `${c[0]},${c[1]}`).sort()).toEqual(['0,0', '0,1', '1,0', '1,1']);
    expect(fp.pivot).toEqual([128, 128, 0]);
    expect(fp.openingCells.map((cells) => cells.map((c) => `${c[0]},${c[1]}`))).toEqual([
      ['0,0', '1,0'],
      ['0,1', '1,1'],
    ]);

    const jog = weldMesh(corridorMesh({ jog: -128 }));
    const fj = computeFootprint(jog, findOpenings(jog), MODULE, MODULE);
    expect(fj.cells.length).toBe(6);
    expect(fj.pivot).toEqual([256, 128, 0]);
  });
});

describe('profiles and signatures', () => {
  it('extracts a U-shaped rim, mirror-symmetric, identical at both ends', () => {
    const g = weldMesh(corridorMesh());
    const openings = findOpenings(g);
    const profiles = openings.map((o) => extractProfile(g, o, o.centre, 0, MODULE));
    for (const p of profiles) {
      const e = profileExtent(p);
      expect(e.width).toBe(192);
      expect(e.height).toBe(292); // floor 8 to ceiling 300; the trim strip is a minor component
      expect(e.vMin).toBe(8);
    }
    const result = groupProfiles(profiles);
    expect(result.groups.length).toBe(1);
    expect(result.groups[0]!.mate).toBe(0); // symmetric: mates with itself
    expect(result.near).toEqual([]);
  });

  it('separates a narrower opening into its own group, symmetric too', () => {
    const wide = weldMesh(corridorMesh());
    const narrow = weldMesh(corridorMesh({ halfWidth: 64 }));
    const pw = findOpenings(wide).map((o) => extractProfile(wide, o, o.centre, 0, MODULE));
    const pn = findOpenings(narrow).map((o) => extractProfile(narrow, o, o.centre, 0, MODULE));
    const result = groupProfiles([...pw, ...pn]);
    expect(result.groups.length).toBe(2);
    expect(result.groupOf).toEqual([0, 0, 1, 1]);
  });

  it('merges collinear chains and computes mirror images', () => {
    expect(
      mergeCollinear([
        [0, 0, 5, 0],
        [5, 0, 10, 0],
        [10, 0, 10, 4],
      ]),
    ).toEqual([
      [10, 0, 10, 4],
      [0, 0, 10, 0],
    ]);
    expect(mirror([[-3, 0, 5, 0]])).toEqual([[-5, 0, 3, 0]]);
  });

  it('scores an asymmetric profile against its mirror', () => {
    const g = weldMesh(corridorMesh({ jog: -128 }));
    const [a, b] = findOpenings(g).map((o) => extractProfile(g, o, o.centre, 0, MODULE));
    // both ends of a jog are plain corridor openings: identical
    const r = groupProfiles([a!, b!]);
    expect(r.groups.length).toBe(1);
  });
});
