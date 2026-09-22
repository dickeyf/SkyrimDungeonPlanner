import { describe, expect, it } from 'vitest';
import {
  LZ4_FRAME_B64,
  LZ4_FRAME_CHECKSUMS_B64,
  LZ4_PLAIN_B64,
  fromBase64,
} from '../testdata/fixtures';
import { lz4DecompressBlock, lz4DecompressFrame } from './lz4';

const plain = fromBase64(LZ4_PLAIN_B64);

describe('lz4DecompressFrame', () => {
  it('inflates a frame with a stored content size', () => {
    expect(lz4DecompressFrame(fromBase64(LZ4_FRAME_B64))).toEqual(plain);
  });

  it('inflates a frame with block and content checksums, given the expected size', () => {
    expect(lz4DecompressFrame(fromBase64(LZ4_FRAME_CHECKSUMS_B64), plain.length)).toEqual(plain);
  });

  it('inflates a frame without any size hint by growing the buffer', () => {
    expect(lz4DecompressFrame(fromBase64(LZ4_FRAME_CHECKSUMS_B64))).toEqual(plain);
  });

  it('rejects a bad magic and a truncated frame', () => {
    expect(() => lz4DecompressFrame(new Uint8Array([1, 2, 3, 4, 5, 6, 7]))).toThrow('magic');
    const frame = fromBase64(LZ4_FRAME_B64);
    expect(() => lz4DecompressFrame(frame.subarray(0, frame.length - 12))).toThrow(RangeError);
  });
});

describe('lz4DecompressBlock', () => {
  it('decodes literals and an overlapping match', () => {
    // token 0x24: 2 literals, match length 4+4 = 8; offset 1 -> repeats the last byte
    const block = new Uint8Array([0x24, 0x41, 0x42, 0x01, 0x00, 0x10, 0x43]);
    const out = new Uint8Array(16);
    const n = lz4DecompressBlock(block, out);
    expect(new TextDecoder().decode(out.subarray(0, n))).toBe('ABBBBBBBBBC');
  });

  it('rejects an invalid offset', () => {
    const block = new Uint8Array([0x14, 0x41, 0x05, 0x00]);
    expect(() => lz4DecompressBlock(block, new Uint8Array(16))).toThrow('offset');
  });
});
