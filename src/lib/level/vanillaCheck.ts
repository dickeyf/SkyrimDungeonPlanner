/**
 * Vanilla check (V4 step 5): the tool's reading and junction checks run on the game's own CELLs
 * built with a kit, to measure the catalogue against what Bethesda built. For each CELL: the
 * kit's pieces on the grid and why the others are not, the sections (groups of pieces sharing
 * one grid: the grid is derived again on what the previous ones left, D70 to come), and the bad
 * junctions of the main section, gathered by pair of pieces.
 */
import type { Catalogue, Piece, Vec3 } from '../catalogue/types';
import type { LevelStore } from './store';
import { deriveGrid } from '../grid/derive';
import type { PlacedRef } from '../grid/types';
import { layoutFromGrid } from '../grid/edit';
import { acceptedOverlaps } from '../grid/overlaps';
import { badJoints, meetingPairs, openFaces, type JointGeometry } from '../grid/assist';
import { relativePlacement } from '../grid/overlaps';
import type { VanillaPair } from '../catalogue/vanillaPairs';

export interface VanillaSection {
  tiles: number;
  /** Its pieces: EditorID -> count. */
  pieces: Record<string, number>;
  /** Grid origin relative to the main section's: x and y within (-module/2, module/2], z within (-zModule/2, zModule/2]. */
  offset: Vec3;
}

export interface VanillaCell {
  key: string;
  editorId: string;
  /** References to the kit's tiles (catalogue pieces). */
  kitTiles: number;
  /** The main section first. */
  sections: VanillaSection[];
  /** Kit tiles in no section, by reason (tilted, scaled, non-quarter-rotation, off-grid). */
  outside: Record<string, number>;
  open: number;
  seams: number;
  mismatches: number;
}

export interface VanillaReport {
  cells: VanillaCell[];
  /** Bad junctions of the main sections, by "piece:face vs facing pieces". */
  pairs: { pair: string; seams: number; mismatches: number }[];
  /** The pairs of pieces meeting at an opening in the main sections, with their counts. */
  seen: VanillaPair[];
  /**
   * How many times the game places each piece (by EditorID) in the CELLs read, at its own size
   * (V5 step 3): the pieces it scales (Markarth's interiors build with the Dwemer kit at 0.75)
   * are not counted, nor are the CELLs with too few kit pieces.
   */
  used: Record<string, number>;
}

/** A section holds at least this many pieces; fewer are left as off the grid. */
const MIN_SECTION = 3;

const reduce = (v: number, m: number) => {
  const r = ((v % m) + m) % m;
  return Math.round((r > m / 2 ? r - m : r) * 10) / 10;
};

