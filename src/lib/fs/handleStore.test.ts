import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  HANDLE_KEYS,
  deleteHandle,
  kvDelete,
  kvGet,
  kvSet,
  loadHandle,
  resetHandleStore,
  saveHandle,
} from './handleStore';

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

  it('caches values in the key-value store', async () => {
    expect(await kvGet('stats')).toBeUndefined();
    await kvSet('stats', { pieces: [1, 2, 3], when: 42 });
    expect(await kvGet<{ pieces: number[] }>('stats')).toEqual({ pieces: [1, 2, 3], when: 42 });
    await kvDelete('stats');
    expect(await kvGet('stats')).toBeUndefined();
  });
});
