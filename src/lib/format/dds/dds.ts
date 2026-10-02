/**
 * DDS textures (V3 step 3, R17): the header, the DX10 extension and the mip levels of the
 * block-compressed formats Skyrim SE uses (BC1, BC2, BC3, BC5, BC7), plus 32-bit RGBA. The data
 * is kept as stored; `decodeBc` turns BC1 to BC3 into RGBA for a GPU without S3TC.
 *
 * Layout: "DDS " u32, header (124 bytes: size, flags, height, width, pitch, depth, mipMapCount,
 * 11 reserved, pixel format (32 bytes: size, flags, fourCC, rgbBitCount, 4 masks), caps x4,
 * reserved), then a DX10 header (dxgiFormat, dimension, misc, arraySize, misc2) when fourCC is
 * "DX10", then the levels, largest first.
 *
 * Reference: https://learn.microsoft.com/windows/win32/direct3ddds/dds-header
 */

export type DdsFormat = 'BC1' | 'BC2' | 'BC3' | 'BC4' | 'BC5' | 'BC7' | 'RGBA8' | 'BGRA8';

export interface DdsLevel {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface DdsTexture {
  format: DdsFormat;
  width: number;
  height: number;
  /** Largest first. */
  levels: DdsLevel[];
}

const MAGIC = 0x20534444; // "DDS "
const fourCC = (s: string) =>
  s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24);

const FOURCC: Record<number, DdsFormat> = {
  [fourCC('DXT1')]: 'BC1',
  [fourCC('DXT2')]: 'BC2',
  [fourCC('DXT3')]: 'BC2',
  [fourCC('DXT4')]: 'BC3',
  [fourCC('DXT5')]: 'BC3',
  [fourCC('ATI1')]: 'BC4',
  [fourCC('BC4U')]: 'BC4',
  [fourCC('ATI2')]: 'BC5',
  [fourCC('BC5U')]: 'BC5',
};

/** DXGI formats of the DX10 header, UNORM and sRGB alike. */
const DXGI: Record<number, DdsFormat> = {
  70: 'BC1',
  71: 'BC1',
  72: 'BC1',
  73: 'BC2',
  74: 'BC2',
  75: 'BC2',
  76: 'BC3',
  77: 'BC3',
  78: 'BC3',
  79: 'BC4',
  80: 'BC4',
  82: 'BC5',
  83: 'BC5',
  97: 'BC7',
  98: 'BC7',
  99: 'BC7',
  27: 'RGBA8',
  28: 'RGBA8',
  29: 'RGBA8',
  87: 'BGRA8',
  91: 'BGRA8',
};

/** Bytes per 4x4 block, or per pixel for the uncompressed formats. */
export function blockBytes(format: DdsFormat): number {
  return format === 'BC1' || format === 'BC4'
    ? 8
    : format === 'RGBA8' || format === 'BGRA8'
      ? 4
      : 16;
}

export function isCompressed(format: DdsFormat): boolean {
  return format !== 'RGBA8' && format !== 'BGRA8';
}

export function levelSize(format: DdsFormat, width: number, height: number): number {
  return isCompressed(format)
    ? Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4)) * blockBytes(format)
    : width * height * 4;
}

export function parseDds(bytes: Uint8Array): DdsTexture {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 128 || v.getUint32(0, true) !== MAGIC) throw new Error('not a DDS file');
  const height = v.getUint32(12, true);
  const width = v.getUint32(16, true);
  const mipCount = Math.max(1, v.getUint32(28, true));
  const pfFlags = v.getUint32(80, true);
  const code = v.getUint32(84, true);
  let offset = 128;
  let format: DdsFormat | undefined;
  if (pfFlags & 0x4) {
    if (code === fourCC('DX10')) {
      format = DXGI[v.getUint32(128, true)];
      offset = 148;
    } else format = FOURCC[code];
  } else if (pfFlags & 0x40 && v.getUint32(88, true) === 32) {
    // uncompressed 32-bit: tell RGBA from BGRA by the red mask
    format = v.getUint32(92, true) === 0x000000ff ? 'RGBA8' : 'BGRA8';
  }
  if (!format) throw new Error(`unsupported DDS format (fourCC 0x${code.toString(16)})`);
  const levels: DdsLevel[] = [];
  let w = width;
  let h = height;
  for (let i = 0; i < mipCount; i++) {
    const size = levelSize(format, w, h);
    if (offset + size > bytes.byteLength) break;
    levels.push({ width: w, height: h, data: bytes.subarray(offset, offset + size) });
    offset += size;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  if (!levels.length) throw new Error('DDS without data');
  return { format, width, height, levels };
}

