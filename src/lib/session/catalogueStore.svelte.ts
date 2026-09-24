/**
 * Shared catalogue state for the Catalogue and Validation pages: the kit's base objects
 * (step 8) and the mesh analysis (step 9), both cached in IndexedDB. Results are raw state:
 * they are large, immutable and must stay structured-cloneable for the cache.
 */
import { analyseKit, type AnalysisResult } from '$lib/catalogue/analyze';
import { loadKitStats, type KitStatsResult } from '$lib/catalogue/build';
import { IMPERIAL_KIT, type KitDefinition } from '$lib/catalogue/kits';
import { kvGet, kvSet } from '$lib/fs';
import { ArchiveIndex } from '$lib/vfs';
import { session } from './session.svelte';

const ANALYSIS_VERSION = 2; // bump when the analysis output changes shape or meaning

class CatalogueStore {
  readonly kit: KitDefinition = IMPERIAL_KIT;
  stats = $state.raw<KitStatsResult | null>(null);
  analysis = $state.raw<AnalysisResult | null>(null);
  analysisFromCache = $state(false);
  busy = $state(false);
  progress = $state('');
  error = $state('');

  async loadStats(useCache = true): Promise<KitStatsResult | null> {
    if (!session.view) return null;
    return this.run(async () => {
      this.stats = await loadKitStats(session.view!.overlay, this.kit, 'Skyrim.esm', { useCache });
      return this.stats;
    });
  }

  /** Stats then analysis; the analysis is read from cache unless `force`. */
  async analyse(force = false): Promise<AnalysisResult | null> {
    const stats = this.stats ?? (await this.loadStats());
    if (!stats || !session.view) return null;
    const key = `analysis:v${ANALYSIS_VERSION}:${stats.cacheKey}`;
    return this.run(async () => {
      if (!force) {
        const cached = await kvGet<AnalysisResult>(key);
        if (cached) {
          this.analysis = cached;
          this.analysisFromCache = true;
          return cached;
        }
      }
      const index = await ArchiveIndex.build(session.view!.overlay, session.view!.plugins);
      const result = await analyseKit(stats.stats, this.kit, index, (done, total, current) => {
        this.progress = `${done}/${total} ${current}`;
      });
      this.analysis = result;
      this.analysisFromCache = false;
      await kvSet(key, result);
      await kvSet(`catalogue:${this.kit.kit}`, result.catalogue);
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
