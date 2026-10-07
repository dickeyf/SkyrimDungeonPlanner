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
  /**
   * Walkable floor settings that differ from the defaults for this kit (V4): e.g. a smaller
   * actor radius, so a narrow door frame is not cut off.
   */
  walkable?: { bridgeRadius?: number };
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
  // door frames narrower than an actor's width (NorRmBgWallFrontExSm01): kept as passages
  walkable: { bridgeRadius: 12 },
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

export const KITS: readonly KitDefinition[] = [IMPERIAL_KIT, NORDIC_KIT];
