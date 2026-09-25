# 7. Writing plugins

The plugin is the source of truth (D10): the tool keeps no level document of its own. Edits are
held in memory as a layout until the user saves; saving writes the plugin in place.

## Level store (`level/store.ts`, D57)

The editor talks to a format-independent **level store**: list cells, read a cell's references,
apply edits, add a cell, serialize. Everything is addressed by FormKey. The `.esp` backend
(`espStore.ts`) wraps the plugin tree of [File formats](02-file-formats.md); a Spriggit
(YAML/JSON) backend can be added later without touching the editor (phase 6).

## From layout to edits (`level/edits.ts`)

`changes()` of the layout become level edits: **remove** by reference FormKey, **move** with the
grid placement of the moved tile, **add** with the piece's base FormKey and its grid placement
(`tileWorldPlacement`: `pos = corner + R·pivot`, heading from the quarter turns).

`applyEdits` is **all or nothing**: every edit is checked first (the reference exists in the
cell, it belongs to the plugin itself, the base's plugin is one of its masters); only then are
they applied, so a refused edit leaves the plugin untouched.

## Safe saving (`level/save.ts`, V5, D47)

1. **Stamp**: the file's size and modification time are recorded when it is loaded.
2. The file is **read again**; if its stamp changed (the Creation Kit saved it meanwhile), the
   save is refused and the edits stay in the page: nothing written elsewhere is overwritten.
3. The edits are applied to that fresh parse.
4. **Backup**: the current file is copied to `DungeonMakerBackups/<name>.<YYYYMMDD-HHMMSS>.esp.bak`
   next to it; the `.bak` extension keeps the game and the CK from loading it.
5. The plugin is replaced **atomically** and **read back** byte for byte.
6. The cell is reloaded from the file, and the edit history restarts from it.

ESL-flagged plugins are refused (V6): their FormID range is restricted.

## New plugins and cells (`format/esp/create.ts`, D62)

- **New plugin**: a bare `TES4` header: `HEDR` version 1.71 (the SE Creation Kit's), record
  count 0, first object id `0x800` (the CK's), author, and masters: `Skyrim.esm` plus every
  plugin providing a catalogue piece, official masters first then in load order
  (`level/masters.ts`). It is created in an enabled mod folder of the Data view, or in a new MO2
  mod folder to enable in MO2; an existing file is never overwritten.
- **New interior cell**: a `CELL` record with `EDID`, `DATA` = interior flag and a default
  lighting `XCLL` (92 bytes in SE: dim neutral ambient, no directional light, no fog); the real
  lighting is set in the CK. It goes into its **block and sub-block**, the last and
  second-to-last decimal digits of its object id, creating the groups as needed. When the plugin
  has no `CELL` top group yet, one is inserted before the top groups that follow `CELL` in the
  game's order (`WRLD`, `DIAL`, `QUST`...). The cell is written at once, with the same checks and
  backup as a save.
