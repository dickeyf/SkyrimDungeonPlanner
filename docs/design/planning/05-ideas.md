# Ideas (unplanned)

- **Cross-section view** to see the structure of the floors. Possible as soon as `cells` is 3D.
- **Top-down thumbnails** generated from the meshes, instead of rectangles.
- **Other kits**: Nordic, Dwemer. Caves probably never with strict snapping.
- **Transition pieces between kits**: a connection type whose `mate` belongs to another kit. Decided (D54): both grids are displayed overlaid, each in its own colour, during placement.
- **Room markers and portals** generated as baked output (performance of large dungeons).
- **Doors**: place the door (DOOR ref) with its frame; teleport links left to the CK.
- **Visual variants**: offer equivalent pieces (same footprint, same connections) to break repetition.
- **Partially occupied cells**: a 214-unit annex (the embrasure of the large rooms) fills its row of grid cells to 84%; telling "shared grid cells" apart from "crossing walls" would make the overlap report (D58) more accurate. Seen on the working mod's cell, where the level designer had to force the assembly and hide the seams with columns.
- **Plan validation**: orphan open faces, unreachable areas, tiles without NavMesh.
- **Cross-check by names**: compare the types deduced from the mesh with the EditorID suffixes to spot catalogue errors.
- **Manual correction of the walkable polygon** in the catalogue validation tool.
- **Spriggit mode** (decided, D57, phase 6): the working mod read and written as Spriggit YAML/JSON, the masters in binary; for mods versioned in git without a `.esp`.
- **Custom kits of the working mod** (custom Imperial free-standing walls, windowed variants) in the catalogue as props with a step of 128.
- **Seeing Z in V1**: the level of tiles (ramps, stairs) is not visible in the top-down view;
  care is needed. At a minimum, show the level `k` of the hovered tile or tint tiles by their
  level, until the Z slices of phase 4. Noted during the step 16 test.