export async function checkVanillaCells(
  store: LevelStore,
  catalogue: Catalogue,
  geometry: JointGeometry,
  options: {
    minTiles?: number;
    onProgress?: (done: number, total: number, cell: string) => void;
  } = {},
): Promise<VanillaReport> {
  const kit = catalogue.kits[0]!;
  const module = kit.module.xy!;
  const zModule = kit.module.z!;
  const pieces = new Map<string, Piece>(catalogue.pieces.map((p) => [p.formKey, p]));
  const types = new Map(catalogue.connectionTypes.map((t) => [t.id, t]));
  const accepted = acceptedOverlaps(catalogue.overlaps ?? []);
  const pairs = new Map<string, { seams: number; mismatches: number }>();
  const seen = new Map<string, VanillaPair>();
  const cells: VanillaCell[] = [];
  const used: Record<string, number> = {};
  const all = await store.listCells();
  for (const [n, cell] of all.entries()) {
    options.onProgress?.(n, all.length, cell.editorId);
    const refs = await store.readRefs(cell.key);
    const placed: PlacedRef[] = refs
      .filter((r) => pieces.has(r.base))
      .map((r) => ({ refFormKey: r.key, base: r.base, pos: r.pos, rot: r.rot, scale: r.scale }));
    if (placed.length < (options.minTiles ?? 15)) continue;
    for (const r of placed) {
      if (Math.abs(r.scale - 1) > 0.001) continue;
      const id = pieces.get(r.base)!.editorId;
      used[id] = (used[id] ?? 0) + 1;
    }

    // sections: the grid derived again on the pieces the previous sections left off it
    const sections: VanillaSection[] = [];
    const outside: Record<string, number> = {};
    let rest = placed;
    let main: ReturnType<typeof deriveGrid> | undefined;
    for (;;) {
      const grid = deriveGrid(rest, pieces, {
        module,
        zModule,
        ...(kit.fineStep ? { fineStep: kit.fineStep } : {}),
      });
      if (grid.tiles.length < MIN_SECTION) {
        for (const o of grid.opaque) outside[o.reason] = (outside[o.reason] ?? 0) + 1;
        outside['off-grid'] = (outside['off-grid'] ?? 0) + grid.tiles.length;
        break;
      }
      main ??= grid;
      const o = grid.anchor.origin;
      const m = main.anchor.origin;
      const names: Record<string, number> = {};
      for (const t of grid.tiles) names[t.pieceEditorId] = (names[t.pieceEditorId] ?? 0) + 1;
      sections.push({
        tiles: grid.tiles.length,
        pieces: names,
        offset: [
          reduce(o[0] - m[0], module),
          reduce(o[1] - m[1], module),
          reduce(o[2] - m[2], zModule),
        ],
      });
      const used = new Set(grid.tiles.map((t) => t.ref.refFormKey));
      const left = rest.filter((r) => !used.has(r.refFormKey));
      // what cannot be on any grid stays out
      for (const op of grid.opaque)
        if (op.reason !== 'off-grid') outside[op.reason] = (outside[op.reason] ?? 0) + 1;
      rest = left.filter((r) =>
        grid.opaque.some((op) => op.reason === 'off-grid' && op.ref.refFormKey === r.refFormKey),
      );
      if (!rest.length) break;
    }
    let open = 0;
    let seams = 0;
    let mismatches = 0;
    if (main) {
      const layout = layoutFromGrid(main, new Map(), accepted);
      for (const [a, b] of meetingPairs(layout, pieces)) {
        const rel = relativePlacement(layout.tiles.get(a)!, layout.tiles.get(b)!);
        const k = `${rel.pieces.join('|')}|${rel.rotation}|${rel.offset.join(',')}`;
        const e = seen.get(k);
        if (e) e.count++;
        else seen.set(k, { ...rel, count: 1 });
      }
      const bad = badJoints(layout, pieces, types, geometry);
      open = openFaces(layout, pieces).length;
      for (const b of bad) {
        const mine = pieces.get(layout.tiles.get(b.tile)!.piece)!.editorId;
        const theirs = b.against
          .map((k) => pieces.get(layout.tiles.get(k)!.piece)!.editorId)
          .join(' + ');
        // a junction between pieces of different shifts (D70) says so, with the shift in units
        const self = layout.tiles.get(b.tile)!.cell;
        const frac = (v: number) => v - Math.floor(v);
        const shifts = b.against.map((k) => {
          const c = layout.tiles.get(k)!.cell;
          return [0, 1, 2].map((i) => {
            const d = frac(c[i]!) - frac(self[i]!);
            const m = i < 2 ? module : zModule;
            return Math.round((d > 0.5 ? d - 1 : d < -0.5 ? d + 1 : d) * m);
          });
        });
        const shifted = shifts.find((d) => d.some((v) => v !== 0));
        const pair =
          `${mine}:${b.opening.dir} vs ${theirs || '(nothing)'}` +
          (shifted ? ` [shifted ${shifted.join(', ')}]` : '');
        const e = pairs.get(pair) ?? { seams: 0, mismatches: 0 };
        if (b.fit === 'seam') {
          e.seams++;
          seams++;
        } else {
          e.mismatches++;
          mismatches++;
        }
        pairs.set(pair, e);
      }
    }
    cells.push({
      key: cell.key,
      editorId: cell.editorId,
      kitTiles: placed.length,
      sections,
      outside,
      open,
      seams,
      mismatches,
    });
  }
  options.onProgress?.(all.length, all.length, '');
  return {
    cells,
    used,
    seen: [...seen.values()],
    pairs: [...pairs]
      .map(([pair, e]) => ({ pair, ...e }))
      .sort((a, b) => b.seams + b.mismatches - a.seams - a.mismatches),
  };
}
