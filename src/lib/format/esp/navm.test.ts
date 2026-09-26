import { describe, expect, it } from 'vitest';
import { BinaryWriter } from '../../binary/BinaryWriter';
import {
  NAVM_MAGIC,
  NAVM_VERSION,
  decodeNavm,
  decodeNvnm,
  encodeNvnm,
  type NavMeshData,
} from './navm';
import { writeSubrecords } from './subrecords';
import { record } from './testPlugin';

/** Two triangles forming a 256 x 256 square, one door link and a 2 x 2 search grid. */
function square(): NavMeshData {
  return {
    version: NAVM_VERSION,
    magic: NAVM_MAGIC,
    parent: { kind: 'cell', cell: 0x01000d62 },
    vertices: [
      [0, 0, 0],
      [256, 0, 0],
      [256, 256, 0],
      [0, 256, 0],
    ],
    triangles: [
      { vertices: [0, 1, 2], edges: [-1, -1, 1], flags: 0x0800, coverFlags: 0 },
      { vertices: [0, 2, 3], edges: [0, -1, -1], flags: 0x0800, coverFlags: 0 },
    ],
    edgeLinks: [],
    doorLinks: [{ triangle: 1, crc: 0x12345678, door: 0x01000d70 }],
    cover: [],
    grid: {
      divisor: 2,
      maxDistanceX: 128,
      maxDistanceY: 128,
      min: [0, 0, 0],
      max: [256, 256, 0],
      cells: [[0, 1], [0], [1], [0, 1]],
    },
    trailing: new Uint8Array(),
  };
}

describe('NVNM', () => {
  it('decodes what it encodes', () => {
    const nav = square();
    expect(decodeNvnm(encodeNvnm(nav))).toEqual(nav);
  });

  it('lays out the header, counts and triangles as the game expects', () => {
    const bytes = encodeNvnm(square());
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(v.getUint32(0, true)).toBe(12);
    expect(v.getUint32(4, true)).toBe(0xa5e9a03c);
    expect(v.getUint32(8, true)).toBe(0); // interior: no worldspace
    expect(v.getUint32(12, true)).toBe(0x01000d62);
    expect(v.getUint32(16, true)).toBe(4); // vertices
    const tri = 20 + 4 * 12;
    expect(v.getUint32(tri, true)).toBe(2);
    expect(v.getInt16(tri + 4 + 16 + 6, true)).toBe(0); // triangle 1, edge 0-1 -> triangle 0
    expect(v.getInt16(tri + 4 + 16 + 8, true)).toBe(-1);
    expect(v.getUint16(tri + 4 + 16 + 12, true)).toBe(0x0800);
    // 4 bytes after the triangles: no edge links; then 1 door link of 10 bytes
    const links = tri + 4 + 2 * 16;
    expect(v.getUint32(links, true)).toBe(0);
    expect(v.getUint32(links + 4, true)).toBe(1);
    expect(v.getUint32(links + 4 + 4 + 2 + 4, true)).toBe(0x01000d70);
    // grid header 36 bytes, then 4 cells (2 + 1 + 1 + 2 triangles)
    const grid = links + 4 + 4 + 10 + 4;
    expect(v.getUint32(grid, true)).toBe(2);
    expect(bytes.byteLength).toBe(grid + 36 + 4 * 4 + 6 * 2);
  });

  it('reads an exterior parent as worldspace and grid coordinates', () => {
    const nav: NavMeshData = {
      ...square(),
      parent: { kind: 'grid', worldspace: 0x3c, x: -3, y: 7 },
      edgeLinks: [{ type: 0, navMesh: 0x000f1234, triangle: 5 }],
    };
    const bytes = encodeNvnm(nav);
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(v.getInt16(12, true)).toBe(7);
    expect(v.getInt16(14, true)).toBe(-3);
    expect(decodeNvnm(bytes)).toEqual(nav);
  });

  it('keeps unknown trailing bytes so the field writes back unchanged', () => {
    const bytes = new BinaryWriter()
      .raw(encodeNvnm(square()))
      .raw(new Uint8Array([1, 2, 3]))
      .toUint8Array();
    const nav = decodeNvnm(bytes);
    expect(nav.trailing).toEqual(new Uint8Array([1, 2, 3]));
    expect(encodeNvnm(nav)).toEqual(bytes);
  });

  it('refuses counts larger than the field', () => {
    const bytes = encodeNvnm(square()).slice(0, 30);
    expect(() => decodeNvnm(bytes)).toThrow(/exceed/);
  });

  it('finds the NVNM field of a NAVM record', async () => {
    const data = writeSubrecords([
      { type: 'NVNM', data: encodeNvnm(square()) },
      { type: 'ONAM', data: new Uint8Array(4) },
    ]);
    const nav = await decodeNavm(record('NAVM', 0x01000d80, data));
    expect(nav?.triangles).toHaveLength(2);
    expect(await decodeNavm(record('NAVM', 0x01000d81, new Uint8Array()))).toBeUndefined();
  });
});
