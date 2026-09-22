import { describe, expect, it } from 'vitest';
import { TINY_NIF_B64, TINY_NIF_EXPECTED, fromBase64 } from '../../testdata/fixtures';
import { NifFile, halfToFloat } from './NifFile';
import { mergeShapes } from './geometry';
import { VertexFlags, decodeVertexDesc } from './vertexDesc';

const nif = () => NifFile.parse(fromBase64(TINY_NIF_B64));

describe('NifFile', () => {
  it('parses the header and block table', () => {
    const f = nif();
    expect(f.blockTypes).toEqual([...TINY_NIF_EXPECTED.blockTypes]);
    expect(f.blocks.map((b) => b.name)).toEqual([...TINY_NIF_EXPECTED.blockNames]);
    expect(f.roots).toEqual([0]);
    expect(f.blocks[0]!.children).toEqual([1, 2]);
  });

  it('reads full-precision and half-precision positions', () => {
    const f = nif();
    const floor = f.blocks[1]!;
    expect(floor.type).toBe('BSTriShape');
    expect(Array.from(floor.vertices!)).toEqual(TINY_NIF_EXPECTED.floorVertices.flat());
    expect(Array.from(floor.triangles!)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(floor.vertexFlags! & VertexFlags.uvs).toBeTruthy();
    const decal = f.blocks[3]!;
    expect(Array.from(decal.vertices!)).toEqual([0, 0, 0, 10, 0, 0, 0, 10, 0]);
    expect(decal.alphaProperty).toBe(4);
    expect(decal.shaderProperty).toBe(5);
  });

  it('accumulates node transforms into shape world coordinates', () => {
    const shapes = nif().shapes();
    expect(shapes.map((s) => s.path)).toEqual(['Tile/Floor', 'Tile/Offset/Decal']);
    expect(Array.from(shapes[1]!.world.translation)).toEqual([0, 0, 100]);
  });

  it('merges shapes into one mesh with a bounding box', () => {
    const merged = mergeShapes(nif());
    expect(merged.indices.length / 3).toBe(TINY_NIF_EXPECTED.triangleCount);
    expect(merged.min).toEqual(TINY_NIF_EXPECTED.bboxMin);
    expect(merged.max).toEqual(TINY_NIF_EXPECTED.bboxMax);
    expect(Array.from(merged.positions.subarray(12, 21))).toEqual(
      TINY_NIF_EXPECTED.decalWorldVertices.flat(),
    );
    expect(merged.ranges.map((r) => r.alpha)).toEqual([false, true]);
    expect(mergeShapes(nif(), { skipAlpha: true }).ranges.map((r) => r.name)).toEqual([
      'Tile/Floor',
    ]);
  });

  it('rejects other formats', () => {
    expect(() =>
      NifFile.parse(new TextEncoder().encode('NetImmerse File Format, Version 4.0.0.2\n')),
    ).toThrow('unsupported');
  });
});

describe('vertex helpers', () => {
  it('decodes the vertex description of a vanilla static mesh', () => {
    // imphall1way01: desc 0x0003b00007650408 -> 32-byte vertices, 16-byte positions
    const layout = decodeVertexDesc(0x0003b00007650408n);
    expect(layout).toEqual({ vertexSize: 32, positionBytes: 16, flags: 0x3b });
  });

  it('converts half floats', () => {
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0xc000)).toBe(-2);
    expect(halfToFloat(0x0000)).toBe(0);
    expect(halfToFloat(0x5640)).toBe(100);
  });
});
