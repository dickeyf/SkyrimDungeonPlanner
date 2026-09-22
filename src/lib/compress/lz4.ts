/**
 * LZ4 decompression: block format and frame format (as used by Skyrim SE archives).
 *
 * Frame: magic 0x184D2204, FLG, BD, [content size u64], [dict id u32], header checksum,
 * then blocks (u32 size, bit 31 = stored uncompressed), optional block checksums, an end
 * mark (size 0) and an optional content checksum. Checksums are not verified.
 *
 * Reference: https://github.com/lz4/lz4/blob/dev/doc/lz4_Frame_format.md
 */

export const LZ4_FRAME_MAGIC = 0x184d2204;

/** Decompress one LZ4 block into `dst` starting at `dstOffset`; returns the bytes written. */
export function lz4DecompressBlock(
  src: Uint8Array,
  dst: Uint8Array,
  dstOffset = 0,
  srcStart = 0,
  srcEnd = src.length,
): number {
  let i = srcStart;
  let o = dstOffset;
  while (i < srcEnd) {
    const token = src[i++]!;
    let literals = token >>> 4;
    if (literals === 15) {
      let b: number;
      do {
        b = src[i++]!;
        literals += b;
      } while (b === 255);
    }
    if (o + literals > dst.length) throw new RangeError('LZ4: literals exceed output buffer');
    dst.set(src.subarray(i, i + literals), o);
    i += literals;
    o += literals;
    if (i >= srcEnd) break; // last sequence has no match

    const offset = src[i]! | (src[i + 1]! << 8);
    i += 2;
    if (offset === 0 || offset > o - dstOffset) throw new RangeError('LZ4: invalid match offset');
    let matchLength = (token & 0x0f) + 4;
    if ((token & 0x0f) === 15) {
      let b: number;
      do {
        b = src[i++]!;
        matchLength += b;
      } while (b === 255);
    }
    if (o + matchLength > dst.length) throw new RangeError('LZ4: match exceeds output buffer');
    let from = o - offset;
    if (offset >= matchLength) {
      dst.copyWithin(o, from, from + matchLength);
      o += matchLength;
    } else {
      for (let k = 0; k < matchLength; k++) dst[o++] = dst[from++]!;
    }
  }
  return o - dstOffset;
}

/**
 * Decompress an LZ4 frame. `expectedSize` (known from the archive) avoids growing buffers;
 * otherwise the frame's content size is used, or the buffer grows as needed.
 */
export function lz4DecompressFrame(src: Uint8Array, expectedSize?: number): Uint8Array {
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  if (src.length < 7 || view.getUint32(0, true) !== LZ4_FRAME_MAGIC) {
    throw new Error('LZ4: not a frame (bad magic)');
  }
  const flg = src[4]!;
  const version = flg >>> 6;
  if (version !== 1) throw new Error(`LZ4: unsupported frame version ${version}`);
  const blockChecksum = (flg & 0x10) !== 0;
  const hasContentSize = (flg & 0x08) !== 0;
  const hasDictId = (flg & 0x01) !== 0;
  let pos = 6; // magic + FLG + BD
  let contentSize: number | undefined;
  if (hasContentSize) {
    contentSize = Number(view.getBigUint64(pos, true));
    pos += 8;
  }
  if (hasDictId) pos += 4;
  pos += 1; // header checksum

  let dst: Uint8Array = new Uint8Array(
    expectedSize ?? contentSize ?? Math.max(1024, src.length * 4),
  );
  let written = 0;
  for (;;) {
    if (pos + 4 > src.length) throw new RangeError('LZ4: truncated frame');
    const raw = view.getUint32(pos, true);
    pos += 4;
    if (raw === 0) break; // end mark
    const stored = (raw & 0x80000000) !== 0;
    const size = raw & 0x7fffffff;
    if (pos + size > src.length) throw new RangeError('LZ4: truncated block');
    if (stored) {
      dst = ensure(dst, written + size);
      dst.set(src.subarray(pos, pos + size), written);
      written += size;
    } else {
      // A block never expands beyond 4 MB (the largest block size); grow if unknown.
      if (expectedSize === undefined && contentSize === undefined)
        dst = ensure(dst, written + 4 * 1024 * 1024);
      written += lz4DecompressBlock(src, dst, written, pos, pos + size);
    }
    pos += size;
    if (blockChecksum) pos += 4;
  }
  return written === dst.length ? dst : dst.subarray(0, written);
}

function ensure(buf: Uint8Array, needed: number): Uint8Array {
  if (needed <= buf.length) return buf;
  let cap = buf.length * 2;
  while (cap < needed) cap *= 2;
  const next = new Uint8Array(cap);
  next.set(buf);
  return next;
}
