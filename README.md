# Skyrim Dungeon Planner

2D top-down level design tool for assembling Skyrim SE dungeons from modular kits, running
entirely in the browser (Chrome or Edge, no backend). Your game folder is read in place through
the File System Access API; nothing is uploaded.

V1 covers the Imperial kit on a single Z level: open or create a plugin and its interior cells,
place tiles on the kit's grid, and let the assistant offer only the pieces that fit every
neighbour. Junctions are checked on the pieces' own mesh profiles (seams, mismatches, shared
cells), and the result is written back into the plugin, with a backup, for the Creation Kit.
The design notes are in `docs/` (French).

## Use it

- **One file**: download `SkyrimDungeonPlanner.html` from the latest release (or from the
  _Single-file build_ workflow artifacts) and open it in Chrome or Edge.
- **Docker**: `docker run -p 8080:8080 ghcr.io/dickeyf/skyrimdungeonplanner:main`, then open
  <http://localhost:8080/>.
- **From source**: `npm install && npm run dev`.

Then follow _Getting started_: choose the game folder (and the Mod Organizer 2 instance if you
use one), pick or create the plugin to build in, and open the editor.

## Stack

TypeScript, Vite, Svelte 5 (runes), three.js, Vitest. Binary parsers (ESP / BSA / NIF), mesh
analysis and grid logic are framework-free under `src/lib`.

## Commands

```bash
npm install
npm run dev           # Vite dev server; proof-of-concept pages at /poc/<name>.html
npm test              # Vitest, single run
npm run check         # svelte-check + tsc
npm run lint          # ESLint
npm run format        # Prettier
npm run build         # production build to dist/
npm run build:single  # one self-contained dist-single/index.html
```

## Layout

```
docs/          design notes (French)
data/          catalogue annotations (human decisions over the automatic analysis)
poc/           proof-of-concept HTML pages (phase 0)
tools/         Python + pynifly analysis scripts (prototypes)
docker/        nginx configuration of the image
src/lib/binary     BinaryReader / BinaryWriter
src/lib/format     esp/, bsa/, nif/ parsers and writers
src/lib/mesh       mesh analysis: openings, footprints, face profiles
src/lib/catalogue  catalogue: pieces, connection types, annotations
src/lib/grid       placements, editing, assistant, junction checks
src/lib/level      level store over the plugin: cells, edits, saving
src/lib/fs, vfs    File System Access API, Mod Organizer 2 virtual Data view
src/lib/render     three.js scene
src/pages          editor, settings, getting started
```

## License

GNU General Public License v3; see `LICENSE`.
