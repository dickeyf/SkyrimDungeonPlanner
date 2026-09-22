/**
 * R15 proof of concept: read an MO2 instance (modlist, plugins) and overlay its mod folders
 * on the game's Data folder, then resolve paths and list the archive load order.
 */
import {
  HANDLE_KEYS,
  PREF_KEYS,
  ensureAccess,
  identifyGameFolder,
  loadHandle,
  pickDirectory,
  queryAccess,
  saveHandle,
  setPref,
  supportsFileSystemAccess,
  type GameFolders,
} from '$lib/fs';
import {
  Overlay,
  archiveLoadOrder,
  isMo2Instance,
  listProfiles,
  loadMo2Instance,
  mo2Layers,
  type Mo2Layout,
} from '$lib/vfs';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $<HTMLPreElement>('log');

function log(message: string, cls = ''): void {
  const line = document.createElement('div');
  line.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  if (cls) line.className = cls;
  logEl.prepend(line);
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

let game: GameFolders | null = null;
let mo2Handle: FileSystemDirectoryHandle | undefined;
let layout: Mo2Layout | null = null;
let overlay: Overlay | null = null;

function refreshButtons(): void {
  $<HTMLButtonElement>('load').disabled = !(game && mo2Handle);
  $<HTMLButtonElement>('resolve').disabled = !overlay;
}

async function useGame(handle: FileSystemDirectoryHandle): Promise<void> {
  const found = await identifyGameFolder(handle);
  if (!found) {
    $('game-status').textContent = `"${handle.name}" is not a Skyrim folder.`;
    $('game-status').className = 'err';
    return;
  }
  game = found;
  $('game-status').textContent = `Game folder: "${handle.name}" (Data = ${found.data.name}).`;
  $('game-status').className = 'ok';
  refreshButtons();
}

async function useMo2(handle: FileSystemDirectoryHandle): Promise<void> {
  if (!(await isMo2Instance(handle))) {
    $('mo2-status').textContent = `"${handle.name}" has no mods/ and profiles/ folders.`;
    $('mo2-status').className = 'err';
    return;
  }
  mo2Handle = handle;
  const profiles = await listProfiles(handle);
  const select = $<HTMLSelectElement>('profile');
  select.innerHTML =
    '<option value="">(from ModOrganizer.ini)</option>' +
    profiles.map((p) => `<option>${escape(p)}</option>`).join('');
  $('mo2-status').textContent = `MO2 instance: "${handle.name}", ${profiles.length} profile(s).`;
  $('mo2-status').className = 'ok';
  refreshButtons();
}

async function restore(): Promise<void> {
  for (const [key, use] of [
    [HANDLE_KEYS.gameFolder, useGame],
    [HANDLE_KEYS.mo2Instance, useMo2],
  ] as const) {
    const handle = await loadHandle<FileSystemDirectoryHandle>(key);
    if (!handle) continue;
    const state = await queryAccess(handle, 'readwrite');
    log(`saved ${key} "${handle.name}" permission = ${state}`);
    if (state === 'granted') await use(handle);
    else $('reauth').hidden = false;
  }
}

$('pick-game').addEventListener('click', async () => {
  try {
    const handle = await pickDirectory('game-folder', 'readwrite');
    await saveHandle(HANDLE_KEYS.gameFolder, handle);
    await useGame(handle);
  } catch (error) {
    log(`pick cancelled: ${(error as Error).message}`, 'warn');
  }
});

$('pick-mo2').addEventListener('click', async () => {
  try {
    const handle = await pickDirectory('mo2-instance', 'readwrite');
    await saveHandle(HANDLE_KEYS.mo2Instance, handle);
    await useMo2(handle);
  } catch (error) {
    log(`pick cancelled: ${(error as Error).message}`, 'warn');
  }
});

$('reauth').addEventListener('click', async () => {
  for (const [key, use] of [
    [HANDLE_KEYS.gameFolder, useGame],
    [HANDLE_KEYS.mo2Instance, useMo2],
  ] as const) {
    const handle = await loadHandle<FileSystemDirectoryHandle>(key);
    if (handle && (await ensureAccess(handle, 'readwrite'))) await use(handle);
  }
  $('reauth').hidden = true;
});

$('load').addEventListener('click', async () => {
  if (!game || !mo2Handle) return;
  try {
    const started = performance.now();
    const profile = $<HTMLSelectElement>('profile').value || undefined;
    layout = await loadMo2Instance(mo2Handle, profile);
    setPref(PREF_KEYS.mo2Profile, layout.profile.name);
    overlay = new Overlay(mo2Layers(layout, game.data));
    const elapsed = performance.now() - started;
    log(
      `profile "${layout.profile.name}": ${layout.mods.length} enabled mods, ${layout.plugins.length} enabled plugins, ${overlay.layers.length} layers in ${elapsed.toFixed(0)} ms`,
      'ok',
    );
    for (const w of layout.warnings) log(w, 'warn');

    $('mods').innerHTML =
      `<b>${layout.mods.length} enabled mods, highest priority first:</b><ol>` +
      layout.mods
        .map(
          (m) =>
            `<li>${escape(m.name)}${m.dir ? '' : ' <span class="err">(folder missing)</span>'}</li>`,
        )
        .join('') +
      '</ol>';

    const pluginRows = await Promise.all(
      layout.plugins.map(async (p) => {
        const found = await overlay!.resolveFile(p);
        return `<tr><td>${escape(p)}</td><td class="${found ? '' : 'err'}">${found ? escape(found.layer.name) : 'NOT FOUND'}</td></tr>`;
      }),
    );
    $('plugins').innerHTML =
      `<b>Plugins in load order, with the layer providing each:</b><table><tr><th>Plugin</th><th>Layer</th></tr>${pluginRows.join('')}</table>`;

    const archives = await archiveLoadOrder(overlay, layout.plugins);
    $('archives').innerHTML =
      `<b>${archives.length} archives in load order (last wins):</b><table><tr><th>#</th><th>Archive</th><th>Layer</th><th>Via</th></tr>` +
      archives
        .map(
          (a, i) =>
            `<tr><td>${i + 1}</td><td>${escape(a.name)}</td><td>${escape(a.layer.name)}</td><td>${a.source === 'base' ? 'Skyrim.ini' : escape(a.plugin!)}</td></tr>`,
        )
        .join('') +
      '</table>';
    refreshButtons();
  } catch (error) {
    log(`load failed: ${(error as Error).message}`, 'err');
  }
});

$('resolve').addEventListener('click', async () => {
  if (!overlay) return;
  const path = $<HTMLInputElement>('path').value.trim();
  const all = await overlay.resolveAll(path);
  if (all.length === 0) {
    $('resolved').innerHTML =
      `<p class="warn">No layer has <code>${escape(path)}</code> as a loose file (it may live inside an archive).</p>`;
    log(`${path}: not found as loose file`, 'warn');
    return;
  }
  const sizes = await Promise.all(all.map(async (r) => (await r.file.getFile()).size));
  $('resolved').innerHTML =
    `<table><tr><th>Layer</th><th>Size</th><th></th></tr>` +
    all
      .map(
        (r, i) =>
          `<tr><td>${escape(r.layer.name)}</td><td>${sizes[i]} bytes</td><td>${i === 0 ? '<b class="ok">wins</b>' : 'overridden'}</td></tr>`,
      )
      .join('') +
    '</table>';
  log(`${path}: ${all.length} copies, winner = ${all[0]!.layer.name}`, 'ok');
});

if (supportsFileSystemAccess()) {
  $('support').textContent = 'File System Access API available.';
  $('support').className = 'ok';
  void restore();
} else {
  $('support').textContent =
    'This browser has no File System Access API. Use Chrome or Edge (D43).';
  $('support').className = 'err';
}
