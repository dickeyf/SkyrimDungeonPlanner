/**
 * Kit definitions: where a kit's meshes live and which sub-folders hold structural tiles.
 * The module is measured per kit (D51, D53) and lives with the kit, never in code.
 */
import type { Kit, PieceCategory } from './types';

export interface KitDefinition extends Kit {
  /** Model path prefix (relative to `meshes/`, lower-case, forward slashes). */
  modelPrefix: string;
  /**
   * Vertices an opening's plane needs (default `MIN_OPEN_VERTS`, 20): lower for a kit whose
   * meshes are sparse at their edges.
   */
  minOpenVerts?: number;
  /** Sub-folder -> category of its tiles; sub-folders not listed are props/other. */
  subkits: Record<string, Exclude<PieceCategory, 'door' | 'other'>>;
}

export const IMPERIAL_KIT: KitDefinition = {
  kit: 'Imperial',
  module: { xy: 128, z: 128 },
  // parts of a CELL shifted by 16, 32 or 64 from the main grid (Vanilla check, D70)
  fineStep: { xy: 16, z: 16 },
  note: 'Measured by R5 on the vanilla meshes: base tile 256 x 256, stairs rise 256.',
  modelPrefix: 'dungeons/imperial/',
  subkits: {
    smallhall: 'hall',
    largehall: 'hall',
    smallroom: 'room',
    largeroom: 'room',
  },
};

/**
 * The Nordic kit (V4, R19): module measured at step 1; not in KITS yet (the editor still works
 * on one kit, V4 step 4).
 */
export const NORDIC_KIT: KitDefinition = {
  kit: 'Nordic',
  module: { xy: 128, z: 128 },
  fineStep: { xy: 16, z: 16 },
  note: 'Measured by V4 step 1 (R19): 166 of 201 pieces on the 128 grid; stairs rise 128 or 256.',
  modelPrefix: 'dungeons/nordic/',
  // the room middles and secret passages carry 12 to 18 vertices on their open sides (step 3)
  minOpenVerts: 10,
  subkits: {
    smhalls: 'hall',
    bghalls: 'hall',
    catacombs: 'hall',
    secretpass: 'hall',
    smrooms: 'room',
    bgrooms: 'room',
  },
};

/**
 * The Dwemer kit (V5, R21): measured at step 1; not in KITS yet (step 3). `facades` holds the
 * small halls (`DweFacadeHallSm...`, 300 wide) among towers, bridges and balconies; the pieces
 * without an opening (bridges, balconies, roofs...) stay out of the catalogue on their own.
 */
export const DWEMER_KIT: KitDefinition = {
  kit: 'Dwemer',
  module: { xy: 128, z: 128 },
  fineStep: { xy: 16, z: 16 },
  note: 'Measured by V5 step 1 (R21): 82 of 181 pieces have openings, all on the 128 grid; ramps rise 256.',
  modelPrefix: 'dungeons/dwemer/',
  subkits: {
    bghalls: 'hall',
    lghalls: 'hall',
    facades: 'hall',
    smrooms: 'room',
    lgrooms: 'room',
  },
};

export const KITS: readonly KitDefinition[] = [IMPERIAL_KIT, NORDIC_KIT];
