/**
 * Deep junction check in the editor (R16, V2 step 6): every junction of the loaded layout is
 * checked in the background, one at a time, and its verdict kept by junction key (the same
 * pieces in the same relative placement give the same verdict anywhere). Verdicts persist in
 * IndexedDB, never in the repository: they derive from the game files.
 */
import { SvelteMap } from 'svelte/reactivity';
import type { Vec3 } from '$lib/catalogue/types';
import { modelArchivePath } from '$lib/format/esp/stat';
import { kvGet, kvSet } from '$lib/fs';
import {
  fromSideFrame,
  junctionGaps,
  mergeWorldMeshes,
  placeMesh,
  toSideFrame,
  type JunctionSide,
  type LayoutJunction,
  type Pieces,
  type WorldMesh,
} from '$lib/grid';
import { LeakViewer, type MeshCache } from '$lib/render';

/** Bump when the check changes meaning, so stored verdicts are recomputed. */
const VERDICT_VERSION = 1;
/** Tiles within this distance of a junction are drawn in its views. */
const VIEW_RADIUS = 1536;

export interface Leak {
  /** Centre of the gap in the opening piece's own frame (see `toSideFrame`). */
  centre: Vec3;
  /** Widest distance to the facing tiles, units (capped at four times the search reach). */
  width: number;
  /** Views that see it, over the views kept. */
  seen: number;
  views: number;
}

export interface LeakVerdict {
  leaks: Leak[];
  /** Candidate gaps of the exact check, visible or not. */
  candidates: number;
}

class LeakChecker {
  /** Verdicts by junction key. */
  readonly verdicts = new SvelteMap<string, LeakVerdict>();
  /** Junctions of the current layout already judged, and their count. */
  done = $state(0);
  total = $state(0);
  error = $state('');

  private generation = 0;
  private viewer: LeakViewer | null = null;

  /** The world centre of a leak of junction `j`. */
  leakCentre(j: LayoutJunction, leak: Leak): Vec3 {
    return fromSideFrame(j.mine, leak.centre);
  }

  /** Stop the current run (a new layout is coming, or the editor closes). */
  cancel(): void {
    this.generation++;
  }

  /**
   * Judge the junctions of a layout. Known verdicts apply at once; the others are computed in
   * the background and published as they come. A newer call cancels this one.
   */
  async run(
    junctions: readonly LayoutJunction[],
    sides: readonly JunctionSide[],
    pieces: Pieces,
    meshes: MeshCache,
  ): Promise<void> {
    const generation = ++this.generation;
    this.error = '';
    const keys = [...new Set(junctions.map((j) => j.key))];
    this.total = keys.length;
    const todo = junctions.filter(
      (j, i) => !this.verdicts.has(j.key) && junctions.findIndex((k) => k.key === j.key) === i,
    );
    this.done = keys.length - todo.length;
    const mesh = async (side: JunctionSide): Promise<WorldMesh | null> => {
      const piece = pieces.get(side.piece);
      const g = piece ? await meshes.welded(modelArchivePath(piece.model)) : null;
      return g ? placeMesh(g, side.pos, side.heading) : null;
    };
    for (const j of todo) {
      if (generation !== this.generation) return;
      try {
        const store = `leak:v${VERDICT_VERSION}:${j.key}`;
        let verdict = await kvGet<LeakVerdict>(store);
        if (!verdict) {
          verdict = await this.judge(j, sides, mesh);
          await kvSet(store, verdict);
        }
        if (generation !== this.generation) return;
        this.verdicts.set(j.key, verdict);
      } catch (e) {
        this.error = (e as Error).message;
      }
      this.done++;
      // let the editor breathe between junctions
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  private async judge(
    j: LayoutJunction,
    sides: readonly JunctionSide[],
    mesh: (side: JunctionSide) => Promise<WorldMesh | null>,
  ): Promise<LeakVerdict> {
    const mine = await mesh(j.mine);
    const facing = (await Promise.all(j.facing.map(mesh))).filter((m): m is WorldMesh => !!m);
    if (!mine || facing.length === 0) return { leaks: [], candidates: 0 };
    const { gaps } = junctionGaps(mine, mergeWorldMeshes(facing), j.frame);
    if (gaps.length === 0) return { leaks: [], candidates: 0 };
    const cx = j.frame.axis === 0 ? j.frame.plane : (j.frame.uMin + j.frame.uMax) / 2;
    const cy = j.frame.axis === 0 ? (j.frame.uMin + j.frame.uMax) / 2 : j.frame.plane;
    const around = (
      await Promise.all(
        sides.filter((s) => Math.hypot(s.pos[0] - cx, s.pos[1] - cy) <= VIEW_RADIUS).map(mesh),
      )
    ).filter((m): m is WorldMesh => !!m);
    this.viewer ??= new LeakViewer();
    const seen = this.viewer.gaps(around, j.frame, gaps);
    return {
      candidates: gaps.length,
      leaks: gaps.flatMap((g, i) =>
        seen[i]!.seen > 0
          ? [
              {
                centre: toSideFrame(j.mine, g.centre),
                width: g.width,
                seen: seen[i]!.seen,
                views: seen[i]!.views,
              },
            ]
          : [],
      ),
    };
  }
}

export const leakChecker = new LeakChecker();
