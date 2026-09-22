/**
 * Little-endian binary reader over an ArrayBuffer (or a slice of one).
 *
 * Shared foundation for the ESP / BSA / NIF parsers (D45). No framework dependency.
 * All Bethesda formats are little-endian; strings are Windows-1252, approximated here
 * by latin1 (good enough for EditorIDs and model paths).
 */
export class BinaryReader {
  readonly view: DataView;
  private readonly bytes: Uint8Array;
  private pos = 0;

  constructor(buffer: ArrayBufferLike, byteOffset = 0, byteLength?: number) {
    this.view = new DataView(buffer, byteOffset, byteLength);
    this.bytes = new Uint8Array(buffer, byteOffset, byteLength);
  }

  get position(): number {
    return this.pos;
  }

  get length(): number {
    return this.view.byteLength;
  }

  get remaining(): number {
    return this.view.byteLength - this.pos;
  }

  get eof(): boolean {
    return this.pos >= this.view.byteLength;
  }

  seek(position: number): void {
    if (position < 0 || position > this.view.byteLength) {
      throw new RangeError(`seek(${position}) outside [0, ${this.view.byteLength}]`);
    }
    this.pos = position;
  }

  skip(count: number): void {
    this.seek(this.pos + count);
  }

  private need(count: number): number {
    if (this.pos + count > this.view.byteLength) {
      throw new RangeError(
        `reading ${count} byte(s) at ${this.pos} exceeds end (${this.view.byteLength})`,
      );
    }
    const at = this.pos;
    this.pos += count;
    return at;
  }

  u8(): number {
    return this.view.getUint8(this.need(1));
  }

  i8(): number {
    return this.view.getInt8(this.need(1));
  }

  u16(): number {
    return this.view.getUint16(this.need(2), true);
  }

  i16(): number {
    return this.view.getInt16(this.need(2), true);
  }

  u32(): number {
    return this.view.getUint32(this.need(4), true);
  }

  i32(): number {
    return this.view.getInt32(this.need(4), true);
  }

  u64(): bigint {
    return this.view.getBigUint64(this.need(8), true);
  }

  f32(): number {
    return this.view.getFloat32(this.need(4), true);
  }

  /** `count` raw bytes as a view (no copy) on the underlying buffer. */
  bytesView(count: number): Uint8Array {
    const at = this.need(count);
    return this.bytes.subarray(at, at + count);
  }

  /** `count` raw bytes, copied. */
  bytesCopy(count: number): Uint8Array {
    return this.bytesView(count).slice();
  }

  /** Four-character ASCII signature (e.g. `TES4`, `GRUP`, `STAT`). */
  tag(): string {
    return latin1(this.bytesView(4));
  }

  /** Fixed-length string, truncated at the first NUL. */
  fixedString(count: number): string {
    const raw = this.bytesView(count);
    const nul = raw.indexOf(0);
    return latin1(nul === -1 ? raw : raw.subarray(0, nul));
  }

  /** NUL-terminated string (the NUL is consumed). */
  zString(): string {
    const start = this.pos;
    let end = start;
    while (end < this.view.byteLength && this.bytes[end] !== 0) end++;
    if (end >= this.view.byteLength) throw new RangeError(`unterminated zString at ${start}`);
    this.pos = end + 1;
    return latin1(this.bytes.subarray(start, end));
  }

  /** String prefixed by a one-byte length (BSA folder names carry a trailing NUL). */
  bString(withNul = false): string {
    const len = this.u8();
    const raw = this.bytesView(len);
    return latin1(withNul && len > 0 && raw[len - 1] === 0 ? raw.subarray(0, len - 1) : raw);
  }

  /** String prefixed by a u32 length, no NUL (NIF SizedString). */
  sizedString(): string {
    const len = this.u32();
    return latin1(this.bytesView(len));
  }
}

const latin1Decoder = new TextDecoder('latin1');

export function latin1(bytes: Uint8Array): string {
  return latin1Decoder.decode(bytes);
}
