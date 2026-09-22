/**
 * In-memory implementation of the handle subset used by `paths.ts`, for unit tests and
 * for driving the editor without a real disk.
 */
import type { FsDir, FsFile, FsWritable } from './paths';

export class FakeFile implements FsFile {
  readonly kind = 'file' as const;
  content: Uint8Array;
  lastModified = 0;

  constructor(
    readonly name: string,
    content: Uint8Array | string = new Uint8Array(),
  ) {
    this.content = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  }

  async getFile(): Promise<File> {
    return new File([this.content.slice().buffer as ArrayBuffer], this.name, {
      lastModified: this.lastModified,
    });
  }

  async createWritable(options?: { keepExistingData?: boolean }): Promise<FsWritable> {
    const chunks: Uint8Array[] = options?.keepExistingData ? [this.content.slice()] : [];
    let open = true;
    return {
      write: async (data) => {
        if (!open) throw new Error('stream closed');
        chunks.push(await toBytes(data));
      },
      close: async () => {
        if (!open) throw new Error('stream closed');
        open = false;
        const size = chunks.reduce((n, c) => n + c.byteLength, 0);
        const out = new Uint8Array(size);
        let at = 0;
        for (const c of chunks) {
          out.set(c, at);
          at += c.byteLength;
        }
        this.content = out;
        this.lastModified += 1;
      },
      abort: async () => {
        open = false; // original content untouched
      },
    };
  }
}

export class FakeDir implements FsDir {
  readonly kind = 'directory' as const;
  readonly children = new Map<string, FakeDir | FakeFile>();

  constructor(
    readonly name: string,
    entries: Record<string, FakeDir | FakeFile | Uint8Array | string> = {},
  ) {
    for (const [childName, value] of Object.entries(entries)) {
      const child =
        value instanceof FakeDir || value instanceof FakeFile
          ? value
          : new FakeFile(childName, value);
      this.children.set(child.name, child);
    }
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsDir> {
    const found = this.children.get(name);
    if (found instanceof FakeDir) return found;
    if (found === undefined && options?.create) {
      const dir = new FakeDir(name);
      this.children.set(name, dir);
      return dir;
    }
    throw new DOMException(`no directory "${name}"`, found ? 'TypeMismatchError' : 'NotFoundError');
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFile> {
    const found = this.children.get(name);
    if (found instanceof FakeFile) return found;
    if (found === undefined && options?.create) {
      const file = new FakeFile(name);
      this.children.set(name, file);
      return file;
    }
    throw new DOMException(`no file "${name}"`, found ? 'TypeMismatchError' : 'NotFoundError');
  }

  async *values(): AsyncIterable<FsDir | FsFile> {
    yield* this.children.values();
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.children.delete(name)) throw new DOMException(`no entry "${name}"`, 'NotFoundError');
  }
}

async function toBytes(data: BufferSource | Blob | string): Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
  return new Uint8Array(data).slice();
}
