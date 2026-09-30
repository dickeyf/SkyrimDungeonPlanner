/**
 * Texture continuity in the editor (V2 step 7, optional, off by default): texture breaks of
 * junctions, by junction key (the same pieces in the same relative placement break the same
 * way anywhere). Cheap once the meshes are read, so verdicts are only kept in memory.
 */
import { SvelteMap } from 'svelte/reactivity';
import { modelArchivePath } from '$lib/format/esp/stat';
import { getPref, setPref } from '$lib/fs';
import {
  placeTextured,
  textureBreaks,
  type JunctionSide,
  type LayoutJunction,
  type Pieces,
  type TextureBreak,
  type TexturedMesh,
} from '$lib/grid';
import type { MeshCache } from '$lib/render';

const PREF = 'textureCheck';

class TextureChecker {
  /** The "Texture continuity check" option, remembered in the browser. */
  enabled = $state(getPref(PREF) === '1');
  /** Breaks by junction key; an empty list is a continuous junction. */
  readonly verdicts = new SvelteMap<string, TextureBreak[]>();

  private pending = new Set<string>();

  setEnabled(on: boolean): void {
    this.enabled = on;
    setPref(PREF, on ? '1' : undefined);
  }

  /** Judge the junctions not known yet, publishing each verdict as it comes. */
  async request(
    junctions: readonly LayoutJunction[],
    pieces: Pieces,
    meshes: MeshCache,
  ): Promise<void> {
    const todo = junctions.filter((j) => !this.verdicts.has(j.key) && !this.pending.has(j.key));
    for (const j of todo) this.pending.add(j.key);
    const mesh = async (side: JunctionSide): Promise<TexturedMesh | null> => {
      const piece = pieces.get(side.piece);
      const m = piece ? await meshes.merged(modelArchivePath(piece.model)) : null;
      return m ? placeTextured(m, side.pos, side.heading) : null;
    };
    for (const j of todo) {
      try {
        const mine = await mesh(j.mine);
        const facing = (await Promise.all(j.facing.map(mesh))).filter(
          (m): m is TexturedMesh => !!m,
        );
        const breaks = mine ? facing.flatMap((f) => textureBreaks(mine, f, j.frame)) : [];
        this.verdicts.set(j.key, breaks);
      } finally {
        this.pending.delete(j.key);
      }
    }
  }
}

export const textureChecker = new TextureChecker();
