/**
 * Catalogue data model — the only data owned by the tool (D10, D12, D13).
 * Mirrors docs/design/planning/02-data-model.md §1. Fields marked "later" are present so the
 * V1 format never blocks Z levels, props or NavMesh (D14), but V1 leaves them null.
 */

/** Grid cell index, 3D from day one (V1 uses z = 0 only). */
export type CellIndex = readonly [i: number, j: number, k: number];

/** World-space vector (Skyrim units). */
export type Vec3 = readonly [x: number, y: number, z: number];

/** Face direction on the grid; V1 only uses the four horizontal ones. */
export type FaceDir = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';

export type PieceClass = 'tile' | 'prop';

/** UI filtering categories for the Imperial kit (D1). */
export type PieceCategory = 'hall' | 'room' | 'door' | 'other';

/** `"0x000123AB:Skyrim.esm"` — load-order independent identity of a base record. */
export type FormKey = string;

export interface Face {
  /** Cell of the piece (rotation 0) that owns this face. */
  cell: CellIndex;
  dir: FaceDir;
  /** Connection type id; see {@link ConnectionType}. */
  conn: string;
  /** Composite profiles (D56): further types this face also mates with. */
  extraConn?: string[];
  /**
   * How far the opening's plane lies inside the cell boundary (units, negative when it sticks
   * out); absent when on the boundary. Two facing openings leave a gap of the sum.
   */
  inset?: number;
}

export interface ReviewState {
  /** Produced by mesh analysis rather than entered by hand. */
  auto: boolean;
  /** Confirmed by a human in the validation page. */
  validated: boolean;
}

export interface Piece {
  editorId: string;
  formKey: FormKey;
  /** Model path as stored in the STAT record, e.g. `dungeons\imperial\...\x.nif`. */
  model: string;
  kit: string;
  class: PieceClass;
  category: PieceCategory;
  /** NIF origin relative to the min corner of cell (0,0,0) of the piece, rotation 0. */
  pivot: Vec3;
  /** Grid cells occupied at rotation 0, on every level the piece spans. Tiles only. */
  cells: CellIndex[];
  /** Open faces only; an absent face is closed. Tiles only. */
  faces: Face[];
  /** Walkable polygon(s) in local coordinates, vertices with Z. Later (NavMesh). */
  walkable: Vec3[][] | null;
  /** Floor footprint(s) that punch holes in the NavMesh. Later (obstacles). */
  obstacle: Vec3[][] | null;
  review: ReviewState;
}

export interface ConnectionType {
  id: string;
  kit: string;
  /** Identifier of the group of equivalent face profiles (open edges on the junction plane). */
  signature: string | null;
  /**
   * Connection type this one mates with. Equal to `id` for a symmetric profile,
   * otherwise points to the mirrored (left/right) profile.
   */
  mate: string;
  /** Canonical end points of the walkable edge on this face. Later (NavMesh). */
  navEdge: readonly [Vec3, Vec3] | null;
}

export interface Kit {
  kit: string;
  /** Grid module in Skyrim units. Must be MEASURED (R5); do not assume 256. */
  module: { xy: number | null; z: number | null };
  note?: string;
}

/**
 * Two pieces allowed to share cells in one exact relative placement (from the annotations):
 * the second piece's corner and rotation in the first piece's frame.
 */
export interface PieceOverlap {
  pieces: [FormKey, FormKey];
  rotation: 0 | 1 | 2 | 3;
  offset: CellIndex;
}

export interface Catalogue {
  /** Format version, bumped on breaking changes. */
  version: 1;
  kits: Kit[];
  connectionTypes: ConnectionType[];
  pieces: Piece[];
  /** Accepted overlaps between pieces; absent when there are none. */
  overlaps?: PieceOverlap[];
}

/**
 * `cells` must be indexed from the piece's min corner in plan (x and y have a 0); z is the
 * level relative to the NIF origin's slice (D55) and may start below 0.
 */
export function cellsAreNormalized(cells: readonly CellIndex[]): boolean {
  if (cells.length === 0) return false;
  return [0, 1].every((axis) => Math.min(...cells.map((c) => c[axis]!)) === 0);
}

/** Two faces mate when they look at each other and `conn` of one equals `mate` of the other. */
export function facesMate(a: Face, b: Face, types: ReadonlyMap<string, ConnectionType>): boolean {
  if (!isOpposite(a.dir, b.dir)) return false;
  const bConns = [b.conn, ...(b.extraConn ?? [])];
  return [a.conn, ...(a.extraConn ?? [])].some((c) => {
    const t = types.get(c);
    return t !== undefined && bConns.includes(t.mate);
  });
}

export function isOpposite(a: FaceDir, b: FaceDir): boolean {
  return a[1] === b[1] && a[0] !== b[0];
}
