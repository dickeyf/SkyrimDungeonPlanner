/**
 * The texture breaks the game's junctions show (V5 step 3c): for a kit, every junction of the
 * master's CELLs (their main grid, as the Vanilla check reads them) is checked for texture
 * breaks, and the signatures of those breaks are counted (once per junction). The ones seen at
 * least `min` times are breaks the game lives with everywhere: they do not show.
 * Measured on the three kits: the check flagged 59 to 81 % of the game's junctions; learnt from
 * half of the CELLs, these signatures leave 0 to 0.3 % of the other half's junctions flagged.
 */
import type { Catalogue, Piece } from '../catalogue/types';
import type { MergedMesh } from '../format/nif/geometry';
import { deriveGrid } from '../grid/derive';
import { layoutFromGrid } from '../grid/edit';
import { layoutJunctions, type JunctionSide } from '../grid/leaks';
import { breakSignature, placeTextured, textureBreaks, type TexturedMesh } from '../grid/textures';
import type { LevelStore } from './store';

export async function gameBreakSignatures(
  store: LevelStore,
  catalogue: Catalogue,
  mesh: (model: string) => Promise<MergedMesh | null>,
  options: { min: number; minTiles?: number; onProgress?: (done: number, total: number) => void },
): Promise<string[]> {
  const kit = catalogue.kits[0]!;
  const pieces = new Map<string, Piece>(catalogue.pieces.map((p) => [p.formKey, p]));
  const types = new Map(catalogue.connectionTypes.map((t) => [t.id, t]));
  const byJunction = new Map<string, string[]>();
  const counts = new Map<string, number>();
  const side = async (s: JunctionSide): Promise<TexturedMesh | null> => {
    const piece = pieces.get(s.piece);
    const m = piece ? await mesh(piece.model) : null;
    return m ? placeTextured(m, s.pos, s.heading) : null;
  };
  const cells = await store.listCells();
  for (const [n, cell] of cells.entries()) {
    options.onProgress?.(n, cells.length);
    const refs = (await store.readRefs(cell.key))
      .filter((r) => pieces.has(r.base))
      .map((r) => ({ refFormKey: r.key, base: r.base, pos: r.pos, rot: r.rot, scale: r.scale }));
    if (refs.length < (options.minTiles ?? 15)) continue;
    const grid = deriveGrid(refs, pieces, {
      module: kit.module.xy!,
      zModule: kit.module.z!,
      ...(kit.fineStep ? { fineStep: kit.fineStep } : {}),
    });
    const layout = layoutFromGrid(grid, new Map());
    for (const j of layoutJunctions(layout, pieces, types, grid.anchor)) {
      if (!j.facing.length) continue;
      let sigs = byJunction.get(j.key);
      if (!sigs) {
        const mine = await side(j.mine);
        const facing = (await Promise.all(j.facing.map(side))).filter(
          (m): m is TexturedMesh => !!m,
        );
        const breaks = mine ? facing.flatMap((f) => textureBreaks(mine, f, j.frame)) : [];
        sigs = [...new Set(breaks.map(breakSignature))];
        byJunction.set(j.key, sigs);
      }
      for (const s of sigs) counts.set(s, (counts.get(s) ?? 0) + 1);
    }
  }
  return [...counts]
    .filter(([, c]) => c >= options.min)
    .map(([s]) => s)
    .sort();
}
