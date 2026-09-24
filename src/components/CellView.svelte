<script lang="ts">
  /** Hosts the imperative three.js CellScene and feeds it the loaded cell. */
  import { onMount } from 'svelte';
  import { CellScene, sceneGrid, sceneObjects, type OpaqueDisplay } from '$lib/render';
  import { PREF_KEYS, getPref, setPref } from '$lib/fs';
  import type { Catalogue, FormKey } from '$lib/catalogue/types';
  import type { LoadedCell } from '$lib/level';
  import type { MeshCache } from '$lib/render';

  let {
    loaded,
    catalogue,
    models,
    meshes,
    selected = $bindable<string | null>(null),
  }: {
    loaded: LoadedCell;
    catalogue: Catalogue;
    models: ReadonlyMap<FormKey, string>;
    meshes: () => Promise<MeshCache>;
    selected?: string | null;
  } = $props();

  let canvas: HTMLCanvasElement;
  let scene: CellScene | null = null;
  let status = $state('');
  let opaque = $state<OpaqueDisplay>(
    (getPref(PREF_KEYS.opaqueDisplay) as OpaqueDisplay) ?? 'faded',
  );

  onMount(() => {
    scene = new CellScene(canvas, (key) => (selected = key));
    return () => {
      scene?.dispose();
      scene = null;
    };
  });

  // reload the scene whenever another cell is loaded
  $effect(() => {
    const cell = loaded;
    if (!scene) return;
    const s = scene;
    void (async () => {
      const started = performance.now();
      const objects = sceneObjects(cell, catalogue, models);
      s.setGrid(sceneGrid(cell));
      status = `loading meshes 0/${objects.length}`;
      const cache = await meshes();
      const result = await s.setObjects(objects, cache, (done, total) => {
        status = `loading meshes ${done}/${total}`;
      });
      s.fit();
      status = `${result.drawn} meshes (${cache.size} distinct), ${result.markers} markers, ${(
        (performance.now() - started) /
        1000
      ).toFixed(1)} s`;
    })();
  });

  $effect(() => {
    scene?.select(selected);
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
    height: 75vh;
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
