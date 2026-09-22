/** Permission helpers for restored handles. */

export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export function queryAccess(
  handle: FileSystemHandle,
  mode: FileSystemPermissionMode = 'readwrite',
): Promise<PermissionState> {
  return handle.queryPermission({ mode });
}

/**
 * Make sure `handle` is usable. A restored handle usually comes back as `prompt`;
 * `requestPermission()` then needs a user gesture (button click), so call this from one.
 */
export async function ensureAccess(
  handle: FileSystemHandle,
  mode: FileSystemPermissionMode = 'readwrite',
): Promise<boolean> {
  if ((await handle.queryPermission({ mode })) === 'granted') return true;
  return (await handle.requestPermission({ mode })) === 'granted';
}

/** Open the directory picker for the game folder (must run inside a user gesture). */
export function pickDirectory(
  id: string,
  mode: FileSystemPermissionMode = 'readwrite',
): Promise<FileSystemDirectoryHandle> {
  return window.showDirectoryPicker({ id, mode });
}
