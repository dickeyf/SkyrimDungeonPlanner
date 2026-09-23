import { describe, expect, it } from 'vitest';
import type { AnalysisResult } from './analyze';
import { buildReview } from './review';

// U-shaped opening of the given half width, floor 0 to ceiling 300
const u = (hw: number) => [
  [-hw, 0, hw, 0],
  [-hw, 0, -hw, 300],
  [hw, 0, hw, 300],
  [-hw, 300, hw, 300],
];
// a wide opening closed by a wall pierced with a narrow door: both contours at once
const composite = [...u(200), ...u(96)];

function analysis(): AnalysisResult {
  const faces = [
    { piece: 'Hall', profile: u(96), group: 0 },
    { piece: 'Hall', profile: u(96), group: 0 },
    { piece: 'Big', profile: u(200), group: 1 },
    { piece: 'BigDoor', profile: composite, group: 2 },
    { piece: 'Almost', profile: u(99), group: 3 },
  ].map((f) => ({ ...f, opening: { dir: '+Y' }, level: 0, cells: [] }));
  const group = (id: number, members: number[], width: number) => ({
    id,
    members,
    mate: id,
    width,
    height: 300,
    vMin: 0,
  });
  return {
    kit: { kit: 'Imperial' },
    faces,
    grouping: {
      groups: [group(0, [0, 1], 192), group(1, [2], 400), group(2, [3], 400), group(3, [4], 198)],
      groupOf: [0, 0, 1, 2, 3],
      near: [
        { a: 0, b: 4, score: 0.9 },
        { a: 1, b: 4, score: 0.92 },
      ],
    },
  } as unknown as AnalysisResult;
}

describe('buildReview', () => {
  it('lists one entry per type with a representative face', () => {
    const r = buildReview(analysis());
    expect(r.types.map((t) => [t.id, t.representative, t.faces.length])).toEqual([
      ['Imperial:G0', 0, 2],
      ['Imperial:G1', 2, 1],
      ['Imperial:G2', 3, 1],
      ['Imperial:G3', 4, 1],
    ]);
  });

  it('aggregates near matches per pair of types, keeping the best', () => {
    const r = buildReview(analysis());
    expect(r.near).toEqual([{ a: 0, b: 3, bestScore: 0.92, count: 2, faceA: 1, faceB: 4 }]);
  });

  it('finds composite faces: contours entirely contained in another type', () => {
    const r = buildReview(analysis());
    const pairs = r.containment.map((c) => `${c.inner}<${c.outer}`).sort();
    expect(pairs).toContain('0<2'); // narrow door inside the pierced wall
    expect(pairs).toContain('1<2'); // wide opening inside it too
    expect(pairs).not.toContain('2<0');
  });
});
