/**
 * File System Access API members missing from TypeScript's DOM library (Chromium only).
 * Only what this project uses. Methods merge as overloads with any lib declaration.
 */
export {};

declare global {
  type FileSystemPermissionMode = 'read' | 'readwrite';

  interface FileSystemHandlePermissionDescriptor {
    mode?: FileSystemPermissionMode;
  }

  interface FileSystemHandle {
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  }

  interface FileSystemDirectoryHandle {
    keys(): AsyncIterableIterator<string>;
    values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
    entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>;
  }

  interface DirectoryPickerOptions {
    /** Lets the browser remember the last directory per id. */
    id?: string;
    mode?: FileSystemPermissionMode;
    startIn?:
      FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
  }

  interface Window {
    showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
  }
}
