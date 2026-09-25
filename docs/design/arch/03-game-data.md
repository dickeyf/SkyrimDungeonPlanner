# 3. Game data access

## File System Access API: `fs`

The browser reads the user's disk directly through the File System Access API (Chrome, Edge):

- `showDirectoryPicker` gives a directory handle for the game folder (the root or `Data`,
  recognized by `Skyrim.esm`, D42) and for the Mod Organizer 2 instance.
- Handles are stored in IndexedDB (D43) and restored at start-up. A restored handle may need a
  user gesture to get its permission back (`ensureAccess`); the Getting started page and
  Settings offer the button.
- `paths.ts` resolves Data-relative paths case-insensitively (Windows semantics), reads byte
  ranges (`File.slice`) and writes files **atomically**: `createWritable()` writes to a
  temporary file swapped in on `close()`, so a failure leaves the original untouched.

## Virtual Data view: `vfs`

Mod Organizer 2 shows the game a virtual `Data` folder; the browser sees the real disk instead,
so the tool rebuilds the overlay itself (D50, R15):

1. `ModOrganizer.ini` locates the mods folder; the chosen profile's `modlist.txt` lists enabled
   mods, **highest priority first** (the first listed mod wins a conflict, verified against
   MO2).
2. The overlay (`overlay.ts`) is the ordered list of layers: enabled mod folders, then the
   game's own `Data`. Looking up a file returns the first layer that has it.
3. The plugin load order comes from the profile's `plugins.txt` (`*` = enabled) or
   `loadorder.txt`. The official masters (`Skyrim.esm`, `Update.esm`, the three DLC) are left
   out of `plugins.txt` by MO2: they are always loaded first, in that order.
4. Directory listings are read once per directory handle and cached: a lookup walks up to ~70
   layers, and the File System Access API lists directories slowly (loading a cell went from
   14 s to 0.3 s). `invalidate()` drops the cache after the tool creates a file.

Without MO2 (Vortex deploys into `Data`, or no manager), the overlay has a single layer.

## Archives and where a file comes from

`archives.ts` gives the archive load order: the base archives of `Skyrim.ini`
(`sResourceArchiveList`, `sResourceArchiveList2`), then each plugin's archives
(`<plugin>.bsa`, `<plugin> - Textures.bsa`) in plugin load order. `archiveIndex.ts` answers
"where does this Data path come from": a **loose file** in the overlay wins; otherwise the
**last archive** in load order that contains it. Archive tables are read once and kept;
archives that never hold meshes (textures, sounds, voices, interface...) are skipped.
