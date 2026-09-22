import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { HANDLE_KEYS, deleteHandle, loadHandle, resetHandleStore, saveHandle } from './handleStore';

// Real handles are structured-cloneable browser objects; any cloneable value stands in here.
const fakeHandle = {
  kind: 'directory',
  name: 'Skyrim Special Edition',
} as unknown as FileSystemHandle;

describe('handleStore', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    resetHandleStore();
  });

  it('returns undefined for an unknown key', async () => {
    expect(await loadHandle(HANDLE_KEYS.gameFolder)).toBeUndefined();
  });

  it('saves, loads and deletes a handle', async () => {
    await saveHandle(HANDLE_KEYS.gameFolder, fakeHandle);
    expect(await loadHandle(HANDLE_KEYS.gameFolder)).toEqual(fakeHandle);
    await deleteHandle(HANDLE_KEYS.gameFolder);
    expect(await loadHandle(HANDLE_KEYS.gameFolder)).toBeUndefined();
  });

  it('overwrites an existing key', async () => {
    await saveHandle(HANDLE_KEYS.gameFolder, fakeHandle);
    const other = { kind: 'directory', name: 'Data' } as unknown as FileSystemHandle;
    await saveHandle(HANDLE_KEYS.gameFolder, other);
    expect(await loadHandle(HANDLE_KEYS.gameFolder)).toEqual(other);
  });
});
