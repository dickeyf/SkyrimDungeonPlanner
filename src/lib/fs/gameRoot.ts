/**
 * Recognize the user's game folder (D42): either the game root (containing `Data/`) or
 * the `Data` folder itself, identified by the presence of `Skyrim.esm`.
 */
import { findEntry, listFiles, type FileInfo, type FsDir } from './paths';

export interface GameFolders {
  /** What the user picked. */
  picked: FsDir;
  /** The `Data` folder, where plugins and archives live. */
  data: FsDir;
  pickedIs: 'root' | 'data';
}

const MASTER = 'Skyrim.esm';

export async function identifyGameFolder(picked: FsDir): Promise<GameFolders | null> {
  if ((await findEntry(picked, MASTER))?.kind === 'file') {
    return { picked, data: picked, pickedIs: 'data' };
  }
  const data = await findEntry(picked, 'Data');
  if (data?.kind === 'directory' && (await findEntry(data, MASTER))?.kind === 'file') {
    return { picked, data, pickedIs: 'root' };
  }
  return null;
}

export function listArchives(data: FsDir): Promise<FileInfo[]> {
  return listFiles(data, { suffix: '.bsa' });
}

export function listPlugins(data: FsDir): Promise<FileInfo[]> {
  return listFiles(data, { suffix: '.esp' });
}
