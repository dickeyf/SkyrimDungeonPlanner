/**
 * Level view derived from the plugin (docs/02-modele-de-donnees.md §2).
 * The .esp stays the source of truth (D10); these structures are rebuilt on every load.
 */
import type { CellIndex, FormKey, Vec3 } from '../catalogue/types';
import type { Rotation } from './rotation';

/** What the tool reads for every REFR of the cell. */
export interface PlacedRef {
  refFormKey: FormKey;
  base: FormKey;
  pos: Vec3;
  /** Euler angles in radians as stored in the record (rx, ry, rz). */
  rot: Vec3;
  scale: number;
}

/** A REFR recognized as a catalogue tile snapped to the grid. */
export interface TilePlacement {
  ref: PlacedRef;
  pieceEditorId: string;
  /** Grid cell whose min corner is the piece's footprint corner (cell (0,0,0) at rotation 0). */
  cell: CellIndex;
  rotation: Rotation;
  /** All grid cells the piece occupies, after rotation. */
  occupied: CellIndex[];
}

/** A REFR the tool displays but never edits (D23): unknown base, off-grid, scaled, tilted. */
export interface OpaqueRef {
  ref: PlacedRef;
  reason: 'unknown-base' | 'off-grid' | 'non-quarter-rotation' | 'scaled' | 'tilted';
}

export interface GridAnchor {
  /** World position of the corner of cell (0,0,0). */
  origin: Vec3;
  /** Grid module in Skyrim units (from the kit). */
  module: { xy: number; z: number };
}
