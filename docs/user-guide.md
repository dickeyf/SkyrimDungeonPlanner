# User guide

Skyrim Dungeon Planner builds Skyrim SE dungeons from the Imperial kit on a top-down grid and
writes them into your plugin, ready for the Creation Kit. It runs entirely in your browser:
your game folder is read in place and nothing is uploaded.

![The editor](img.png)

## Contents

1. [Requirements](#requirements)
2. [Getting started](#getting-started)
3. [The editor](#the-editor)
4. [Building with the assistant](#building-with-the-assistant)
5. [Placing and moving pieces](#placing-and-moving-pieces)
6. [Marks: open faces, seams, mismatches, shared cells](#marks)
7. [Saving and the Creation Kit](#saving-and-the-creation-kit)
8. [New plugins and cells](#new-plugins-and-cells)
9. [Settings](#settings)
10. [Limits of V1](#limits-of-v1)
11. [Troubleshooting](#troubleshooting)

## Requirements

- **Chrome or Edge** (desktop). The tool needs the File System Access API, which other browsers
  do not offer.
- **Skyrim Special Edition** installed, with its `Data` folder.
- Optional: **Mod Organizer 2**. The tool then sees the game exactly as your MO2 profile does,
  mods included.

Open the app in one of three ways: the single `SkyrimDungeonPlanner.html` file (double-click it),
the Docker image (<http://localhost:8080/>), or from source (`npm run dev`).

## Getting started

The first time, the app opens **Getting started**, three steps that check themselves off:

1. **Your game**: choose the Skyrim SE folder (the game folder or its `Data` folder). If you use
   MO2, also choose its instance folder (the one with `ModOrganizer.ini`) and your profile. The
   browser asks for permission to read and write these folders; it keeps it for the next visits
   (after a browser restart, it may ask again: click _Re-authorize_).
2. **Your plugin**: pick the plugin to build in, or create a new one (see
   [New plugins and cells](#new-plugins-and-cells)).
3. **Build**: open the editor. The first time, the tool analyses the kit's pieces from your
   game files (about ten seconds); the result is kept for the next times.

Once set up, the app opens the editor directly.

## The editor

- **Toolbar**: the cell of the plugin (choosing one opens it; the last cell you opened in each
  plugin reopens automatically), _New cell..._, _Undo_ / _Redo_, **Save** (with the number of
  unsaved changes; hover it for the details), _Reload plugin_.
- **Scene**: the cell seen from above, on the kit's grid. Drag to pan, use the wheel to zoom,
  _Fit_ to frame the whole cell. Pieces are coloured by category: halls, rooms, doors. _Other
  objects_ (lights, clutter, markers, pieces outside the kit) can be shown, faded or hidden:
  they are never changed.
- **Left panel**: what you are doing (placing a piece, an open face and its compatible pieces,
  the selected tile), then the **Pieces** palette with a search box and a category filter, then
  the legend of the marks.

Keyboard: **R** / **Shift+R** rotate, **Del** delete, **Esc** cancel, **Ctrl+Z** / **Ctrl+Y**
undo / redo, **Ctrl+S** save. _Shortcuts_ in the left panel lists them.

## Building with the assistant

Every opening of a piece that leads nowhere is marked with an **orange** strip: an _open face_.
Click it, and the left panel lists the **compatible pieces**: only placements that fit this face
**and** every piece they would touch, without seams. Each one shows the drawing of its opening.
Hover a line to preview the piece in place, click to place it. Use the search box and the
category filter above the list to narrow it down; _Esc_ closes it.

Ramps and stairs are offered both ways: going up by their low end, or down by their high end.

## Placing and moving pieces

- **From the palette**: click a piece, then click in the scene to place it; you keep placing the
  same piece (Shift+click places it and stops). **R** / **Shift+R** turn it. Near an orange face
  it fits, the piece **snaps** onto it, aligned with the opening and turned if needed; far from
  any, it follows the grid.
- **Select** a tile by clicking it: the panel shows its cell, rotation and **junctions**. Your
  own tiles can be turned (**R**), deleted (**Del**) or **dragged** to move them; a dragged tile
  snaps onto open faces too. Tiles that belong to a master file are read-only.
- A placement that would share a cell with another tile is refused (the preview turns red).
- Everything can be undone and redone until you save.

## Marks

| Mark | Meaning | What to do |
| --- | --- | --- |
| orange | open face | click it to add a piece that fits |
| yellow | **seam**: the openings match only roughly; the gap is shown (1 unit already shows up close) | replace one of the pieces, or check it in game |
| red | **mismatch**: the openings do not match, or an opening faces a wall | replace or move a piece |
| magenta | **shared cell**: two tiles overlap | if it is intended and shows no seam, mark it (below) |

Click a mark to see the details. For a junction, the panel draws both openings overlaid (red:
this piece, green: the neighbour, as seen from this side) with the measured gaps.

**Intended overlaps**: some pieces are made to nest into their neighbour to hide the joint. Click
the magenta cell and _Mark ... as intended_: that pair, in that exact placement, is then accepted
everywhere, not flagged, and may be placed and offered. The decision is stored with the
catalogue annotations (_Settings_, _Validation_, _Accepted overlaps_, where it can be removed).

_Show marks_ turns all marks off and on.

## Saving and the Creation Kit

Edits stay in the page until you click **Save** (or press Ctrl+S). Saving:

1. refuses to write if the plugin changed on disk since it was opened (for example, saved by the
   Creation Kit): click _Reload plugin_ first (your unsaved edits would be lost, so save them
   before working in the CK);
2. makes a **backup** of the current file in `DungeonMakerBackups/` next to the plugin, named with
   the date and time (`MyDungeon.20260924-140509.esp.bak`); the game and the CK ignore it;
3. writes the plugin, then reads it back to check it.

Existing references keep their FormIDs; only their position and angle change. New tiles get new
FormIDs of your plugin.

**With the Creation Kit**: do not save the plugin from the CK while it has unsaved edits here,
and after saving here, reload the plugin in the CK before editing it there. The lighting,
navmesh, doors' teleport links and everything else remain the CK's job.

## New plugins and cells

- **New plugin** (_Settings_, _Folders and plugin_, or Getting started): type the file name
  (it follows the folder name until you change it) and choose the folder: an enabled mod
  folder, or _New MO2 mod folder..._. The plugin is empty, with `Skyrim.esm` (and any master
  the kit's pieces need) as masters. For a new MO2 mod folder: in MO2, refresh (F5), enable the
  mod and the plugin, then click _Reload MO2 profile_. Enable the plugin in your mod manager so
  the game and the CK load it.
- **New cell** (editor toolbar): type an EditorID (letters, digits, `_`). The interior cell is
  created with a neutral default lighting and written at once (with a backup); set its real
  lighting in the CK.

## Settings

- **Folders and plugin**: game folder, MO2 instance and profile, working plugin, new plugin.
- **Catalogue**: the kit's pieces extracted from `Skyrim.esm` and their analysis.
- **Validation**: review of the automatic connection types (near matches, composite faces,
  pieces, accepted overlaps). The decisions are catalogue annotations.

## Limits of V1

- The **Imperial kit** only, and **one level (Z)** at a time: ramps and stairs work, but the view
  does not show heights, so take care where levels change.
- The tool edits tiles only (the kit's structural pieces); everything else in a cell passes
  through untouched.
- No navmesh, props, lighting or door links: finish those in the Creation Kit.
- Seams are judged on the openings' outlines; a gap elsewhere around a junction, or a texture
  that does not continue, is not detected.
- ESL-flagged plugins are not supported.

## Troubleshooting

- **"Opening the game folder..." stays, or a permission message shows**: open _Settings_ (or
  Getting started) and click _Re-authorize_; the browser needs a click to give access back.
- **Save refused, "changed on disk"**: the plugin was saved elsewhere (the CK). Click _Reload
  plugin_.
- **A new plugin does not appear**: in a new MO2 mod folder, enable the mod in MO2, then _Reload
  MO2 profile_.
- **Restore a backup**: copy the wanted `.esp.bak` from `DungeonMakerBackups/` over the plugin
  and remove the `.bak` extension.
