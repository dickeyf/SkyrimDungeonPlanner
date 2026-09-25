# 8. Rendering and UI

## three.js scene (`render/`, D44)

`CellScene` is imperative three.js, outside the Svelte tree; the `CellView` component owns it
and feeds it props.

- **Camera**: orthographic, looking straight down (-Z) with north up; `MapControls` for pan and
  zoom, rotation disabled. The scene is rendered **on demand** (after a change or a camera move),
  never in a loop.
- **Placements** (`transform.ts`): the scene keeps Skyrim's frame and units. Skyrim angles turn
  clockwise seen from the positive axis and are applied X, then Y, then Z, so a reference's
  matrix is built from `Euler(−rx, −ry, −rz, 'ZYX')`, its position and scale.
- **Meshes** (`meshCache.ts`): one three.js geometry per model path, read once from the Data
  view (loose file, else the winning archive) and shared by every reference using it; shaded,
  untextured, coloured by category (V3). A missing mesh becomes a small marker.
- **Objects**: tiles are pickable; other references (clutter, lights, markers, pieces outside
  the kit) can be shown, faded or hidden.
- **Updates** (`syncObjects`): the objects are diffed by key. All geometries are loaded first,
  then the whole list is applied in one step; a sync overtaken by a newer one is dropped, so two
  updates never interleave (which once left stale tiles behind after a save).
- **Ghost**: the piece being placed or dragged, green when it fits, red on a conflict.
- **Highlights**: flat rectangles drawn over everything for the marks (open faces, seams,
  mismatches, shared cells).
- **Picking**: a raycast from the pointer; the pointer-down handler runs in the capture phase so
  dragging a selected tile can claim the gesture before the controls start panning.

## State (Svelte 5 runes)

| Store | Holds |
| --- | --- |
| `session` | folder handles, status (restoring, ready, needs permission...), the Data view |
| `catalogueStore` | kit STATs and mesh analysis (raw state, cached in IndexedDB) |
| `annotationStore` | committed and current annotations, dirty flag |
| `editorStore` | working plugin (level store), its cells, the loaded cell, the final catalogue, save and cell creation |

Large immutable results use `$state.raw`: they must stay structured-cloneable for IndexedDB and
need no deep reactivity. The edit history lives in the Editor page and is bound to the cell it
belongs to, so a layout is never drawn with another cell's grid anchor.

## Pages

- **Getting started** (`#/start`): three steps checked off as they are done: the game (and
  MO2), the working plugin (choose or create), open the editor. The app opens the editor
  directly once everything is set.
- **Editor** (`#/editor`): cell selector (the last cell per plugin reopens), new cell, undo,
  redo, Save with the change count, reload; the left panel holds the context (placing, open
  face with its compatible pieces, selected tile with its junctions, mark legend) and the piece
  palette; the scene fills the rest. Keyboard: R / Shift+R rotate, Del delete, Esc cancel,
  Ctrl+Z / Ctrl+Y undo / redo, Ctrl+S save.
- **Settings** (`#/settings/...`): folders and plugin, catalogue, validation of the annotations,
  and (development only) the proof-of-concept pages of phase 0.
