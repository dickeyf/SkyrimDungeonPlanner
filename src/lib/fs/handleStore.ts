/**
 * IndexedDB persistence (D43): File System Access handles (structured-cloneable, so they fit
 * in IndexedDB but not in localStorage) and a small key-value store for caches such as
 * extracted catalogue data. Restoring a handle does not restore permission: call
 * `ensureAccess()` (in a user gesture) before using it.
 */

const DB_NAME = 'skyrim-dungeon-planner';
const DB_VERSION = 2;
const HANDLES = 'handles';
const KV = 'kv';

export const HANDLE_KEYS = {
  gameFolder: 'gameFolder',
  mo2Instance: 'mo2Instance',
  projectFolder: 'projectFolder',
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
      for (const store of [HANDLES, KV]) {
        if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
  return dbPromise;
}

async function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(store, mode);
  const result = await request(fn(tx.objectStore(store)));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
  return result;
}

export function saveHandle(key: string, handle: FileSystemHandle): Promise<IDBValidKey> {
  return withStore(HANDLES, 'readwrite', (s) => s.put(handle, key));
}

export async function loadHandle<T extends FileSystemHandle = FileSystemHandle>(
  key: string,
): Promise<T | undefined> {
  return (await withStore(HANDLES, 'readonly', (s) => s.get(key))) as T | undefined;
}

export function deleteHandle(key: string): Promise<undefined> {
  return withStore(HANDLES, 'readwrite', (s) => s.delete(key));
}

/** Cache any structured-cloneable value under a key. */
export function kvSet(key: string, value: unknown): Promise<IDBValidKey> {
  return withStore(KV, 'readwrite', (s) => s.put(value, key));
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await withStore(KV, 'readonly', (s) => s.get(key))) as T | undefined;
}

export function kvDelete(key: string): Promise<undefined> {
  return withStore(KV, 'readwrite', (s) => s.delete(key));
}

/** Test hook: forget the cached connection so a fresh database can be opened. */
export function resetHandleStore(): void {
  dbPromise = undefined;
}
