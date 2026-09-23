/**
 * Disk access through the File System Access API (D42, D43, R14a).
 *
 * Directory handles (game folder, plugin folder) are persisted in IndexedDB so the user
 * never re-picks them; simple preferences live in localStorage.
 */
export * from './gameRoot';
export * from './handleStore';
export * from './paths';
export * from './permissions';
export * from './preferences';
export * from './projectFolder';
