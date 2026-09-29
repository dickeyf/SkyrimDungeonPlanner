import { describe, expect, it } from 'vitest';
import { BinaryReader } from '../../binary/BinaryReader';
import { BinaryWriter } from '../../binary/BinaryWriter';
import { decodeCompressedMeshData } from './collision';

/** A bhkCompressedMeshShapeData with one chunk (a strip of 2 triangles + 1 plain) and 1 big triangle. */
function sampleData(): Uint8Array {
  const w = new BinaryWriter();
  w.u32(17).u32(18).u32(0x3ffff).u32(0x1ffff); // bits and masks
  w.f32(0.5); // error: quantization step
  for (let i = 0; i < 8; i++) w.f32(0); // bounds
  w.u8(0).u8(0); // welding type, material type
  w.u32(0).u32(0).u32(0); // materials 32/16/8
  w.u32(1).u32(7).u32(0); // one chunk material: id 7, filter
  w.u32(0); // named materials
  // one transform: translation (10, 0, 0), rotation 90 degrees about Z
  w.u32(1).f32(10).f32(0).f32(0).f32(0).f32(0).f32(0).f32(Math.SQRT1_2).f32(Math.SQRT1_2);
  // big vertices and one big triangle
  w.u32(3);
  for (const v of [
    [100, 0, 0],
    [101, 0, 0],
    [100, 1, 0],
  ])
    w.f32(v[0]!).f32(v[1]!).f32(v[2]!).f32(0);
  w.u32(1).u16(0).u16(1).u16(2).u32(9).u16(0);
  // one chunk: translation (1, 2, 3), material 0, transform 0
  w.u32(1).f32(1).f32(2).f32(3).f32(0).u32(0).u16(0).u16(0);
  const coords = [0, 0, 0, 2, 0, 0, 0, 2, 0, 2, 2, 0, 4, 4, 0];
  w.u32(coords.length);
  for (const c of coords) w.u16(c);
  const indices = [0, 1, 2, 3, 2, 3, 4];
  w.u32(indices.length);
  for (const i of indices) w.u16(i);
  w.u32(1).u16(4); // one strip of 4 indices
  w.u32(0); // welding info
  w.u32(0); // convex pieces
  return w.toUint8Array();
}

describe('decodeCompressedMeshData', () => {
  const bytes = sampleData();
  const mesh = decodeCompressedMeshData(new BinaryReader(bytes.buffer, 0, bytes.byteLength));

  it('dequantizes chunk vertices, then applies the chunk transform', () => {
    // Local (1 + 1, 2 + 0, 3) rotated 90 degrees about Z -> (-2, 2, 3), moved by (10, 0, 0).
    expect(mesh.vertices[1]![0]).toBeCloseTo(8);
    expect(mesh.vertices[1]![1]).toBeCloseTo(2);
    expect(mesh.vertices[1]![2]).toBeCloseTo(3);
  });

  it('reads strips (alternating winding), then plain triangles, then big triangles', () => {
    expect(mesh.triangles).toEqual([
      [0, 1, 2],
      [1, 3, 2],
      [2, 3, 4],
      [5, 6, 7],
    ]);
    expect(mesh.materials).toEqual([7, 7, 7, 9]);
    expect(mesh.vertices[5]).toEqual([100, 0, 0]);
  });
});
