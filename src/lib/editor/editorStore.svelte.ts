/**
 * Editor state (Svelte 5 runes): the working plugin opened as a level store, its cells, and
 * the loaded cell's grid view derived with the validated catalogue (step 11); saving edits
 * back into the plugin (step 15).
 */
import { applyAnnotations } from '$lib/catalogue/annotations';
import type { Catalogue } from '$lib/catalogue/types';
import { PREF_KEYS, ensureAccess, getPref, lastCellPref, readAll, setPref } from '$lib/fs';
import type { LevelEdit } from '$lib/level';
import {
  EspLevelStore,
  createPluginFile,
  loadCell,
  mastersFor,
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
import { newPluginBytes } from '$lib/format/esp';
import { MeshCache } from '$lib/render';
import { ArchiveIndex, type Layer, type OverlayFileInfo } from '$lib/vfs';

/** Where a new plugin goes: an enabled mod folder of the Data view, or a new MO2 mod. */
export type PluginTarget = { kind: 'layer'; layer: Layer } | { kind: 'new-mod'; modName: string };

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

  /**
   * Masters of a new plugin: Skyrim.esm and every plugin that provides a catalogue piece, in
   * load order, so any piece can be placed.
   */
  private async newPluginMasters(): Promise<string[]> {
    const catalogue = this.catalogue ?? (await this.finalCatalogue());
    return mastersFor(
      catalogue.pieces.map((p) => p.formKey),
      session.view?.plugins ?? ['Skyrim.esm'],
    );
  }

  /**
   * Create an empty plugin and make it the working plugin. In a new MO2 mod folder, the mod
   * must first be enabled in MO2 before the Data view (and the game) can see it.
   */
  async createPlugin(name: string, target: PluginTarget): Promise<void> {
    await this.run(async () => {
      const view = session.view;
      if (!view) throw new Error('no Data view');
      const fileName = /\.esp$/i.test(name) ? name : `${name}.esp`;
      if (!/^[\w .'-]+\.esp$/i.test(fileName))
        throw new Error(`"${fileName}" is not a valid file name`);
      if (this.plugins.some((p) => p.name.toLowerCase() === fileName.toLowerCase()))
        throw new Error(`${fileName} already exists in the Data view`);
      const bytes = newPluginBytes({ masters: await this.newPluginMasters() });
      if (target.kind === 'layer') {
        await createPluginFile(target.layer.dir, fileName, bytes);
        view.overlay.invalidate();
        await this.listPlugins();
        this.busy = false;
        await this.openPlugin(fileName);
        this.message = `created ${fileName} in ${target.layer.name}; enable it in your mod manager for the game and the CK`;
        return;
      }
      if (!view.mo2) throw new Error('a new mod folder needs an MO2 instance');
      if (!/^[\w .'()-]+$/.test(target.modName))
        throw new Error(`"${target.modName}" is not a valid folder name`);
      const dir = await view.mo2.layout.modsDir.getDirectoryHandle(target.modName, {
        create: true,
      });
      await createPluginFile(dir, fileName, bytes);
      setPref(PREF_KEYS.workPlugin, fileName);
      this.message =
        `created mods/${target.modName}/${fileName}. In MO2: refresh (F5), enable the mod ` +
        `"${target.modName}" and the plugin, then click "Reload MO2 profile" here.`;
    });
  }

  /**
   * Add an empty interior cell to the working plugin and write it at once (backup, same
   * checks as a save), then load it.
   */
  async addCell(editorId: string): Promise<void> {
    let key = '';
    await this.run(async () => {
      if (!this.source) throw new Error('no working plugin');
      const { info, stamp } = this.source;
      const dir = info.layer.dir as unknown as FileSystemHandle;
      if ('requestPermission' in dir && !(await ensureAccess(dir, 'readwrite')))
        throw new Error(`write access to ${info.layer.name} was refused`);
      const store = EspLevelStore.parse(await readAll(info.handle), info.name);
      key = await store.addCell(editorId);
      const result = await savePlugin({
        dir: info.layer.dir,
        name: info.name,
        loaded: stamp,
        bytes: store.serialize(),
      });
      this.source = { info, stamp: result.stamp };
      this.store = EspLevelStore.parse(await readAll(info.handle), info.name);
      this.cells = await this.store.listCells();
      this.message = `added cell ${editorId} to ${info.name}; backup ${result.backup}`;
    });
    if (key) await this.openCell(key);
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

  /** The cell to open first in the working plugin: the last one opened, else the first. */
  get initialCell(): string | undefined {
    if (!this.store) return undefined;
    const last = getPref(lastCellPref(this.store.name));
    return this.cells.find((c) => c.key === last)?.key ?? this.cells[0]?.key;
  }

  async openCell(key: string): Promise<void> {
    await this.run(async () => {
      if (!this.store) throw new Error('no working plugin');
      const catalogue = await this.finalCatalogue();
      const started = performance.now();
      this.loaded = await loadCell(this.store, key, catalogue);
      this.selected = null;
      setPref(lastCellPref(this.store.name), key);
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
