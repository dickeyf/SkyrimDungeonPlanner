/** Random-access byte source: a file handle in the browser, a buffer in tests. */
import type { FsFile } from '../../fs/paths';

export interface RangeSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export class BufferRangeSource implements RangeSource {
  constructor(private readonly bytes: Uint8Array) {}

  get size(): number {
    return this.bytes.length;
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0 || offset + length > this.bytes.length) {
      throw new RangeError(
        `range [${offset}, ${offset + length}) outside ${this.bytes.length} bytes`,
      );
    }
    return this.bytes.subarray(offset, offset + length);
  }
}

/** Ranged reads through `File.slice()`, so a 1 GB archive is never loaded whole. */
export class FileRangeSource implements RangeSource {
  private constructor(
    private readonly file: File,
    readonly name: string,
  ) {}

  static async open(handle: FsFile): Promise<FileRangeSource> {
    return new FileRangeSource(await handle.getFile(), handle.name);
  }

  get size(): number {
    return this.file.size;
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0 || offset + length > this.file.size) {
      throw new RangeError(
        `range [${offset}, ${offset + length}) outside ${this.name} (${this.file.size} bytes)`,
      );
    }
    return new Uint8Array(await this.file.slice(offset, offset + length).arrayBuffer());
  }
}
