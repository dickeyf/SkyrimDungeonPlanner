import { describe, expect, it } from 'vitest';
import { mergeCatalogues } from './merge';
import type { Catalogue } from './types';

const cat = (kit: string, xy: number): Catalogue => ({
  version: 1,
  kits: [{ kit, module: { xy, z: 128 } }],
  connectionTypes: [{ id: `${kit}:G0`, kit, signature: '', mate: `${kit}:G0`, navEdge: null }],
  pieces: [],
});

describe('mergeCatalogues', () => {
  it('puts the kits side by side', () => {
    const m = mergeCatalogues([cat('Imperial', 128), cat('Nordic', 128)]);
    expect(m.kits.map((k) => k.kit)).toEqual(['Imperial', 'Nordic']);
    expect(m.connectionTypes.map((t) => t.id)).toEqual(['Imperial:G0', 'Nordic:G0']);
    expect(m.overlaps).toBeUndefined();
  });

  it('refuses kits whose modules differ', () => {
    expect(() => mergeCatalogues([cat('Imperial', 128), cat('Dwemer', 256)])).toThrow(/modules/);
  });
});
