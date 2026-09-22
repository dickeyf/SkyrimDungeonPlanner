/**
 * Persist File System Access handles across sessions (D43).
 *
 * Handles are structured-cloneable, so they can be stored in IndexedDB but not in
 * localStorage. Restoring a handle does not restore permission: call
 * `ensureAccess()` (in a user gesture) before using it.
 */

const DB_NAME = 'skyrim-dungeon-planner';
const DB_VERSION = 1;
const STORE = 'handles';

export const HANDLE_KEYS = {
  gameFolder: 'gameFolder',
  mo2Instance: 'mo2Instance',
  pluginFile: 'pluginFile',
} as const;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(STORE, mode);
  const result = await request(fn(tx.objectStore(STORE)));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
  return result;
}

export function saveHandle(key: string, handle: FileSystemHandle): Promise<IDBValidKey> {
  return withStore('readwrite', (store) => store.put(handle, key));
}

export async function loadHandle<T extends FileSystemHandle = FileSystemHandle>(
  key: string,
): Promise<T | undefined> {
  return (await withStore('readonly', (store) => store.get(key))) as T | undefined;
}

export function deleteHandle(key: string): Promise<undefined> {
  return withStore('readwrite', (store) => store.delete(key));
}

/** Test hook: forget the cached connection so a fresh database can be opened. */
export function resetHandleStore(): void {
  dbPromise = undefined;
}
