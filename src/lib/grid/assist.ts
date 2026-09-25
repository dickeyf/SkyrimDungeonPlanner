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
import { addTile, conflictsFor, footprintCells, type Layout, type Pieces } from './edit';
import type { Profile } from '../mesh/profiles';
import {
  DEPTH_TOL,
  betterFit,
  inFrameOf,
  profileFit,
  type JointFit,
  type ProfileFit,
} from './joints';
import { overlapAccepted } from './overlaps';
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

/** A junction between an opening and the tiles in front of it. */
export interface Joint extends OpenFace {
  /** Tiles in front of the opening. */
  against: string[];
  /** Their openings facing back, to explain the verdict. */
  facing: OpenFace[];
  /** See joints.ts; `mismatch` also for an opening against a wall. */
  fit: JointFit;
  /** Gap in units for a geometric verdict, NaN when judged by connection types. */
  gap: number;
  /** For a geometric verdict: how far this opening's profile lies from the other's, and back. */
  detail?: { mineOnTheirs: number; theirsOnMine: number };
  /** Gap between the two opening planes (units, negative when they overlap). */
  depth?: number;
}

/** A junction that is not clean: `seam` or `mismatch`. */
export type BadJoint = Joint;

/** Face profiles by piece and rotation-0 direction, for the geometric verdict. */
export interface JointGeometry {
  profileOf(piece: FormKey, dir: FaceDir): Profile | undefined;
  module: { xy: number; z: number };
}

/**
 * Profile verdicts by piece pair and relative placement. The same pairs meet again and again
 * across a level and between edits, so each is computed once per geometry.
 */
const fitCache = new WeakMap<JointGeometry, Map<string, ProfileFit>>();

interface JointContext {
  layout: Layout;
  types: ReadonlyMap<string, ConnectionType>;
  geometry?: JointGeometry;
  used: Map<string, string[]>;
  byTile: Map<string, OpenFace[]>;
}

function jointContext(
  layout: Layout,
  pieces: Pieces,
  types: ReadonlyMap<string, ConnectionType>,
  geometry?: JointGeometry,
): JointContext & { all: OpenFace[] } {
  const all = worldOpenings(layout, pieces);
  const byTile = new Map<string, OpenFace[]>();
  for (const o of all) byTile.set(o.tile, [...(byTile.get(o.tile) ?? []), o]);
  return { layout, types, geometry, used: occupancy(layout, pieces), byTile, all };
}

/** Sum of the lowest and highest index along the face: twice the centre, in cells. */
const span2 = (cells: readonly CellIndex[], along: 0 | 1) =>
  Math.min(...cells.map((c) => c[along])) + Math.max(...cells.map((c) => c[along]));

function profileVerdict(ctx: JointContext, o: OpenFace, p: OpenFace): ProfileFit | null {
  const geometry = ctx.geometry;
  if (!geometry) return null;
  const minePiece = ctx.layout.tiles.get(o.tile)!.piece;
  const theirPiece = ctx.layout.tiles.get(p.tile)!.piece;
  const along = alongAxis(o.dir);
  const key = [
    minePiece,
    o.opening.dir,
    theirPiece,
    p.opening.dir,
    o.dir,
    span2(p.cells, along) - span2(o.cells, along),
    p.cells[0]![2] - o.cells[0]![2],
  ].join('|');
  let cache = fitCache.get(geometry);
  if (!cache) fitCache.set(geometry, (cache = new Map()));
  const known = cache.get(key);
  if (known) return known;
  const mine = geometry.profileOf(minePiece, o.opening.dir);
  const theirs = geometry.profileOf(theirPiece, p.opening.dir);
  if (!mine || !theirs) return null;
  const verdict = profileFit(mine, inFrameOf(o, p, theirs, geometry.module));
  cache.set(key, verdict);
  return verdict;
}