/** RGB565 to RGB888. */
function rgb565(c: number): [number, number, number] {
  const r = (c >> 11) & 31;
  const g = (c >> 5) & 63;
  const b = c & 31;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

/** Decode a BC1, BC2 or BC3 level into RGBA (4 bytes per pixel), for a GPU without S3TC. */
export function decodeBc(format: DdsFormat, level: DdsLevel): Uint8Array {
  if (format !== 'BC1' && format !== 'BC2' && format !== 'BC3')
    throw new Error(`${format} is not decoded in software`);
  const { width, height, data } = level;
  const out = new Uint8Array(width * height * 4);
  const bw = Math.max(1, Math.ceil(width / 4));
  const bh = Math.max(1, Math.ceil(height / 4));
  const stride = blockBytes(format);
  const colours = new Uint8Array(16);
  const alphas = new Uint8Array(16);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      const base = (by * bw + bx) * stride;
      const colourAt = format === 'BC1' ? base : base + 8;
      const c0 = data[colourAt]! | (data[colourAt + 1]! << 8);
      const c1 = data[colourAt + 2]! | (data[colourAt + 3]! << 8);
      const p0 = rgb565(c0);
      const p1 = rgb565(c1);
      const four = format !== 'BC1' || c0 > c1;
      for (let k = 0; k < 3; k++) {
        colours[k] = p0[k]!;
        colours[4 + k] = p1[k]!;
        colours[8 + k] = four ? (2 * p0[k]! + p1[k]!) / 3 : (p0[k]! + p1[k]!) / 2;
        colours[12 + k] = four ? (p0[k]! + 2 * p1[k]!) / 3 : 0;
      }
      colours[3] = colours[7] = colours[11] = 255;
      colours[15] = four ? 255 : 0;
      // alpha: BC2 explicit 4 bits, BC3 interpolated
      if (format === 'BC2') {
        for (let i = 0; i < 16; i++) {
          const nib = (data[base + (i >> 1)]! >> ((i & 1) * 4)) & 15;
          alphas[i] = nib * 17;
        }
      } else if (format === 'BC3') {
        const a0 = data[base]!;
        const a1 = data[base + 1]!;
        const table = [a0, a1];
        if (a0 > a1) for (let i = 1; i < 7; i++) table.push(((7 - i) * a0 + i * a1) / 7);
        else {
          for (let i = 1; i < 5; i++) table.push(((5 - i) * a0 + i * a1) / 5);
          table.push(0, 255);
        }
        let bits = 0;
        for (let i = 0; i < 6; i++) bits += data[base + 2 + i]! * 2 ** (8 * i);
        for (let i = 0; i < 16; i++) alphas[i] = table[Math.floor(bits / 2 ** (3 * i)) & 7]!;
      }
      const indices =
        data[colourAt + 4]! |
        (data[colourAt + 5]! << 8) |
        (data[colourAt + 6]! << 16) |
        (data[colourAt + 7]! << 24);
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i & 3);
        const y = by * 4 + (i >> 2);
        if (x >= width || y >= height) continue;
        const sel = (indices >>> (2 * i)) & 3;
        const o = (y * width + x) * 4;
        out[o] = colours[sel * 4]!;
        out[o + 1] = colours[sel * 4 + 1]!;
        out[o + 2] = colours[sel * 4 + 2]!;
        out[o + 3] = format === 'BC1' ? colours[sel * 4 + 3]! : alphas[i]!;
      }
    }
  return out;
}
