/**
 * Level store (D57): how the editor reads (and, from step 13, edits) the working plugin's
 * cells, independently of the file format. The `.esp` backend is the first implementation;
 * a Spriggit (YAML/JSON) backend can be added in phase 6 without touching the editor.
 *
 * Everything is addressed by FormKey (`0x00123456:Plugin.esp`), never by load-order FormIDs.
 */
import type { FormKey, Vec3 } from '../catalogue/types';
import type { NavMeshData } from '../format/esp/navm';
import type { LevelEdit } from './edits';

export interface LevelCell {
  /** FormKey of the CELL record. */
  key: FormKey;
  editorId: string;
  name: string;
  /** Placed references of any type (REFR, ACHR, NAVM...). */
  placedCount: number;
}

export interface LevelRef {
  key: FormKey;
  base: FormKey;
  pos: Vec3;
  /** Euler angles in radians, as stored. */
  rot: Vec3;
  scale: number;
  /** Created by the working plugin (editable), not an override of a master record (D22). */
  own: boolean;
}

/** A NAVM of a cell. */
export interface LevelNavMesh {
  key: FormKey;
  /** Created by the working plugin (it can be rewritten), not an override of a master's. */
  own: boolean;
  nav: NavMeshData;
}

/** The master's NAVI, for a plugin that has none yet: its override starts from it. */
export interface MasterNavi {
  key: FormKey;
  version: number;
  /** The precomputed paths (NVPP), which the Creation Kit copies into the override. */
  nvpp?: Uint8Array;
}

/** What a Finalize did (V2 step 16). */
export interface FinalizeReport {
  navmeshes: number;
  doors: number;
  /** Load doors no triangle was found for. */
  missed: FormKey[];
  /** Linked doors that belong to a master: their XNDP is left to the Creation Kit. */
  masterDoors: FormKey[];
  islands: number;
}

export interface LevelStore {
  /** File name of the working plugin. */
  readonly name: string;
  readonly masters: readonly string[];
  listCells(): Promise<LevelCell[]>;
  /** REFRs of a cell; other placed types pass through untouched and are not listed. */
  readRefs(cell: FormKey): Promise<LevelRef[]>;
  /** The NavMeshes of a cell (one per cell normally, D36). */
  readNavMeshes(cell: FormKey): Promise<LevelNavMesh[]>;
  /**
   * Apply edits to a cell in memory, all or nothing: every edit is checked (own references
   * only, known bases) before any is applied. Returns the keys of the added references.
   */
  applyEdits(cell: FormKey, edits: readonly LevelEdit[]): Promise<FormKey[]>;
  /**
   * Finalize the cell's NavMeshes (door links, NAVI entries; no cover), as the Creation Kit
   * does. `masterNavi` is asked only when the plugin has no NAVI yet.
   */
  finalize(
    cell: FormKey,
    masterNavi: () => Promise<MasterNavi | undefined>,
  ): Promise<FinalizeReport>;
  /** Add an empty interior cell; its EditorID must be new in this plugin. */
  addCell(editorId: string): Promise<FormKey>;
  /** The level in its file format, ready to be written. */
  serialize(): Uint8Array;
}
