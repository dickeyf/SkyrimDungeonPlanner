<script lang="ts">
  /**
   * Hosts the imperative three.js CellScene: keeps its objects, grid, ghost and selection in
   * sync with the props, and forwards pointer events to the page.
   */
  import { onMount } from 'svelte';
  import {
    CellScene,
    type GridSpec,
    type Highlight,
    type MeshCache,
    type OpaqueDisplay,
    type SceneHandlers,
    type SceneObject,
  } from '$lib/render';
  import { PREF_KEYS, getPref, setPref } from '$lib/fs';

  let {
    objects,
    grid,
    ghost = null,
    highlights = [],
    handlers,
    meshes,
    selected = null,
    fitKey,
  }: {
    objects: SceneObject[];
    grid: GridSpec | null;
    ghost?: { object: SceneObject; ok: boolean } | null;
    highlights?: Highlight[];
    handlers: SceneHandlers;
    meshes: () => Promise<MeshCache>;
    selected?: string | null;
    /** The view is re-framed whenever this value changes (a new cell was loaded). */
    fitKey: string;
  } = $props();

  let canvas: HTMLCanvasElement;
  let scene = $state.raw<CellScene | null>(null);
  let status = $state('');
  let opaque = $state<OpaqueDisplay>(
    (getPref(PREF_KEYS.opaqueDisplay) as OpaqueDisplay | undefined) ?? 'faded',
  );
  let fitted = '';

  onMount(() => {
    // handlers are read at event time, so later prop changes are honoured
    const s = new CellScene(canvas, {
      click: (i) => handlers.click(i),
      down: (i) => handlers.down?.(i) ?? false,
      move: (i) => handlers.move?.(i),
      up: (i) => handlers.up?.(i),
    });
    scene = s;
    return () => {
      s.dispose();
      scene = null;
    };
  });

  $effect(() => {
    scene?.setGrid(grid);
  });

  $effect(() => {
    const s = scene;
    const list = objects;
    const key = fitKey;
    if (!s) return;
    void (async () => {
      const started = performance.now();
      const cache = await meshes();
      await s.syncObjects(list, cache);
      s.select(selected);
      if (fitted !== key) {
        fitted = key;
        s.fit();
        status = `${list.length} objects, ${cache.size} distinct meshes, ${(
          (performance.now() - started) /
          1000
        ).toFixed(1)} s`;
      }
    })();
  });

  $effect(() => {
    scene?.select(selected);
  });

  $effect(() => {
    scene?.setHighlights(highlights);
  });

  $effect(() => {
    const s = scene;
    const g = ghost;
    if (!s) return;
    void meshes().then((cache) => s.setGhost(g?.object ?? null, g?.ok ?? true, cache));
  });

  $effect(() => {
    scene?.setOpaqueDisplay(opaque);
    setPref(PREF_KEYS.opaqueDisplay, opaque);
  });
</script>

<div class="view">
  <canvas bind:this={canvas}></canvas>
  <div class="overlay">
    <span>{status}</span>
    <button onclick={() => scene?.fit()}>Fit</button>
    <label>
      Other objects
      <select bind:value={opaque}>
        <option value="visible">visible</option>
        <option value="faded">faded</option>
        <option value="hidden">hidden</option>
      </select>
    </label>
  </div>
</div>

<style>
  .view {
    position: relative;
    height: 78vh;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    border: 1px solid var(--border);
    border-radius: 4px;
    touch-action: none;
  }
  .overlay {
    position: absolute;
    top: 0.4rem;
    left: 0.5rem;
    font-size: 12px;
    color: var(--fg-muted);
    display: flex;
    gap: 0.6rem;
    align-items: center;
  }
</style>
