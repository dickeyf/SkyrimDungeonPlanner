/**
 * Skyrim SE BSA (version 105) reader. Port of tools/bsa.py.
 *
 * The folder and file tables are read once (one ranged read); each file is then fetched by
 * its own ranged read and, when compressed, inflated from its LZ4 frame.
 *
 * Reference: https://en.uesp.net/wiki/Skyrim_Mod:Archive_File_Format
 */
import { BinaryReader } from '../../binary/BinaryReader';
import { lz4DecompressFrame } from '../../compress/lz4';
import type { RangeSource } from './RangeSource';

export const BSA_VERSION_SSE = 105;
const HEADER_SIZE = 36;
const FOLDER_RECORD_SIZE = 24;
const FILE_RECORD_SIZE = 16;

export const ArchiveFlags = {
  hasFolderNames: 0x001,
  hasFileNames: 0x002,
  compressedByDefault: 0x004,
  embedFileNames: 0x100,
} as const;

const SIZE_COMPRESSION_TOGGLE = 0x40000000;
const SIZE_MASK = 0x3fffffff;

export interface BsaEntry {
  /** Lower-case path with forward slashes, e.g. `meshes/dungeons/imperial/x.nif`. */
  path: string;
  offset: number;
  /** Size on disk, including the embedded name and the original-size field. */
  size: number;
  compressed: boolean;
}

export interface BsaHeader {
  version: number;
  flags: number;
  folderCount: number;
  fileCount: number;
  totalFolderNameLength: number;
  totalFileNameLength: number;
}

export function normalizeArchivePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '');
}

export class BsaArchive {
  private constructor(
    private readonly source: RangeSource,
    readonly header: BsaHeader,
    readonly entries: ReadonlyMap<string, BsaEntry>,
  ) {}

  static async open(source: RangeSource): Promise<BsaArchive> {
    const head = new BinaryReader((await source.read(0, HEADER_SIZE)).buffer);
    const magic = head.fixedString(4);
    const version = head.u32();
    const folderOffset = head.u32();
    const flags = head.u32();
    const folderCount = head.u32();
    const fileCount = head.u32();
    const totalFolderNameLength = head.u32();
    const totalFileNameLength = head.u32();
    if (magic !== 'BSA') throw new Error('not a BSA archive');
    if (version !== BSA_VERSION_SSE)
      throw new Error(`BSA version ${version}, expected ${BSA_VERSION_SSE}`);
    if (!(flags & ArchiveFlags.hasFolderNames) || !(flags & ArchiveFlags.hasFileNames)) {
      throw new Error('archive without folder/file names is unsupported');
    }

    // Folder records, then per folder: bstring name + file records, then the file name block.
    const tablesSize =
      folderCount * FOLDER_RECORD_SIZE +
      (totalFolderNameLength + folderCount) +
      fileCount * FILE_RECORD_SIZE +
      totalFileNameLength;
    const tables = await source.read(folderOffset, tablesSize);
    const r = new BinaryReader(tables.buffer, tables.byteOffset, tables.byteLength);

    const folders: { count: number }[] = [];
    for (let i = 0; i < folderCount; i++) {
      r.u64(); // name hash
      const count = r.u32();
      r.u32(); // padding
      r.u64(); // offset of the file record block (+ totalFileNameLength); read sequentially instead
      folders.push({ count });
    }

    const defaultCompressed = (flags & ArchiveFlags.compressedByDefault) !== 0;
    const perFolder: {
      name: string;
      records: { offset: number; size: number; compressed: boolean }[];
    }[] = [];
    for (const folder of folders) {
      const name = r.bString(true);
      const records = [];
      for (let i = 0; i < folder.count; i++) {
        r.u64(); // file hash
        const size = r.u32();
        const offset = r.u32();
        const toggled = (size & SIZE_COMPRESSION_TOGGLE) !== 0;
        records.push({ offset, size: size & SIZE_MASK, compressed: defaultCompressed !== toggled });
      }
      perFolder.push({ name, records });
    }

    const entries = new Map<string, BsaEntry>();
    for (const folder of perFolder) {
      const prefix = normalizeArchivePath(folder.name);
      for (const record of folder.records) {
        const fileName = r.zString().toLowerCase();
        const path = prefix === '' ? fileName : `${prefix}/${fileName}`;
        entries.set(path, { path, ...record });
      }
    }
    if (entries.size !== fileCount) {
      throw new Error(`BSA tables list ${entries.size} files, header says ${fileCount}`);
    }

    return new BsaArchive(
      source,
      { version, flags, folderCount, fileCount, totalFolderNameLength, totalFileNameLength },
      entries,
    );
  }

  has(path: string): boolean {
    return this.entries.has(normalizeArchivePath(path));
  }

  get(path: string): BsaEntry | undefined {
    return this.entries.get(normalizeArchivePath(path));
  }

  /** Entries whose path starts with `prefix` and ends with `suffix` (both case-insensitive). */
  find(prefix = '', suffix = ''): BsaEntry[] {
    const p = normalizeArchivePath(prefix);
    const s = suffix.toLowerCase();
    const out: BsaEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.path.startsWith(p) && entry.path.endsWith(s)) out.push(entry);
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** The file's content, decompressed. */
  async read(pathOrEntry: string | BsaEntry): Promise<Uint8Array> {
    const entry = typeof pathOrEntry === 'string' ? this.get(pathOrEntry) : pathOrEntry;
    if (!entry) throw new Error(`not in archive: ${pathOrEntry}`);
    const raw = await this.source.read(entry.offset, entry.size);
    let pos = 0;
    if (this.header.flags & ArchiveFlags.embedFileNames) pos = 1 + raw[0]!; // bstring, no NUL
    if (!entry.compressed) return raw.subarray(pos);
    const originalSize = new DataView(raw.buffer, raw.byteOffset + pos, 4).getUint32(0, true);
    const data = lz4DecompressFrame(raw.subarray(pos + 4), originalSize);
    if (data.length !== originalSize) {
      throw new Error(
        `${entry.path}: decompressed ${data.length} bytes, header says ${originalSize}`,
      );
    }
    return data;
  }
}
