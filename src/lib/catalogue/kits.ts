/**
 * Kit definitions: where a kit's meshes live and which sub-folders hold structural tiles.
 * The module is measured per kit (D51, D53) and lives with the kit, never in code.
 */
import type { Kit, PieceCategory } from './types';

export interface KitDefinition extends Kit {
  /** Model path prefix (relative to `meshes/`, lower-case, forward slashes). */
  modelPrefix: string;
  /** Sub-folder -> category of its tiles; sub-folders not listed are props/other. */
  subkits: Record<string, Exclude<PieceCategory, 'door' | 'other'>>;
}

export const IMPERIAL_KIT: KitDefinition = {
  kit: 'Imperial',
  module: { xy: 128, z: 128 },
  note: 'Measured by R5 on the vanilla meshes: base tile 256 x 256, stairs rise 256.',
  modelPrefix: 'dungeons/imperial/',
  subkits: {
    smallhall: 'hall',
    largehall: 'hall',
    smallroom: 'room',
    largeroom: 'room',
  },
};

export const KITS: readonly KitDefinition[] = [IMPERIAL_KIT];
