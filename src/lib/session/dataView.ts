/**
 * Shared by the PoC pages: restore the saved game folder and MO2 instance, build the
 * virtual Data view for the preferred profile, and expose a profile selector.
 */
import {
  HANDLE_KEYS,
  PREF_KEYS,
  getPref,
  identifyGameFolder,
  loadHandle,
  queryAccess,
  setPref,
  type GameFolders,
} from '$lib/fs';
import { Overlay, listProfiles, loadMo2Instance, mo2Layers, type Mo2Layout } from '$lib/vfs';

export interface DataView {
  game: GameFolders;
  mo2?: { handle: FileSystemDirectoryHandle; layout: Mo2Layout; profiles: string[] };
  overlay: Overlay;
  /** Plugin load order (Skyrim.esm only without MO2). */
  plugins: string[];
}

export async function openDataView(profile?: string): Promise<DataView> {
  const gameHandle = await loadHandle<FileSystemDirectoryHandle>(HANDLE_KEYS.gameFolder);
  if (!gameHandle || (await queryAccess(gameHandle, 'readwrite')) !== 'granted') {
    throw new Error('No game folder with granted access. Pick it on the R14a page first.');
  }
  const game = await identifyGameFolder(gameHandle);
  if (!game) throw new Error(`"${gameHandle.name}" is not a Skyrim folder.`);

  const mo2Handle = await loadHandle<FileSystemDirectoryHandle>(HANDLE_KEYS.mo2Instance);
  if (mo2Handle && (await queryAccess(mo2Handle, 'readwrite')) === 'granted') {
    const profiles = await listProfiles(mo2Handle);
    const wanted = profile ?? getPref(PREF_KEYS.mo2Profile);
    const layout = await loadMo2Instance(mo2Handle, wanted);
    setPref(PREF_KEYS.mo2Profile, layout.profile.name);
    return {
      game,
      mo2: { handle: mo2Handle, layout, profiles },
      overlay: new Overlay(mo2Layers(layout, game.data)),
      plugins: layout.plugins,
    };
  }
  return {
    game,
    overlay: new Overlay([{ name: 'Data (game)', dir: game.data }]),
    plugins: ['Skyrim.esm'],
  };
}

/** Fill a <select> with the instance's profiles and re-open the view when it changes. */
export function bindProfileSelect(
  select: HTMLSelectElement,
  view: DataView,
  onChange: (view: DataView) => void,
): void {
  if (!view.mo2) {
    select.innerHTML = '<option value="">(no MO2 instance)</option>';
    select.disabled = true;
    return;
  }
  select.disabled = false;
  select.innerHTML = view.mo2.profiles
    .map(
      (p) =>
        `<option${p === view.mo2!.layout.profile.name ? ' selected' : ''}>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</option>`,
    )
    .join('');
  select.onchange = async () => {
    const next = await openDataView(select.value);
    onChange(next);
  };
}

export function describeView(view: DataView): string {
  const mo2 = view.mo2
    ? `MO2 profile "${view.mo2.layout.profile.name}", ${view.mo2.layout.mods.length} mods, `
    : 'no MO2, ';
  return `${mo2}${view.overlay.layers.length} layer(s), ${view.plugins.length} plugins in load order.`;
}
