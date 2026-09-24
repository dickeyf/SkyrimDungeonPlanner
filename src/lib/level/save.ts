/**
 * Writing the working plugin in place (step 15, V5, D47).
 *
 * The save is refused when the file changed on disk since it was loaded (the Creation Kit
 * saved it meanwhile), so edits never overwrite work done elsewhere. Before writing, the
 * current file is copied into a backup folder next to it, with a timestamp; the `.bak`
 * extension keeps the game and the CK from loading the copies. The plugin is then replaced
 * atomically and read back to check the bytes on disk.
 */
import { readAll, writeFileAtomic, type FsDir } from '../fs/paths';

export const BACKUP_FOLDER = 'DungeonMakerBackups';

/** What the file looked like when it was loaded. */
export interface FileStamp {
  size: number;
  lastModified: number;
}

export async function stampOf(dir: FsDir, name: string): Promise<FileStamp> {
  const file = await (await dir.getFileHandle(name)).getFile();
  return { size: file.size, lastModified: file.lastModified };
}

/** `MyDungeon.esp` saved on 2026-09-24 at 14:05:09 -> `MyDungeon.20260924-140509.esp.bak`. */
export function backupName(name: string, when: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${when.getFullYear()}${p(when.getMonth() + 1)}${p(when.getDate())}-` +
    `${p(when.getHours())}${p(when.getMinutes())}${p(when.getSeconds())}`;
  const dot = name.lastIndexOf('.');
  const base = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? '' : name.slice(dot);
  return `${base}.${stamp}${ext}.bak`;
}

export interface SaveResult {
  backup: string;
  stamp: FileStamp;
}

export async function savePlugin(options: {
  dir: FsDir;
  name: string;
  loaded: FileStamp;
  bytes: Uint8Array;
  now?: Date;
}): Promise<SaveResult> {
  const { dir, name, bytes } = options;
  const handle = await dir.getFileHandle(name);
  const current = await handle.getFile();
  if (
    current.size !== options.loaded.size ||
    current.lastModified !== options.loaded.lastModified
  ) {
    throw new Error(
      `${name} changed on disk since it was loaded (saved by the Creation Kit?). ` +
        'Reload the plugin; unsaved edits are kept only in this page until then.',
    );
  }
  const backups = await dir.getDirectoryHandle(BACKUP_FOLDER, { create: true });
  const backup = backupName(name, options.now ?? new Date());
  await writeFileAtomic(backups, backup, await readAll(handle));
  await writeFileAtomic(dir, name, bytes);

  const written = await readAll(await dir.getFileHandle(name));
  if (written.byteLength !== bytes.byteLength || written.some((b, i) => b !== bytes[i])) {
    throw new Error(`${name} does not read back as written; restore ${BACKUP_FOLDER}/${backup}`);
  }
  return { backup: `${BACKUP_FOLDER}/${backup}`, stamp: await stampOf(dir, name) };
}
