/**
 * Application session (Svelte 5 runes): the configured folders and the virtual Data view.
 * Pages read `session.view`; actions here wrap the framework-free helpers.
 */
import {
  HANDLE_KEYS,
  deleteHandle,
  ensureAccess,
  loadHandle,
  pickDirectory,
  queryAccess,
  saveHandle,
} from '$lib/fs';
import { openDataView, type DataView } from './dataView';

export type SessionStatus =
  'idle' | 'restoring' | 'ready' | 'needs-setup' | 'needs-permission' | 'error';

class Session {
  view = $state<DataView | null>(null);
  status = $state<SessionStatus>('idle');
  message = $state('');
  gameName = $state<string | undefined>(undefined);
  mo2Name = $state<string | undefined>(undefined);

  get ready(): boolean {
    return this.status === 'ready' && this.view !== null;
  }

  /** On startup: reopen the saved folders if their permission is still granted. */
  async restore(): Promise<void> {
    this.status = 'restoring';
    const game = await loadHandle<FileSystemDirectoryHandle>(HANDLE_KEYS.gameFolder);
    const mo2 = await loadHandle<FileSystemDirectoryHandle>(HANDLE_KEYS.mo2Instance);
    this.gameName = game?.name;
    this.mo2Name = mo2?.name;
    if (!game) {
      this.status = 'needs-setup';
      this.message = 'Choose the game folder to start.';
      return;
    }
    if (
      (await queryAccess(game, 'readwrite')) !== 'granted' ||
      (mo2 && (await queryAccess(mo2, 'readwrite')) !== 'granted')
    ) {
      this.status = 'needs-permission';
      this.message = 'Saved folders need to be re-authorized.';
      return;
    }
    await this.open();
  }

  /** Must run in a user gesture: asks the browser for the saved folders' permission again. */
  async reauthorize(): Promise<void> {
    for (const key of [HANDLE_KEYS.gameFolder, HANDLE_KEYS.mo2Instance]) {
      const handle = await loadHandle<FileSystemDirectoryHandle>(key);
      if (handle && !(await ensureAccess(handle, 'readwrite'))) {
        this.status = 'needs-permission';
        this.message = `Permission denied for "${handle.name}".`;
        return;
      }
    }
    await this.open();
  }

  async pickGameFolder(): Promise<void> {
    const handle = await pickDirectory('game-folder', 'readwrite');
    await saveHandle(HANDLE_KEYS.gameFolder, handle);
    this.gameName = handle.name;
    await this.open();
  }

  async pickMo2Instance(): Promise<void> {
    const handle = await pickDirectory('mo2-instance', 'readwrite');
    await saveHandle(HANDLE_KEYS.mo2Instance, handle);
    this.mo2Name = handle.name;
    await this.open();
  }

  async forgetMo2Instance(): Promise<void> {
    await deleteHandle(HANDLE_KEYS.mo2Instance);
    this.mo2Name = undefined;
    await this.open();
  }

  async setProfile(name: string): Promise<void> {
    await this.open(name);
  }

  /** Read the MO2 profile again (mods or plugins enabled in MO2 meanwhile). */
  async reload(): Promise<void> {
    await this.open(this.view?.mo2?.layout.profile.name);
  }

  private async open(profile?: string): Promise<void> {
    try {
      this.view = await openDataView(profile);
      this.status = 'ready';
      this.message = '';
    } catch (error) {
      this.view = null;
      this.status = 'error';
      this.message = (error as Error).message;
    }
  }
}

export const session = new Session();
