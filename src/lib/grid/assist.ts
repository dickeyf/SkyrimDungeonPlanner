/**
 * Contextual assistant (step 14): the open faces of a layout, and the pieces that can be
 * placed against one of them.
 *
 * The catalogue stores one face per cell; an opening two cells wide is two faces with the
 * same direction and connection type. An opening is a contiguous run of such faces. Two
 * openings join when their types mate and they are centred on each other: same width for a
 * plain type, or a narrower opening inside a wider one through a composite (D56), since
 * profiles are centred on their cells.
 */
import type {
  CellIndex,
  ConnectionType,
  Face,
  FaceDir,
  FormKey,
  Piece,
  Vec3,
} from '../catalogue/types';
import { facesMate } from '../catalogue/types';
import { rotateFootprintCell } from './derive';
import { conflictsFor, footprintCells, type Layout, type Pieces } from './edit';
import type { Profile } from '../mesh/profiles';
import { betterFit, inFrameOf, profileFit, type JointFit } from './joints';
import type { GridAnchor, OpaqueRef } from './types';
import { addCells, cellKey, dirOffset, oppositeDir, rotateDir, type Rotation } from './rotation';

/** A contiguous run of faces of a piece at rotation 0. */
export interface Opening {
  dir: FaceDir;
  /** The first face of the run: its conn / extraConn stand for the whole run. */
  face: Face;
  /** Piece cells behind the opening, sorted along the face. */
  cells: CellIndex[];
}

/** An opening of a placed tile whose outside cells are all free. */
export interface OpenFace {
  id: string;
  tile: string;
  /** Opening in the piece's own frame (rotation 0), for its profile. */
  opening: Opening;
  /** World direction and cells, after the tile's rotation. */
  dir: FaceDir;
  cells: CellIndex[];
  /** Free cells just outside the opening. */
  outside: CellIndex[];
}

export interface Candidate {
  piece: FormKey;
  cell: CellIndex;
  rotation: Rotation;
  /** The candidate's opening that mates with the open face, rotation 0. */
  opening: Opening;
}

/** Axis running along a face: faces on ±X run along Y, and conversely. */
const alongAxis = (dir: FaceDir): 0 | 1 => (dir[1] === 'X' ? 1 : 0);

/** Group a piece's faces into openings (same direction and type, adjacent cells). */
export function openingsOf(piece: Piece): Opening[] {
  const groups = new Map<string, Face[]>();
  for (const f of piece.faces) {
    const along = alongAxis(f.dir);
    const across = along === 0 ? 1 : 0;
    const key = `${f.dir}|${f.conn}|${f.cell[across]}|${f.cell[2]}`;
    const list = groups.get(key) ?? [];
    list.push(f);
    groups.set(key, list);
  }
  const out: Opening[] = [];
  for (const list of groups.values()) {
    const along = alongAxis(list[0]!.dir);
    list.sort((a, b) => a.cell[along] - b.cell[along]);
    let run: Face[] = [];
    const flush = () => {
      if (run.length) out.push({ dir: run[0]!.dir, face: run[0]!, cells: run.map((f) => f.cell) });
      run = [];
    };
    for (const f of list) {
      const last = run[run.length - 1];
      if (last && f.cell[along] !== last.cell[along] + 1) flush();
      run.push(f);
    }
    flush();
  }
  return out;
}

/**
 * `inner` lies within `outer` (sets of world cells) and both share the same centre along the
 * face, so their centred profiles line up.
 */
function centredWithin(
  inner: readonly CellIndex[],
  outer: readonly CellIndex[],
  along: 0 | 1,
): boolean {
  const keys = new Set(outer.map(cellKey));
  if (!inner.every((c) => keys.has(cellKey(c)))) return false;
  const span = (cells: readonly CellIndex[]) =>
    Math.min(...cells.map((c) => c[along])) + Math.max(...cells.map((c) => c[along]));
  return span(inner) === span(outer);
}

const minCorner = (cells: readonly CellIndex[]): CellIndex => [
  Math.min(...cells.map((c) => c[0])),
  Math.min(...cells.map((c) => c[1])),
  Math.min(...cells.map((c) => c[2])),
];

/** Tile keys by occupied cell key. */
function occupancy(layout: Layout, pieces: Pieces): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const tile of layout.tiles.values()) {
    const piece = pieces.get(tile.piece);
    if (!piece) continue;
    for (const c of footprintCells(piece, tile.cell, tile.rotation)) {
      const list = used.get(cellKey(c)) ?? [];
      list.push(tile.key);
      used.set(cellKey(c), list);
    }
  }
  return used;
}

/** Every opening of every tile, in world directions and cells. */
function worldOpenings(layout: Layout, pieces: Pieces): OpenFace[] {
  const out: OpenFace[] = [];
  for (const tile of layout.tiles.values()) {
    const piece = pieces.get(tile.piece);
    if (!piece) continue;
    openingsOf(piece).forEach((opening, n) => {
      const dir = rotateDir(opening.dir, tile.rotation);
      const cells = opening.cells.map((c) =>
        addCells(tile.cell, rotateFootprintCell(c, tile.rotation)),
      );
      const outside = cells.map((c) => addCells(c, dirOffset(dir)));
      out.push({ id: `${tile.key}#${n}`, tile: tile.key, opening, dir, cells, outside });
    });
  }
  return out;
}