/** The junction of opening `o`, or null when it looks onto free cells. */
function judge(ctx: JointContext, o: OpenFace): Joint | null {
  const self = ctx.layout.tiles.get(o.tile)!;
  const accepted = ctx.layout.accepted;
  // a tile nested into this one by an accepted overlap covers the junction on purpose (D61)
  const partner = (k: string) =>
    !!accepted && overlapAccepted(accepted, self, ctx.layout.tiles.get(k)!);
  const inFront = [
    ...new Set(
      o.outside.flatMap((c) => ctx.used.get(cellKey(c)) ?? []).filter((k) => k !== o.tile),
    ),
  ];
  const against = inFront.filter((k) => !partner(k));
  if (!against.length) return null;
  const face: Face = { ...o.opening.face, dir: o.dir };
  const along = alongAxis(o.dir);
  const want = new Set(o.outside.map(cellKey));
  // openings of the tiles in front that look back and share at least one cell of the junction
  const facing = against.flatMap((k) =>
    (ctx.byTile.get(k) ?? []).filter(
      (p) => p.dir === oppositeDir(o.dir) && p.cells.some((c) => want.has(cellKey(c))),
    ),
  );
  let fit: JointFit = 'mismatch';
  let gap = NaN;
  let detail: Joint['detail'];
  let bestDepth = 0;
  for (const p of facing) {
    const profiled = profileVerdict(ctx, o, p);
    let f: JointFit;
    let g = NaN;
    // the planes of the two openings may stand apart even when their shapes match
    const depth = (o.opening.face.inset ?? 0) + (p.opening.face.inset ?? 0);
    if (profiled) {
      f = profiled.fit;
      g = profiled.gap;
      if ((f === 'exact' || f === 'included') && depth > DEPTH_TOL) {
        f = 'seam';
        g = depth;
      }
    } else {
      // a narrower opening may sit centred in front of a wider one, the rest against walls
      const mated =
        (centredWithin(p.cells, o.outside, along) || centredWithin(o.outside, p.cells, along)) &&
        facesMate(face, { ...p.opening.face, dir: p.dir }, ctx.types);
      f = mated ? 'exact' : 'mismatch';
    }
    // keep the best opening in front: better verdict, then smaller gap
    if (f !== fit ? betterFit(f, fit) === f : g < gap || Number.isNaN(gap)) {
      fit = f;
      gap = g;
      detail = profiled ? { mineOnTheirs: profiled.aOnB, theirsOnMine: profiled.bOnA } : undefined;
      bestDepth = depth;
    }
  }
  return {
    ...o,
    against,
    facing,
    fit,
    gap,
    ...(detail ? { detail } : {}),
    ...(facing.length ? { depth: bestDepth } : {}),
  };
}

const isBad = (j: Joint | null): j is Joint => !!j && (j.fit === 'seam' || j.fit === 'mismatch');

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
  const ctx = jointContext(layout, pieces, types, geometry);
  return ctx.all.map((o) => judge(ctx, o)).filter(isBad);
}

/**
 * Every junction a tile takes part in: its own openings against other tiles, and the
 * openings of other tiles that look into its cells (against its openings or its walls).
 */
export function jointsOfTile(
  layout: Layout,
  pieces: Pieces,
  types: ReadonlyMap<string, ConnectionType>,
  key: string,
  geometry?: JointGeometry,
): Joint[] {
  const tile = layout.tiles.get(key);
  const piece = tile && pieces.get(tile.piece);
  if (!tile || !piece) return [];
  const mine = new Set(footprintCells(piece, tile.cell, tile.rotation).map(cellKey));
  const ctx = jointContext(layout, pieces, types, geometry);
  return ctx.all
    .filter((o) => o.tile === key || o.outside.some((c) => mine.has(cellKey(c))))
    .map((o) => judge(ctx, o))
    .filter((j): j is Joint => j !== null);
}

/**
 * Keep the candidates that fit every tile they would touch, not only the clicked face: each
 * is placed in a copy of the layout and all its junctions judged. Only placements whose
 * junctions are all clean (exact or included) are kept: a seam or a mismatch drops them.
 */
