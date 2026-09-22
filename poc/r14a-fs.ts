/**
 * R14a proof of concept: pick the game folder, persist the handle, restore it after a
 * reload, list archives, do a ranged read, and write a file in place.
 */
import { BinaryReader } from '$lib/binary/BinaryReader';
import {
  HANDLE_KEYS,
  deleteHandle,
  ensureAccess,
  identifyGameFolder,
  listArchives,
  loadHandle,
  pickDirectory,
  queryAccess,
  readAll,
  readRange,
  resolveFile,
  saveHandle,
  supportsFileSystemAccess,
  writeFileAtomic,
  type GameFolders,
} from '$lib/fs';

const TEST_FILE = 'skyrim-dungeon-planner-r14a.txt';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $<HTMLPreElement>('log');

function log(message: string, cls = ''): void {
  const line = document.createElement('div');
  line.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  if (cls) line.className = cls;
  logEl.prepend(line);
}

let game: GameFolders | null = null;
let savedHandle: FileSystemDirectoryHandle | undefined;

function setStatus(text: string, cls = ''): void {
  const el = $('folder-status');
  el.textContent = text;
  el.className = cls;
}

function setEnabled(ready: boolean): void {
  for (const id of ['list', 'header', 'write', 'verify', 'remove']) {
    $<HTMLButtonElement>(id).disabled = !ready;
  }
}

async function activate(
  handle: FileSystemDirectoryHandle,
  source: 'picked' | 'restored',
): Promise<void> {
  const found = await identifyGameFolder(handle);
  if (!found) {
    setStatus(
      `"${handle.name}" is not a Skyrim folder (no Skyrim.esm in it or in its Data/).`,
      'err',
    );
    setEnabled(false);
    return;
  }
  game = found;
  setStatus(
    `${source === 'restored' ? 'Restored' : 'Picked'}: "${handle.name}" (${found.pickedIs === 'root' ? 'game root' : 'Data folder'}), access granted.`,
    'ok',
  );
  setEnabled(true);
  $('reauth').hidden = true;
  $('forget').hidden = false;
  log(`game folder ready: ${handle.name} -> Data = ${found.data.name}`, 'ok');
}

async function restore(): Promise<void> {
  savedHandle = await loadHandle<FileSystemDirectoryHandle>(HANDLE_KEYS.gameFolder);
  if (!savedHandle) {
    setStatus('No folder saved. Pick the game folder (the one containing Data/) or Data itself.');
    return;
  }
  const state = await queryAccess(savedHandle, 'readwrite');
  log(`saved handle "${savedHandle.name}" found in IndexedDB, permission = ${state}`);
  $('forget').hidden = false;
  if (state === 'granted') {
    await activate(savedHandle, 'restored');
  } else {
    setStatus(
      `Saved folder "${savedHandle.name}" found; permission is "${state}". Click "Re-authorize".`,
      'warn',
    );
    $('reauth').hidden = false;
  }
}

$('pick').addEventListener('click', async () => {
  try {
    const handle = await pickDirectory('game-folder', 'readwrite');
    await saveHandle(HANDLE_KEYS.gameFolder, handle);
    savedHandle = handle;
    log(`picked "${handle.name}", handle saved to IndexedDB`);
    await activate(handle, 'picked');
  } catch (error) {
    log(`pick cancelled or failed: ${(error as Error).message}`, 'warn');
  }
});

$('reauth').addEventListener('click', async () => {
  if (!savedHandle) return;
  const granted = await ensureAccess(savedHandle, 'readwrite');
  log(`requestPermission -> ${granted ? 'granted' : 'denied'}`, granted ? 'ok' : 'err');
  if (granted) await activate(savedHandle, 'restored');
});

$('forget').addEventListener('click', async () => {
  await deleteHandle(HANDLE_KEYS.gameFolder);
  savedHandle = undefined;
  game = null;
  setEnabled(false);
  $('reauth').hidden = true;
  $('forget').hidden = true;
  setStatus('Folder forgotten. Reload to confirm nothing comes back.');
  log('handle deleted from IndexedDB');
});

$('list').addEventListener('click', async () => {
  if (!game) return;
  const started = performance.now();
  const archives = await listArchives(game.data);
  const rows = archives
    .map(
      (a) => `<tr><td>${a.name}</td><td class="num">${(a.size / 1048576).toFixed(1)} MB</td></tr>`,
    )
    .join('');
  $('archives').innerHTML = `<table><tr><th>Archive</th><th>Size</th></tr>${rows}</table>`;
  log(`${archives.length} archives listed in ${(performance.now() - started).toFixed(0)} ms`, 'ok');
});

$('header').addEventListener('click', async () => {
  if (!game) return;
  try {
    const file = await resolveFile(game.data, 'Skyrim - Meshes0.bsa');
    const started = performance.now();
    const bytes = await readRange(file, 0, 36);
    const r = new BinaryReader(bytes.buffer);
    const magic = r.fixedString(4);
    const version = r.u32();
    const folderOffset = r.u32();
    const flags = r.u32();
    const folders = r.u32();
    const files = r.u32();
    const ok = magic === 'BSA' && version === 105;
    log(
      `Skyrim - Meshes0.bsa header in ${(performance.now() - started).toFixed(1)} ms: magic="${magic}" version=${version} folderOffset=${folderOffset} flags=0x${flags.toString(16)} folders=${folders} files=${files}`,
      ok ? 'ok' : 'err',
    );
  } catch (error) {
    log(`header read failed: ${(error as Error).message}`, 'err');
  }
});

$('write').addEventListener('click', async () => {
  if (!game) return;
  try {
    const content = `Skyrim Dungeon Planner R14a write test\n${new Date().toISOString()}\n`;
    const started = performance.now();
    await writeFileAtomic(game.data, TEST_FILE, content);
    log(
      `wrote Data/${TEST_FILE} (${content.length} bytes) in ${(performance.now() - started).toFixed(0)} ms`,
      'ok',
    );
  } catch (error) {
    log(`write failed: ${(error as Error).message}`, 'err');
  }
});

$('verify').addEventListener('click', async () => {
  if (!game) return;
  try {
    const file = await resolveFile(game.data, TEST_FILE);
    const text = new TextDecoder().decode(await readAll(file));
    log(`read back Data/${TEST_FILE}: ${JSON.stringify(text)}`, 'ok');
  } catch (error) {
    log(`read back failed: ${(error as Error).message}`, 'err');
  }
});

$('remove').addEventListener('click', async () => {
  if (!game?.data.removeEntry) return;
  try {
    await game.data.removeEntry(TEST_FILE);
    log(`deleted Data/${TEST_FILE}`, 'ok');
  } catch (error) {
    log(`delete failed: ${(error as Error).message}`, 'err');
  }
});

if (supportsFileSystemAccess()) {
  $('support').textContent = 'File System Access API available.';
  $('support').className = 'ok';
  void restore();
} else {
  $('support').textContent =
    'This browser has no File System Access API. Use Chrome or Edge (D43).';
  $('support').className = 'err';
  $<HTMLButtonElement>('pick').disabled = true;
}
