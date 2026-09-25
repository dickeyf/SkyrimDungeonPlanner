/**
 * Editor state (Svelte 5 runes): the working plugin opened as a level store, its cells, and
 * the loaded cell's grid view derived with the validated catalogue (step 11); saving edits
 * back into the plugin (step 15).
 */
import { applyAnnotations } from '$lib/catalogue/annotations';
import type { Catalogue } from '$lib/catalogue/types';
import { PREF_KEYS, ensureAccess, getPref, readAll, setPref } from '$lib/fs';
import type { LevelEdit } from '$lib/level';
import {
  EspLevelStore,
  loadCell,
  savePlugin,
  stampOf,
  type FileStamp,
  type LevelCell,
  type LevelStore,
  type LoadedCell,
} from '$lib/level';
import { annotationStore } from '$lib/session/annotationStore.svelte';
import { catalogueStore } from '$lib/session/catalogueStore.svelte';
import { session } from '$lib/session/session.svelte';
import { MeshCache } from '$lib/render';
import { ArchiveIndex, type OverlayFileInfo } from '$lib/vfs';

class EditorStore {
  plugins = $state.raw<OverlayFileInfo[]>([]);
  store = $state.raw<LevelStore | null>(null);
  cells = $state.raw<LevelCell[]>([]);
  loaded = $state.raw<LoadedCell | null>(null);
  catalogue = $state.raw<Catalogue | null>(null);
  selected = $state<string | null>(null);
  busy = $state(false);
  /** Where the working plugin lives and what it looked like when loaded, for the save. */
  private source: { info: OverlayFileInfo; stamp: FileStamp } | null = null;
  private meshCache: MeshCache | null = null;
  private meshCacheView: unknown = null;
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
      const stamp = await stampOf(info.layer.dir, info.name);
      const store = EspLevelStore.parse(await readAll(info.handle), info.name);
      this.store = store;
      this.source = { info, stamp };
      this.cells = await store.listCells();
      this.loaded = null;
      setPref(PREF_KEYS.workPlugin, info.name);
      this.message = `${info.name} (${info.layer.name}): ${this.cells.length} interior cells`;
    });
  }

  /** Mesh cache for the current Data view; rebuilt when the view (profile) changes. */
  async meshes(): Promise<MeshCache> {
    if (!session.view) throw new Error('no Data view');
    if (!this.meshCache || this.meshCacheView !== session.view) {
      this.meshCache?.dispose();
      const index = await ArchiveIndex.build(session.view.overlay, session.view.plugins);
      this.meshCache = new MeshCache(index);
      this.meshCacheView = session.view;
    }
    return this.meshCache;
  }

  /** The analysed catalogue with the committed annotations applied. */
  async finalCatalogue(): Promise<Catalogue> {
    const analysis = catalogueStore.analysis ?? (await catalogueStore.analyse(false));
    if (!analysis) throw new Error(catalogueStore.error || 'catalogue analysis unavailable');
    this.catalogue = applyAnnotations(analysis.catalogue, annotationStore.current).catalogue;
    return this.catalogue;
  }

  /** Re-apply the current annotations after an edit made from the editor. */
  refreshCatalogue(): void {
    const analysis = catalogueStore.analysis;
    if (analysis)
      this.catalogue = applyAnnotations(analysis.catalogue, annotationStore.current).catalogue;
  }

  async openCell(key: string): Promise<void> {
    await this.run(async () => {
      if (!this.store) throw new Error('no working plugin');
      const catalogue = await this.finalCatalogue();
      const started = performance.now();
      this.loaded = await loadCell(this.store, key, catalogue);
      this.selected = null;
      this.message = `cell loaded in ${(performance.now() - started).toFixed(0)} ms`;
    });
  }

  /**
   * Write edits of the loaded cell into the plugin (V5): the file is read again, the edits
   * applied to it, a timestamped backup made and the plugin replaced (see level/save.ts).
   * The cell is then reloaded, so the edit history restarts from what is on disk. Must run
   * from a user gesture (write permission may be asked).
   */
  async save(edits: readonly LevelEdit[]): Promise<boolean> {
    let ok = false;
    await this.run(async () => {
      const cell = this.loaded?.cell;
      if (!this.source || !cell) throw new Error('no cell loaded');
      if (!edits.length) return;
      const { info, stamp } = this.source;
      const dir = info.layer.dir as unknown as FileSystemHandle;
      if ('requestPermission' in dir && !(await ensureAccess(dir, 'readwrite')))
        throw new Error(`write access to ${info.layer.name} was refused`);
      const store = EspLevelStore.parse(await readAll(info.handle), info.name);
      const added = await store.applyEdits(cell, edits);
      const result = await savePlugin({
        dir: info.layer.dir,
        name: info.name,
        loaded: stamp,
        bytes: store.serialize(),
      });
      this.source = { info, stamp: result.stamp };
      this.store = EspLevelStore.parse(await readAll(info.handle), info.name);
      this.cells = await this.store.listCells();
      this.loaded = await loadCell(
        this.store,
        cell,
        this.catalogue ?? (await this.finalCatalogue()),
      );
      this.selected = null;
      const count = (kind: LevelEdit['kind']) => edits.filter((e) => e.kind === kind).length;
      this.message =
        `saved ${info.name}: ${added.length} added, ${count('move')} moved, ` +
        `${count('remove')} removed; backup ${result.backup} (in ${info.layer.name}). ` +
        'Reload the plugin in the Creation Kit before editing it there.';
      ok = true;
    });
    return ok;
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