export function checkCandidates(
  candidates: readonly Candidate[],
  layout: Layout,
  pieces: Pieces,
  types: ReadonlyMap<string, ConnectionType>,
  geometry?: JointGeometry,
): Candidate[] {
  return candidates.filter((c) => {
    const placed = addTile(layout, pieces, c.piece, c.cell, c.rotation);
    if (!placed.ok) return false;
    return jointsOfTile(placed.layout, pieces, types, placed.key, geometry).every(
      (j) => j.fit === 'exact' || j.fit === 'included',
    );
  });
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
      const at = { piece: piece.formKey, cell, rotation };
      if (conflictsFor(layout, pieces, footprintCells(piece, cell, rotation), undefined, at).length)
        continue;
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

/** Cells claimed by several tiles, except by pairs whose overlap is accepted. */
export function sharedCells(layout: Layout, pieces: Pieces): SharedCell[] {
  const out: SharedCell[] = [];
  const accepted = layout.accepted;
  const allAccepted = (keys: string[]) =>
    !!accepted &&
    keys.every((a, i) =>
      keys
        .slice(i + 1)
        .every((b) => overlapAccepted(accepted, layout.tiles.get(a)!, layout.tiles.get(b)!)),
    );
  for (const [key, tiles] of occupancy(layout, pieces)) {
    if (tiles.length < 2 || allAccepted(tiles)) continue;
    const [i, j, k] = key.split(',').map(Number) as [number, number, number];
    out.push({ cell: [i, j, k], tiles });
  }
  return out;
}

/** How far (in modules) from an open face the pointer snaps a piece being placed onto it. */
export const SNAP_RANGE = 2;

/**
 * Where a piece being placed from the palette snaps: the placement that fits an open face
 * near the pointer (and every neighbour, as for the compatible pieces), closest to the
 * pointer, the current rotation first. Pieces do not all span whole multiples of an opening,
 * so the plain grid may leave the piece one cell off the face it is meant to join; null when
 * no open face nearby takes the piece, and the plain grid applies.
 */
export function snapPlacement(options: {
  world: Vec3;
  anchor: GridAnchor;
  layout: Layout;
  pieces: Pieces;
  types: ReadonlyMap<string, ConnectionType>;
  piece: FormKey;
  rotation: Rotation;
  opens: readonly OpenFace[];
  geometry?: JointGeometry;
}): { cell: CellIndex; rotation: Rotation } | null {
  const { world, anchor, layout, pieces, types, rotation, geometry } = options;
  const piece = pieces.get(options.piece);
  if (!piece) return null;
  const m = anchor.module.xy;
  const centreOf = (cells: readonly CellIndex[]) => [
    anchor.origin[0] +
      ((Math.min(...cells.map((c) => c[0])) + Math.max(...cells.map((c) => c[0])) + 1) / 2) * m,
    anchor.origin[1] +
      ((Math.min(...cells.map((c) => c[1])) + Math.max(...cells.map((c) => c[1])) + 1) / 2) * m,
  ];
  const distance = (cells: readonly CellIndex[]) => {
    const [x, y] = centreOf(cells);
    return Math.hypot(world[0] - x!, world[1] - y!);
  };
  const only = new Map([[piece.formKey, piece]]);
  let best: { cell: CellIndex; rotation: Rotation; score: number } | null = null;
  for (const face of options.opens) {
    if (distance(face.outside) > SNAP_RANGE * m) continue;
    const fits = checkCandidates(
      candidatesFor(face, layout, only, types),
      layout,
      pieces,
      types,
      geometry,
    );
    for (const c of fits) {
      // the chosen rotation wins over a slightly closer placement turned otherwise
      const score =
        distance(footprintCells(piece, c.cell, c.rotation)) + (c.rotation === rotation ? 0 : m);
      if (!best || score < best.score) best = { cell: c.cell, rotation: c.rotation, score };
    }
  }
  return best && { cell: best.cell, rotation: best.rotation };
}