/** Openings of own and master tiles that look onto free cells. */
export function openFaces(layout: Layout, pieces: Pieces): OpenFace[] {
  const used = occupancy(layout, pieces);
  return worldOpenings(layout, pieces).filter((o) => !o.outside.some((c) => used.has(cellKey(c))));
}

/** An opening that runs into another tile without a clean junction. */
export interface BadJoint extends OpenFace {
  /** Tiles in front of the opening. */
  against: string[];
  /** Their openings facing back, to explain the mismatch. */
  facing: OpenFace[];
  /** `seam` or `mismatch` (see joints.ts); `mismatch` also for a wall in front. */
  fit: JointFit;
  /** Gap in units for a geometric verdict, NaN when judged by connection types. */
  gap: number;
}

/** Face profiles by piece and rotation-0 direction, for the geometric verdict. */
export interface JointGeometry {
  profileOf(piece: FormKey, dir: FaceDir): Profile | undefined;
  module: { xy: number; z: number };
}

/**
 * Openings that run into another tile without a clean junction: a wall, an offset opening, a
 * profile that does not match or leaves a visible seam. Each side of a pair is reported.
 * With `geometry`, junctions are judged on their profiles (joints.ts): exact and included
 * junctions pass. Without it, or when a profile is missing, they are judged on connection
 * types: a narrower opening centred in a wider one through a composite passes.
 */
export function badJoints(
  layout: Layout,
  pieces: Pieces,
  types: ReadonlyMap<string, ConnectionType>,
  geometry?: JointGeometry,
): BadJoint[] {
  const used = occupancy(layout, pieces);
  const all = worldOpenings(layout, pieces);
  const byTile = new Map<string, OpenFace[]>();
  for (const o of all) byTile.set(o.tile, [...(byTile.get(o.tile) ?? []), o]);
  const out: BadJoint[] = [];
  for (const o of all) {
    const against = [
      ...new Set(o.outside.flatMap((c) => used.get(cellKey(c)) ?? []).filter((k) => k !== o.tile)),
    ];
    if (!against.length) continue;
    const face: Face = { ...o.opening.face, dir: o.dir };
    const along = alongAxis(o.dir);
    const want = new Set(o.outside.map(cellKey));
    // openings of the tiles in front that look back and share at least one cell of the junction
    const facing = against.flatMap((k) =>
      (byTile.get(k) ?? []).filter(
        (p) => p.dir === oppositeDir(o.dir) && p.cells.some((c) => want.has(cellKey(c))),
      ),
    );
    let fit: JointFit = 'mismatch';
    let gap = NaN;
    for (const p of facing) {
      const mine = geometry?.profileOf(layout.tiles.get(o.tile)!.piece, o.opening.dir);
      const theirs = geometry?.profileOf(layout.tiles.get(p.tile)!.piece, p.opening.dir);
      let f: JointFit;
      let g = NaN;
      if (geometry && mine && theirs) {
        ({ fit: f, gap: g } = profileFit(mine, inFrameOf(o, p, theirs, geometry.module)));
      } else {
        // a narrower opening may sit centred in front of a wider one, the rest against walls
        const mated =
          (centredWithin(p.cells, o.outside, along) || centredWithin(o.outside, p.cells, along)) &&
          facesMate(face, { ...p.opening.face, dir: p.dir }, types);
        f = mated ? 'exact' : 'mismatch';
      }
      // keep the best opening in front: better verdict, then smaller gap
      if (f !== fit ? betterFit(f, fit) === f : g < gap || Number.isNaN(gap)) {
        fit = f;
        gap = g;
      }
    }
    if (fit === 'seam' || fit === 'mismatch') out.push({ ...o, against, facing, fit, gap });
  }
  return out;
}

/**
 * Every placement of every piece that presents a mating opening of the same width right
 * against `open`, without overlapping any tile. All four rotations are tried through the
 * direction constraint: an opening fixes the rotation that turns it to face `open`.
 */
