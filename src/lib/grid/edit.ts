/**
 * Editing a cell's tile layout (step 13), as pure immutable operations.
 *
 * A layout is the set of tiles of the loaded cell, each at a grid cell and rotation. Edits
 * never write the plugin: step 15 turns `changes()` into REFR additions, moves and deletions.
 * Rules: master tiles are read-only (D22); a new placement or a move is refused when it would
 * share a cell with another tile, while overlaps already present in the level stay tolerated
 * (D58), and so do overlaps accepted in the annotations (overlaps.ts).
 */
import type { CellIndex, FormKey, Piece, Vec3 } from '../catalogue/types';
import {
  headingFromQuarterTurns,
  originFromCorner,
  rotateFootprintCell,
  type DeriveResult,
} from './derive';
import { addCells, normalizeRotation, type Rotation } from './rotation';
import { overlapAccepted, type AcceptedOverlaps } from './overlaps';
import type { GridAnchor, PlacedRef } from './types';

export interface EditTile {
  /** REFR FormKey for existing tiles, `new:<n>` for tiles added in this session. */
  key: string;
  piece: FormKey;
  /** Grid cell of the footprint corner (see derive.ts). */
  cell: CellIndex;
  rotation: Rotation;
  /** Belongs to the working plugin; master tiles cannot be edited (D22). */
  own: boolean;
  /** The REFR as loaded, for existing tiles; its placement is kept while the tile is untouched. */
  origin?: { ref: PlacedRef; cell: CellIndex; rotation: Rotation };
}

export interface Layout {
  tiles: ReadonlyMap<string, EditTile>;
  nextNew: number;
  /** Piece pairs allowed to share cells in one relative placement (annotations). */
  accepted?: AcceptedOverlaps;
}

export type EditFailure =
  | { ok: false; reason: 'conflict'; cells: CellIndex[] }
  | { ok: false; reason: 'read-only' | 'missing' | 'unknown-piece' };
export type EditResult = { ok: true; layout: Layout; key: string } | EditFailure;

export type Pieces = ReadonlyMap<FormKey, Piece>;

const cellKey = (c: CellIndex) => `${c[0]},${c[1]},${c[2]}`;
const sameCell = (a: CellIndex, b: CellIndex) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

export function layoutFromGrid(
  grid: DeriveResult,
  own: ReadonlyMap<string, boolean>,
  accepted?: AcceptedOverlaps,
): Layout {
  const tiles = new Map<string, EditTile>();
  for (const t of grid.tiles) {
    const key = t.ref.refFormKey;
    tiles.set(key, {
      key,
      piece: t.ref.base,
      cell: t.cell,
      rotation: t.rotation,
      own: own.get(key) ?? false,
      origin: { ref: t.ref, cell: t.cell, rotation: t.rotation },
    });
  }
  return { tiles, nextNew: 1, accepted };
}

/** Cells occupied by a piece placed at `cell` with `rotation`. */
export function footprintCells(piece: Piece, cell: CellIndex, rotation: Rotation): CellIndex[] {
  return piece.cells.map((pc) => addCells(cell, rotateFootprintCell(pc, rotation)));
}

/**
 * Cells of `cells` already used by tiles other than `ignore`. With `placing` (the tile being
 * placed there), tiles it may overlap by an accepted overlap are not conflicts.
 */
export function conflictsFor(
  layout: Layout,
  pieces: Pieces,
  cells: readonly CellIndex[],
  ignore?: string,
  placing?: { piece: FormKey; cell: CellIndex; rotation: Rotation },
): CellIndex[] {
  const wanted = new Set(cells.map(cellKey));
  const hits = new Map<string, CellIndex>();
  for (const tile of layout.tiles.values()) {
    if (tile.key === ignore) continue;
    if (placing && layout.accepted && overlapAccepted(layout.accepted, placing, tile)) continue;
    const piece = pieces.get(tile.piece);
    if (!piece) continue;
    for (const c of footprintCells(piece, tile.cell, tile.rotation)) {
      if (wanted.has(cellKey(c))) hits.set(cellKey(c), c);
    }
  }
  return [...hits.values()];
}

