/**
 * Path resolution, ranged reads and atomic writes over directory/file handles.
 *
 * The handle types are structural subsets of the File System Access API so that the
 * logic runs unchanged against in-memory fakes in unit tests (Node has no such API).
 */

export interface FsWritable {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

export interface FsFile {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<FsWritable>;
}

export interface FsDir {
  readonly kind: 'directory';
  readonly name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsDir>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFile>;
  values(): AsyncIterable<FsDir | FsFile>;
  removeEntry?(name: string, options?: { recursive?: boolean }): Promise<void>;
}

export type FsEntry = FsDir | FsFile;

export interface FileInfo {
  name: string;
  size: number;
  lastModified: number;
  handle: FsFile;
}

/** Split a relative path on `/` or `\`, dropping empty and `.` parts; `..` is refused. */
export function splitPath(path: string): string[] {
  const parts = path.split(/[\\/]+/).filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..')) {
    throw new Error(`path may not contain "..": ${path}`);
  }
  return parts;
}

/**
 * Find a child by name, case-insensitively. The API itself is case-sensitive on some
 * platforms while plugin and archive paths come in arbitrary case.
 */
export async function findEntry(dir: FsDir, name: string): Promise<FsEntry | undefined> {
  const wanted = name.toLowerCase();
  for await (const entry of dir.values()) {
    if (entry.name.toLowerCase() === wanted) return entry;
  }
  return undefined;
}

export async function resolveDir(
  root: FsDir,
  path: string,
  options: { create?: boolean } = {},
): Promise<FsDir> {
  let dir = root;
  for (const part of splitPath(path)) {
    const found = await findEntry(dir, part);
    if (found?.kind === 'directory') {
      dir = found;
    } else if (found === undefined && options.create) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    } else {
      throw new Error(`directory not found: ${path} (at "${part}")`);
    }
  }
  return dir;
}

export async function resolveFile(
  root: FsDir,
  path: string,
  options: { create?: boolean } = {},
): Promise<FsFile> {
  const parts = splitPath(path);
  const fileName = parts.pop();
  if (fileName === undefined) throw new Error('empty file path');
  const dir = await resolveDir(root, parts.join('/'), options);
  const found = await findEntry(dir, fileName);
  if (found?.kind === 'file') return found;
  if (found === undefined && options.create) return dir.getFileHandle(fileName, { create: true });
  throw new Error(`file not found: ${path}`);
}

/** Like {@link resolveFile} but returns undefined instead of throwing when absent. */
export async function tryResolveFile(root: FsDir, path: string): Promise<FsFile | undefined> {
  try {
    return await resolveFile(root, path);
  } catch {
    return undefined;
  }
}

export async function listFiles(
  dir: FsDir,
  options: { suffix?: string } = {},
): Promise<FileInfo[]> {
  const suffix = options.suffix?.toLowerCase();
  const out: FileInfo[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file') continue;
    if (suffix !== undefined && !entry.name.toLowerCase().endsWith(suffix)) continue;
    const file = await entry.getFile();
    out.push({ name: entry.name, size: file.size, lastModified: file.lastModified, handle: entry });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Read `length` bytes at `offset` without loading the rest of the file. */
export async function readRange(
  handle: FsFile,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  const file = await handle.getFile();
  if (offset < 0 || offset + length > file.size) {
    throw new RangeError(
      `range [${offset}, ${offset + length}) outside file of ${file.size} bytes`,
    );
  }
  return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
}

export async function readAll(handle: FsFile): Promise<Uint8Array> {
  const file = await handle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

/**
 * Replace a file's content. `createWritable()` writes to a temporary file and swaps it in
 * on `close()`, so a failure before `close()` leaves the original untouched.
 */
export async function writeFileAtomic(
  dir: FsDir,
  name: string,
  data: Uint8Array | string,
): Promise<FsFile> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable({ keepExistingData: false });
  try {
    await writable.write(typeof data === 'string' ? data : (data.slice().buffer as ArrayBuffer));
  } catch (error) {
    await writable.abort?.();
    throw error;
  }
  await writable.close();
  return handle;
}