export function candidatesFor(
  open: OpenFace,
  layout: Layout,
  pieces: Pieces,
  types: ReadonlyMap<string, ConnectionType>,
): Candidate[] {
  const wantDir = oppositeDir(open.dir);
  const along = alongAxis(open.dir);
  const across = along === 0 ? 1 : 0;
  const t = open.outside;
  const tSpan = Math.min(...t.map((c) => c[along])) + Math.max(...t.map((c) => c[along]));
  const openFace: Face = { ...open.opening.face, dir: open.dir };
  const out: Candidate[] = [];
  for (const piece of pieces.values()) {
    for (const opening of openingsOf(piece)) {
      const rotation = ([0, 1, 2, 3] as const).find((r) => rotateDir(opening.dir, r) === wantDir);
      if (rotation === undefined) continue;
      if (!facesMate(openFace, { ...opening.face, dir: wantDir }, types)) continue;
      const turned = opening.cells.map((c) => rotateFootprintCell(c, rotation));
      // centre the candidate's opening on the open face; odd differences cannot be centred
      const span =
        Math.min(...turned.map((c) => c[along])) + Math.max(...turned.map((c) => c[along]));
      if ((tSpan - span) % 2 !== 0) continue;
      const xy = [0, 0];
      xy[along] = (tSpan - span) / 2 + 0;
      xy[across] = t[0]![across] - turned[0]![across] + 0;
      const cell: CellIndex = [xy[0]!, xy[1]!, t[0]![2] - turned[0]![2] + 0];
      const placed = turned.map((c) => addCells(cell, c));
      if (!centredWithin(placed, t, along) && !centredWithin(t, placed, along)) continue;
      if (conflictsFor(layout, pieces, footprintCells(piece, cell, rotation)).length) continue;
      out.push({ piece: piece.formKey, cell, rotation, opening });
    }
  }
  return out;
}

/** Depth of an open-face marker, as a fraction of the module, measured outward from the face. */
const MARKER_DEPTH = 0.35;

/** World rectangle marking an open face: a strip just outside it, across its whole width. */
export function faceRect(
  open: OpenFace,
  anchor: GridAnchor,
): { min: [number, number]; max: [number, number] } {
  const m = anchor.module.xy;
  const lo = minCorner(open.outside);
  const along = alongAxis(open.dir);
  const across = along === 0 ? 1 : 0;
  const min: [number, number] = [lo[0] * m, lo[1] * m];
  const max: [number, number] = [min[0], min[1]];
  max[along] = min[along] + open.outside.length * m;
  // the strip hugs the face: the outside cell's near edge is the face plane
  const toward = open.dir[0] === '+' ? 0 : 1 - MARKER_DEPTH;
  min[across] += toward * m;
  max[across] = min[across] + MARKER_DEPTH * m;
  return {
    min: [anchor.origin[0] + min[0], anchor.origin[1] + min[1]],
    max: [anchor.origin[0] + max[0], anchor.origin[1] + max[1]],
  };
}

/** The open face whose marker contains a world point, if any. */
export function faceAt(
  world: Vec3,
  opens: readonly OpenFace[],
  anchor: GridAnchor,
): OpenFace | undefined {
  return opens.find((o) => {
    const r = faceRect(o, anchor);
    return (
      world[0] >= r.min[0] && world[0] <= r.max[0] && world[1] >= r.min[1] && world[1] <= r.max[1]
    );
  });
}

/** What lies in front of an open face, on any level: to explain a face that looks closed. */
export interface FaceSurroundings {
  /** Tiles covering the outside cells in plan, whatever their level. */
  tiles: { key: string; piece: FormKey; cell: CellIndex; rotation: Rotation }[];
  /** Catalogue pieces kept out of the grid whose origin is near the outside cells. */
  opaque: { ref: OpaqueRef['ref']; reason: OpaqueRef['reason'] }[];
}

export function surroundings(
  open: OpenFace,
  layout: Layout,
  pieces: Pieces,
  opaque: readonly OpaqueRef[],
  anchor: GridAnchor,
): FaceSurroundings {
  const plan = new Set(open.outside.map((c) => `${c[0]},${c[1]}`));
  const tiles: FaceSurroundings['tiles'] = [];
  for (const tile of layout.tiles.values()) {
    const piece = pieces.get(tile.piece);
    if (!piece) continue;
    if (footprintCells(piece, tile.cell, tile.rotation).some((c) => plan.has(`${c[0]},${c[1]}`))) {
      tiles.push({ key: tile.key, piece: tile.piece, cell: tile.cell, rotation: tile.rotation });
    }
  }
  const m = anchor.module.xy;
  const lo = minCorner(open.outside);
  const centre = [anchor.origin[0] + (lo[0] + 0.5) * m, anchor.origin[1] + (lo[1] + 0.5) * m];
  const near = opaque
    .filter((o) => o.reason !== 'unknown-base' && pieces.has(o.ref.base))
    .filter((o) => Math.hypot(o.ref.pos[0] - centre[0]!, o.ref.pos[1] - centre[1]!) < 3 * m)
    .map((o) => ({ ref: o.ref, reason: o.reason }));
  return { tiles, opaque: near };
}

/** A cell claimed by several tiles: tolerated when loaded (D58), but a visible defect. */
export interface SharedCell {
  cell: CellIndex;
  tiles: string[];
}

export function sharedCells(layout: Layout, pieces: Pieces): SharedCell[] {
  const out: SharedCell[] = [];
  for (const [key, tiles] of occupancy(layout, pieces)) {
    if (tiles.length < 2) continue;
    const [i, j, k] = key.split(',').map(Number) as [number, number, number];
    out.push({ cell: [i, j, k], tiles });
  }
  return out;
}