function withTile(layout: Layout, tile: EditTile, nextNew = layout.nextNew): Layout {
  const tiles = new Map(layout.tiles);
  tiles.set(tile.key, tile);
  return { tiles, nextNew, accepted: layout.accepted };
}

export function addTile(
  layout: Layout,
  pieces: Pieces,
  pieceKey: FormKey,
  cell: CellIndex,
  rotation: Rotation,
): EditResult {
  const piece = pieces.get(pieceKey);
  if (!piece) return { ok: false, reason: 'unknown-piece' };
  const cells = conflictsFor(layout, pieces, footprintCells(piece, cell, rotation), undefined, {
    piece: pieceKey,
    cell,
    rotation,
  });
  if (cells.length) return { ok: false, reason: 'conflict', cells };
  const key = `new:${layout.nextNew}`;
  const tile: EditTile = { key, piece: pieceKey, cell, rotation, own: true };
  return { ok: true, key, layout: withTile(layout, tile, layout.nextNew + 1) };
}

function place(
  layout: Layout,
  pieces: Pieces,
  key: string,
  cell: CellIndex,
  rotation: Rotation,
): EditResult {
  const tile = layout.tiles.get(key);
  if (!tile) return { ok: false, reason: 'missing' };
  if (!tile.own) return { ok: false, reason: 'read-only' };
  const piece = pieces.get(tile.piece);
  if (!piece) return { ok: false, reason: 'unknown-piece' };
  const cells = conflictsFor(layout, pieces, footprintCells(piece, cell, rotation), key, {
    piece: tile.piece,
    cell,
    rotation,
  });
  if (cells.length) return { ok: false, reason: 'conflict', cells };
  return { ok: true, key, layout: withTile(layout, { ...tile, cell, rotation }) };
}

/** Move and turn an own tile in one edit (a snapped drag may turn it to fit). */
export function placeTile(
  layout: Layout,
  pieces: Pieces,
  key: string,
  cell: CellIndex,
  rotation: Rotation,
): EditResult {
  return place(layout, pieces, key, cell, rotation);
}

/** The layout without one tile, whatever its owner: to reason about where it could go. */
export function withoutTile(layout: Layout, key: string): Layout {
  const tiles = new Map(layout.tiles);
  tiles.delete(key);
  return { tiles, nextNew: layout.nextNew, accepted: layout.accepted };
}

export function moveTile(layout: Layout, pieces: Pieces, key: string, cell: CellIndex): EditResult {
  const tile = layout.tiles.get(key);
  if (!tile) return { ok: false, reason: 'missing' };
  return place(layout, pieces, key, cell, tile.rotation);
}

/** Min corner of a footprint, to keep a tile in place while it turns. */
function minCorner(cells: readonly CellIndex[]): CellIndex {
  return [
    Math.min(...cells.map((c) => c[0])),
    Math.min(...cells.map((c) => c[1])),
    Math.min(...cells.map((c) => c[2])),
  ];
}

/**
 * The cell and rotation of a tile turned by `turns` quarter turns counter-clockwise, keeping
 * the min corner of its footprint where it was.
 */
export function turnedPlacement(
  piece: Piece,
  cell: CellIndex,
  rotation: Rotation,
  turns: number,
): { cell: CellIndex; rotation: Rotation } {
  const next = normalizeRotation(rotation + turns);
  const before = minCorner(footprintCells(piece, cell, rotation));
  const after = minCorner(footprintCells(piece, [0, 0, 0], next));
  return {
    cell: [before[0] - after[0], before[1] - after[1], before[2] - after[2]],
    rotation: next,
  };
}

export function rotateTile(layout: Layout, pieces: Pieces, key: string, turns: 1 | -1): EditResult {
  const tile = layout.tiles.get(key);
  if (!tile) return { ok: false, reason: 'missing' };
  const piece = pieces.get(tile.piece);
  if (!piece) return { ok: false, reason: 'unknown-piece' };
  const turned = turnedPlacement(piece, tile.cell, tile.rotation, turns);
  return place(layout, pieces, key, turned.cell, turned.rotation);
}

