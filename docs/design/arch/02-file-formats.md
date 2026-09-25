# 2. File formats

All Bethesda formats are little-endian; strings are Windows-1252, read as latin1 (enough for
EditorIDs and model paths). `binary/BinaryReader` and `binary/BinaryWriter` are the shared
foundation (D45).

## Plugins (ESP / ESM): `format/esp`

### An opaque tree, written back byte for byte

A plugin is a `TES4` header record followed by top groups. `records.ts` parses it into a tree of
nodes without decoding record contents:

```
record header, 24 bytes: type[4] dataSize u32 flags u32 formId u32
                         timestamp u16 vcsInfo u16 formVersion u16 vcsInfo2 u16, then data
group header, 24 bytes:  'GRUP' groupSize u32 (header included) label[4] groupType i32
                         timestamp u16 vcsInfo u16 unknown u32, then the children
```

Record data stays as raw bytes, so an untouched plugin is rewritten **identical to the byte**
(proven by R14c); only group sizes are recomputed on write. A record is decoded only when the
tool needs it (`recordSubrecords`): subrecords are `type[4] size u16 data`, and a compressed
record (flag `0x40000`) holds `u32 decompressedSize` plus a zlib stream, inflated with the
platform `DecompressionStream`.

Group types used by the tool: `0` top, `2` interior cell block, `3` interior cell sub-block, `6`
cell children, `8` persistent children, `9` temporary children.

### Records the tool decodes

- `TES4` (`tes4.ts`): `HEDR` (version f32, numRecords u32, nextObjectId u32), `CNAM` author,
  `SNAM` description, `MAST`/`DATA` pairs (masters). The `light` flag (ESL) is refused (V6).
- `CELL` (`cellRefr.ts`): `EDID`, `FULL`, `DATA` flags (bit 0 = interior).
- `REFR`: `EDID`, `NAME` (base object FormID), `XSCL` (scale), `DATA` (position 3 × f32,
  rotation 3 × f32 in radians).
- `STAT` (`stat.ts`): `EDID`, `MODL` (model path, relative to `meshes\`).

### Editing in place (`plugin.ts`)

- **FormIDs**: the top byte is an index into the file's master list; `index == masters.length`
  means a record of the file itself. New records get `makeFormId(ownIndex, nextObjectId)` and
  `HEDR.nextObjectId` is bumped.
- **Record count**: the Creation Kit's `HEDR.numRecords` differs from a plain count of the tree
  by a few groups; edits therefore apply the **delta** of the tree's node count to the value
  read at load time, instead of recounting (measured: 1303 vs 1306 on a real plugin).
- **Add a reference**: into the cell's temporary children group, creating the children groups
  when the cell has none. **Move**: the `DATA` subrecord is replaced in place, `XSCL` replaced,
  added or removed; every other subrecord is kept verbatim. **Delete**: the record is removed.
- Only references created by the file itself are moved or deleted; overrides of master records
  are never edited (D22). Compressed records are not edited.
- **New cell**: see [Writing plugins](07-writing-plugins.md).

## Archives (BSA v105, Skyrim SE): `format/bsa`

The header, folder records and file records are read with **one ranged read**; the name tables
give `folder\file` paths. A file is then fetched with its own ranged read (`RangeSource`: a file
handle in the browser, a buffer in tests), so a 1 GB archive is never loaded whole. Compressed
files are LZ4 **frames** (`compress/lz4.ts`): magic `0x184D2204`, frame descriptor, blocks with a
`u32` size (bit 31 = stored uncompressed), end mark; checksums are not verified.

## Meshes (NIF, Gamebryo 20.2.0.7, user version 12, BS version 100): `format/nif`

A targeted reader (`NifFile.ts`): the header lists block types and **per-block sizes**, so any
block the tool does not need is skipped. It reads:

- the node tree (any `NiNode`-derived block) with transforms (rotation 3 × 3, translation,
  uniform scale);
- `BSTriShape` geometry: triangles and vertex positions. The vertex layout comes from the
  `BSVertexDesc` (a u64 of 4-bit fields: vertex size and attribute offsets in 4-byte units).
  Skyrim SE static meshes store 16-byte positions without the full-precision flag, so the
  position size is derived from the offset of the first attribute after it, not from the flag.

`geometry.ts` merges all shapes into one indexed mesh in piece space (Z up, game units), applying
each shape's world transform. Collision (`bhk*`) is not read yet (phase 3).
