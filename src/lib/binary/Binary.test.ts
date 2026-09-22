import { describe, expect, it } from 'vitest';
import { BinaryReader } from './BinaryReader';
import { BinaryWriter } from './BinaryWriter';

describe('BinaryWriter -> BinaryReader', () => {
  it('round-trips the primitive types in little-endian', () => {
    const w = new BinaryWriter(4)
      .tag('TES4')
      .u8(0xab)
      .u16(0x1234)
      .u32(0xdeadbeef)
      .i32(-7)
      .f32(1.5)
      .u64(0x1_0000_0000n)
      .zString('ImpHall01');
    const bytes = w.toUint8Array();
    expect(bytes.length).toBe(4 + 1 + 2 + 4 + 4 + 4 + 8 + 10);

    const r = new BinaryReader(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(r.tag()).toBe('TES4');
    expect(r.u8()).toBe(0xab);
    expect(r.u16()).toBe(0x1234);
    expect(r.u32()).toBe(0xdeadbeef);
    expect(r.i32()).toBe(-7);
    expect(r.f32()).toBe(1.5);
    expect(r.u64()).toBe(0x1_0000_0000n);
    expect(r.zString()).toBe('ImpHall01');
    expect(r.eof).toBe(true);
  });

  it('reads fixed-length strings and bStrings', () => {
    const bytes = new Uint8Array([0x41, 0x42, 0x00, 0x00, 0x03, 0x61, 0x62, 0x00]);
    const r = new BinaryReader(bytes.buffer);
    expect(r.fixedString(4)).toBe('AB');
    expect(r.bString(true)).toBe('ab');
    expect(r.eof).toBe(true);
  });

  it('refuses to read past the end', () => {
    const r = new BinaryReader(new Uint8Array([1, 2]).buffer);
    r.u8();
    expect(() => r.u32()).toThrow(RangeError);
  });

  it('patches a size that is only known afterwards', () => {
    const w = new BinaryWriter();
    w.tag('GRUP');
    const sizeAt = w.position;
    w.u32(0);
    w.raw(new Uint8Array(12));
    w.patchU32(sizeAt, w.position);
    const r = new BinaryReader(w.toUint8Array().buffer);
    r.tag();
    expect(r.u32()).toBe(20);
  });
});
