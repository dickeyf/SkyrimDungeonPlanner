import { describe, expect, it } from 'vitest';
import { decodeBc, levelSize, parseDds } from './dds';

/** A DDS file: header with a fourCC (or DX10 + dxgi), then `data`. */
function dds(
  width: number,
  height: number,
  mips: number,
  code: string,
  data: number[],
  dxgi?: number,
) {
  const head = new DataView(new ArrayBuffer(dxgi === undefined ? 128 : 148));
  head.setUint32(0, 0x20534444, true);
  head.setUint32(4, 124, true);
  head.setUint32(12, height, true);
  head.setUint32(16, width, true);
  head.setUint32(28, mips, true);
  head.setUint32(76, 32, true);
  head.setUint32(80, 0x4, true);
  for (let i = 0; i < 4; i++) head.setUint8(84 + i, code.charCodeAt(i));
  if (dxgi !== undefined) head.setUint32(128, dxgi, true);
  const out = new Uint8Array(head.byteLength + data.length);
  out.set(new Uint8Array(head.buffer));
  out.set(data, head.byteLength);
  return out;
}

describe('parseDds', () => {
  it('reads the format and the mip levels', () => {
    // 8 x 8 BC1: 4 blocks (32 bytes), then 4 x 4 (8 bytes), 2 x 2 and 1 x 1 (8 bytes each)
    const t = parseDds(dds(8, 8, 4, 'DXT1', new Array(56).fill(0)));
    expect(t.format).toBe('BC1');
    expect(t.levels.map((l) => [l.width, l.height, l.data.length])).toEqual([
      [8, 8, 32],
      [4, 4, 8],
      [2, 2, 8],
      [1, 1, 8],
    ]);
  });

  it('reads a DX10 header (BC7)', () => {
    const t = parseDds(dds(4, 4, 1, 'DX10', new Array(16).fill(0), 98));
    expect(t.format).toBe('BC7');
    expect(t.levels[0]!.data.length).toBe(16);
    expect(levelSize('BC7', 5, 5)).toBe(4 * 16);
  });

  it('refuses what is not a DDS', () => {
    expect(() => parseDds(new Uint8Array(200))).toThrow(/not a DDS/);
  });
});

describe('decodeBc', () => {
  it('decodes a BC1 block: two end colours and their blends', () => {
    // red (0xF800) and blue (0x001F); row 0 uses indices 0, 1, 2, 3
    const block = [0x00, 0xf8, 0x1f, 0x00, 0b11100100, 0, 0, 0];
    const t = parseDds(dds(4, 4, 1, 'DXT1', block));
    const rgba = decodeBc(t.format, t.levels[0]!);
    expect([...rgba.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...rgba.subarray(4, 8)]).toEqual([0, 0, 255, 255]);
    expect([...rgba.subarray(8, 12)]).toEqual([170, 0, 85, 255]);
    expect([...rgba.subarray(12, 16)]).toEqual([85, 0, 170, 255]);
  });

  it('decodes BC3 alpha', () => {
    // alpha 255 to 0, all pixels index 1 (= 0); colour white
    const alpha = [255, 0, 0b01001001, 0b10010010, 0b00100100, 0b01001001, 0b10010010, 0b00100100];
    const colour = [0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0];
    const t = parseDds(dds(4, 4, 1, 'DXT5', [...alpha, ...colour]));
    const rgba = decodeBc(t.format, t.levels[0]!);
    expect([...rgba.subarray(0, 4)]).toEqual([255, 255, 255, 0]);
  });
});
