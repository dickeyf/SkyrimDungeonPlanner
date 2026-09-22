/**
 * Little-endian binary writer with a growable buffer.
 *
 * Used to write a plugin back (R14c): opaque records are copied verbatim, only
 * decoded records and group sizes are regenerated.
 */
export class BinaryWriter {
  private buf: ArrayBuffer;
  private view: DataView;
  private bytes: Uint8Array;
  private pos = 0;

  constructor(initialCapacity = 1024) {
    this.buf = new ArrayBuffer(Math.max(16, initialCapacity));
    this.view = new DataView(this.buf);
    this.bytes = new Uint8Array(this.buf);
  }

  get position(): number {
    return this.pos;
  }

  /**
   * Reserve `count` bytes and return their offset. May replace `view`/`bytes`, so callers
   * must call this before touching `this.view`.
   */
  private ensure(count: number): number {
    const needed = this.pos + count;
    if (needed > this.buf.byteLength) {
      let cap = this.buf.byteLength * 2;
      while (cap < needed) cap *= 2;
      const next = new ArrayBuffer(cap);
      new Uint8Array(next).set(this.bytes.subarray(0, this.pos));
      this.buf = next;
      this.view = new DataView(next);
      this.bytes = new Uint8Array(next);
    }
    const at = this.pos;
    this.pos += count;
    return at;
  }

  u8(v: number): this {
    const at = this.ensure(1);
    this.view.setUint8(at, v);
    return this;
  }

  u16(v: number): this {
    const at = this.ensure(2);
    this.view.setUint16(at, v, true);
    return this;
  }

  i16(v: number): this {
    const at = this.ensure(2);
    this.view.setInt16(at, v, true);
    return this;
  }

  u32(v: number): this {
    const at = this.ensure(4);
    this.view.setUint32(at, v, true);
    return this;
  }

  i32(v: number): this {
    const at = this.ensure(4);
    this.view.setInt32(at, v, true);
    return this;
  }

  u64(v: bigint): this {
    const at = this.ensure(8);
    this.view.setBigUint64(at, v, true);
    return this;
  }

  f32(v: number): this {
    const at = this.ensure(4);
    this.view.setFloat32(at, v, true);
    return this;
  }

  raw(data: Uint8Array): this {
    const at = this.ensure(data.byteLength);
    this.bytes.set(data, at);
    return this;
  }

  /** Four-character ASCII signature. */
  tag(t: string): this {
    if (t.length !== 4) throw new RangeError(`tag "${t}" must be 4 characters`);
    return this.raw(latin1Bytes(t));
  }

  /** NUL-terminated latin1 string. */
  zString(s: string): this {
    return this.raw(latin1Bytes(s)).u8(0);
  }

  /** Overwrite a u32 at an already-emitted position (e.g. a group size known afterwards). */
  patchU32(position: number, v: number): void {
    if (position + 4 > this.pos) throw new RangeError(`patchU32(${position}) beyond emitted data`);
    this.view.setUint32(position, v, true);
  }

  /** Copy of the emitted bytes (exact length). */
  toUint8Array(): Uint8Array {
    return this.bytes.slice(0, this.pos);
  }
}

export function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0xff) throw new RangeError(`non-latin1 character: U+${c.toString(16)}`);
    out[i] = c;
  }
  return out;
}
