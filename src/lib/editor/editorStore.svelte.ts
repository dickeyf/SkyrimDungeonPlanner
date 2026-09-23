/**
 * Editor state (Svelte 5 runes): the working plugin opened as a level store, its cells, and
 * the loaded cell's grid view derived with the validated catalogue (step 11).
 */
import { applyAnnotations } from '$lib/catalogue/annotations';
import type { Catalogue } from '$lib/catalogue/types';
import { PREF_KEYS, getPref, readAll, setPref } from '$lib/fs';
import {
  EspLevelStore,
  loadCell,
  type LevelCell,
  type LevelStore,
  type LoadedCell,
} from '$lib/level';
import { annotationStore } from '$lib/session/annotationStore.svelte';
import { catalogueStore } from '$lib/session/catalogueStore.svelte';
import { session } from '$lib/session/session.svelte';
import type { OverlayFileInfo } from '$lib/vfs';

class EditorStore {
  plugins = $state.raw<OverlayFileInfo[]>([]);
  store = $state.raw<LevelStore | null>(null);
  cells = $state.raw<LevelCell[]>([]);
  loaded = $state.raw<LoadedCell | null>(null);
  catalogue = $state.raw<Catalogue | null>(null);
  busy = $state(false);
  message = $state('');
  error = $state('');

  /** Plugins visible through the Data view that can be worked on (.esp, ESL refused on open). */
  async listPlugins(): Promise<OverlayFileInfo[]> {
    if (!session.view) return [];
    this.plugins = await session.view.overlay.listFiles('', { suffix: '.esp' });
    return this.plugins;
  }

  get rememberedPlugin(): string | undefined {
    return getPref(PREF_KEYS.workPlugin);
  }

  async openPlugin(name = this.rememberedPlugin): Promise<void> {
    if (!name) return;
    await this.run(async () => {
      const plugins = this.plugins.length ? this.plugins : await this.listPlugins();
      const info = plugins.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (!info) throw new Error(`${name} is not visible in the Data view`);
      const store = EspLevelStore.parse(await readAll(info.handle), info.name);
      this.store = store;
      this.cells = await store.listCells();
      this.loaded = null;
      setPref(PREF_KEYS.workPlugin, info.name);
      this.message = `${info.name} (${info.layer.name}): ${this.cells.length} interior cells`;
    });
  }

  /** The analysed catalogue with the committed annotations applied. */
  async finalCatalogue(): Promise<Catalogue> {
    const analysis = catalogueStore.analysis ?? (await catalogueStore.analyse(false));
    if (!analysis) throw new Error(catalogueStore.error || 'catalogue analysis unavailable');
    this.catalogue = applyAnnotations(analysis.catalogue, annotationStore.current).catalogue;
    return this.catalogue;
  }

  async openCell(key: string): Promise<void> {
    await this.run(async () => {
      if (!this.store) throw new Error('no working plugin');
      const catalogue = await this.finalCatalogue();
      const started = performance.now();
      this.loaded = await loadCell(this.store, key, catalogue);
      this.message = `cell loaded in ${(performance.now() - started).toFixed(0)} ms`;
    });
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.busy = true;
    this.error = '';
    try {
      await fn();
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }
}

export const editorStore = new EditorStore();
