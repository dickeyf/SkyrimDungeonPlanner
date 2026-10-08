/**
 * Shared catalogue state for the Catalogue and Validation pages: each kit's base objects
 * (step 8) and mesh analysis (step 9), both cached in IndexedDB, kept per kit (V4, D68). The
 * pages work on the chosen kit (`kit`); the editor asks for the kit it needs. Results are raw
 * state: they are large, immutable and must stay structured-cloneable for the cache.
 */
import { analyseKit, type AnalysisResult } from '$lib/catalogue/analyze';
import { loadKitStats, type KitStatsResult } from '$lib/catalogue/build';
import { IMPERIAL_KIT, KITS, type KitDefinition } from '$lib/catalogue/kits';
import type { ProfileFit } from '$lib/grid';
import { kvGet, kvSet } from '$lib/fs';
import { ArchiveIndex } from '$lib/vfs';
import { session } from './session.svelte';

const ANALYSIS_VERSION = 13; // bump when the analysis output changes shape or meaning

class CatalogueStore {
  /** The kit the Catalogue and Validation pages show. */
  kit = $state.raw<KitDefinition>(IMPERIAL_KIT);
  private statsByKit = $state.raw<Record<string, KitStatsResult>>({});
  private analysisByKit = $state.raw<Record<string, AnalysisResult>>({});
  private fromCacheByKit = $state.raw<Record<string, boolean>>({});
  busy = $state(false);
  progress = $state('');
  error = $state('');

  get stats(): KitStatsResult | null {
    return this.statsOf(this.kit);
  }

  get analysis(): AnalysisResult | null {
    return this.analysisOf(this.kit);
  }

  get analysisFromCache(): boolean {
    return this.fromCacheByKit[this.kit.kit] ?? false;
  }

  private fits: { key: string; map: Map<string, ProfileFit>; saved: number } | null = null;
  private fitsTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * The junction profile verdicts of the analyses loaded (V4 step 11), kept in the browser like
   * the analysis: a first click on an open face compared hundreds of profile pairs; once compared,
   * a pair is read back, even after a reload. Tied to the analyses, so a new analysis starts empty.
   */
  async profileFits(): Promise<Map<string, ProfileFit>> {
    const key = `fits:v${ANALYSIS_VERSION}:${KITS.map((k) => this.statsOf(k)?.cacheKey ?? '-').join('+')}`;
    if (this.fits?.key !== key) {
      const stored = await kvGet<[string, ProfileFit][]>(key).catch(() => undefined);
      const map = new Map(stored ?? []);
      this.fits = { key, map, saved: map.size };
    }
    return this.fits.map;
  }

  /** Save the verdicts computed since the last save, a few seconds after the last change. */
  saveProfileFits(): void {
    clearTimeout(this.fitsTimer);
    this.fitsTimer = setTimeout(() => {
      const fits = this.fits;
      if (!fits || fits.map.size === fits.saved) return;
      fits.saved = fits.map.size;
      void kvSet(fits.key, [...fits.map]).catch(() => undefined);
    }, 3000);
  }

  statsOf(kit: KitDefinition): KitStatsResult | null {
    return this.statsByKit[kit.kit] ?? null;
  }

  analysisOf(kit: KitDefinition): AnalysisResult | null {
    return this.analysisByKit[kit.kit] ?? null;
  }

  private indexOf: { view: unknown; index: Promise<ArchiveIndex> } | null = null;

  /** The meshes of the current Data view, built once per view (the analysis, the 3D views). */
  meshIndex(): Promise<ArchiveIndex> | null {
    const view = session.view;
    if (!view) return null;
    if (this.indexOf?.view !== view)
      this.indexOf = { view, index: ArchiveIndex.build(view.overlay, view.plugins) };
    return this.indexOf.index;
  }

  async loadStats(useCache = true, kit = this.kit): Promise<KitStatsResult | null> {
    if (!session.view) return null;
    return this.run(async () => {
      const stats = await loadKitStats(session.view!.overlay, kit, 'Skyrim.esm', { useCache });
      this.statsByKit = { ...this.statsByKit, [kit.kit]: stats };
      return stats;
    });
  }

  /** Stats then analysis; the analysis is read from cache unless `force`. */
  async analyse(force = false, kit = this.kit): Promise<AnalysisResult | null> {
    const stats = this.statsOf(kit) ?? (await this.loadStats(true, kit));
    if (!stats || !session.view) return null;
    const key = `analysis:v${ANALYSIS_VERSION}:${stats.cacheKey}`;
    return this.run(async () => {
      if (!force) {
        const cached = await kvGet<AnalysisResult>(key);
        if (cached) {
          this.analysisByKit = { ...this.analysisByKit, [kit.kit]: cached };
          this.fromCacheByKit = { ...this.fromCacheByKit, [kit.kit]: true };
          return cached;
        }
      }
      const index = await this.meshIndex()!;
      const result = await analyseKit(stats.stats, kit, index, (done, total, current) => {
        this.progress = `${done}/${total} ${current}`;
      });
      this.analysisByKit = { ...this.analysisByKit, [kit.kit]: result };
      this.fromCacheByKit = { ...this.fromCacheByKit, [kit.kit]: false };
      await kvSet(key, result);
      await kvSet(`catalogue:${kit.kit}`, result.catalogue);
      return result;
    });
  }

  private async run<T>(fn: () => Promise<T>): Promise<T | null> {
    this.busy = true;
    this.error = '';
    try {
      return await fn();
    } catch (e) {
      this.error = (e as Error).message;
      return null;
    } finally {
      this.busy = false;
      this.progress = '';
    }
  }
}

export const catalogueStore = new CatalogueStore();