export function removeTile(layout: Layout, key: string): EditResult {
  const tile = layout.tiles.get(key);
  if (!tile) return { ok: false, reason: 'missing' };
  if (!tile.own) return { ok: false, reason: 'read-only' };
  const tiles = new Map(layout.tiles);
  tiles.delete(key);
  return { ok: true, key, layout: { tiles, nextNew: layout.nextNew, accepted: layout.accepted } };
}

export function isMoved(tile: EditTile): boolean {
  return (
    !!tile.origin &&
    (!sameCell(tile.cell, tile.origin.cell) || tile.rotation !== tile.origin.rotation)
  );
}

/**
 * World placement of a tile. Untouched existing tiles keep their stored position and angles
 * exactly (no drift from recomputation); new and moved tiles are placed on the grid.
 */
export function tileWorldPlacement(
  tile: EditTile,
  piece: Piece,
  anchor: GridAnchor,
): { pos: Vec3; rot: Vec3; scale: number } {
  if (tile.origin && !isMoved(tile)) {
    return { pos: tile.origin.ref.pos, rot: tile.origin.ref.rot, scale: tile.origin.ref.scale };
  }
  const corner: Vec3 = [
    anchor.origin[0] + tile.cell[0] * anchor.module.xy,
    anchor.origin[1] + tile.cell[1] * anchor.module.xy,
    anchor.origin[2] + tile.cell[2] * anchor.module.z,
  ];
  return {
    pos: originFromCorner(corner, tile.rotation, piece.pivot),
    rot: [0, 0, headingFromQuarterTurns(tile.rotation)],
    scale: 1,
  };
}

/** Grid cell of the footprint corner under a world point, for a piece being placed. */
export function cellAt(
  world: Vec3,
  anchor: GridAnchor,
  piece: Piece,
  rotation: Rotation,
): CellIndex {
  // centre the piece's footprint on the pointer: offset by half the rotated footprint
  const cells = footprintCells(piece, [0, 0, 0], rotation);
  const lo = minCorner(cells);
  const hi = [Math.max(...cells.map((c) => c[0])) + 1, Math.max(...cells.map((c) => c[1])) + 1];
  const fx = (world[0] - anchor.origin[0]) / anchor.module.xy - (lo[0] + hi[0]!) / 2;
  const fy = (world[1] - anchor.origin[1]) / anchor.module.xy - (lo[1] + hi[1]!) / 2;
  return [Math.round(fx) + 0, Math.round(fy) + 0, 0]; // `+ 0` turns -0 into 0
}

export interface LayoutChanges {
  added: EditTile[];
  moved: EditTile[];
  removed: EditTile[];
}

export function changes(original: Layout, current: Layout): LayoutChanges {
  const added: EditTile[] = [];
  const moved: EditTile[] = [];
  for (const tile of current.tiles.values()) {
    if (!tile.origin) added.push(tile);
    else if (isMoved(tile)) moved.push(tile);
  }
  const removed = [...original.tiles.values()].filter((t) => !current.tiles.has(t.key));
  return { added, moved, removed };
}

export function changeCount(c: LayoutChanges): number {
  return c.added.length + c.moved.length + c.removed.length;
}

/** Undo/redo over immutable layouts. */
export interface History {
  past: Layout[];
  present: Layout;
  future: Layout[];
}

export const historyOf = (layout: Layout): History => ({ past: [], present: layout, future: [] });

export function commit(h: History, layout: Layout): History {
  return { past: [...h.past, h.present], present: layout, future: [] };
}

export function undo(h: History): History {
  if (!h.past.length) return h;
  return {
    past: h.past.slice(0, -1),
    present: h.past[h.past.length - 1]!,
    future: [h.present, ...h.future],
  };
}

export function redo(h: History): History {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) };
}
