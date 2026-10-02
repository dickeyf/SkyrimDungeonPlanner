<script lang="ts">
  /**
   * Hosts the imperative three.js CellScene: keeps its objects, grid, ghost and selection in
   * sync with the props, and forwards pointer events to the page.
   */
  import { onMount } from 'svelte';
  import {
    CellScene,
    EYE_HEIGHT,
    type Eye,
    type GridSpec,
    type Highlight,
    type MeshCache,
    type OpaqueDisplay,
    type SceneHandlers,
    type NavLayer,
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
    selection = [],
    navmesh = null,
    fitKey,
  }: {
    objects: SceneObject[];
    grid: GridSpec | null;
    ghost?: { object: SceneObject; ok: boolean } | null;
    highlights?: Highlight[];
    handlers: SceneHandlers;
    meshes: () => Promise<MeshCache>;
    /** Keys of the selected tiles. */
    selection?: readonly string[];
    /** NavMesh layers drawn over the tiles (a preview, the NavMesh being edited). */
    navmesh?: readonly NavLayer[] | null;
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
  /** The inset viewport (V3): its box, whether it is open, and its camera. */
  let insetBox = $state<HTMLDivElement>();
  let insetOpen = $state(getPref(PREF_KEYS.insetOpen) !== '0');
  let eye = $state.raw<Eye | null>(null);

  // ---- walking the camera from the keyboard, once the inset has the focus (W/S, A/D) ----
  /** Walking and turning speeds, in game units and degrees per second. */
  const WALK_SPEED = 320;
  const TURN_SPEED = 100;
  const WALK_KEYS = new Set(['w', 'a', 's', 'd']);
  /** Keys held down (w, a, s, d, shift). */
  let held: string[] = [];
  let walkFrame = 0;
  let walkLast = 0;

  function walkStep(now: number): void {
    const dt = Math.min(0.1, (now - walkLast) / 1000);
    walkLast = now;
    if (eye && scene && held.length) {
      const fast = held.includes('shift') ? 2 : 1;
      const turn = (held.includes('d') ? 1 : 0) - (held.includes('a') ? 1 : 0);
      const move = (held.includes('w') ? 1 : 0) - (held.includes('s') ? 1 : 0);
      const heading = eye.heading + (turn * TURN_SPEED * fast * dt * Math.PI) / 180;
      const step = move * WALK_SPEED * fast * dt;
      const [x0, y0, z0] = eye.pos;
      const x = x0 + Math.sin(heading) * step;
      const y = y0 + Math.cos(heading) * step;
      // a little above the floor under the camera: up a ramp, down a step, not through a ceiling
      const floor = move ? scene.floorAt(x, y, z0 + 64) : undefined;
      eye = { heading, pos: [x, y, floor === undefined ? z0 : floor + EYE_HEIGHT] };
    }
    walkFrame = held.length ? requestAnimationFrame(walkStep) : 0;
  }

  function walkKey(e: KeyboardEvent, down: boolean): void {
    const key = e.key.toLowerCase();
    if (e.key === 'Shift') {
      held = down ? [...new Set([...held, 'shift'])] : held.filter((k) => k !== 'shift');
      return;
    }
    if (!WALK_KEYS.has(key) || e.ctrlKey || e.metaKey || e.altKey) return;
    // the editor's own shortcuts do not see these keys while the inset has the focus
    e.preventDefault();
    e.stopPropagation();
    held = down ? [...new Set([...held, key])] : held.filter((k) => k !== key);
    if (held.length && !walkFrame) {
      walkLast = performance.now();
      walkFrame = requestAnimationFrame(walkStep);
    }
  }

  function stopWalking(): void {
    held = [];
    cancelAnimationFrame(walkFrame);
    walkFrame = 0;
  }

  /** Raise or lower the camera by `dz` game units. */
  function raise(dz: number): void {
    if (eye) eye = { ...eye, pos: [eye.pos[0], eye.pos[1], eye.pos[2] + dz] };
  }

  /** A first camera position: the centre of the cell, at eye level, looking north. */
  function placeEye(s: CellScene): void {
    const c = s.centre();
    if (!c) return;
    const floor = s.floorAt(c[0], c[1], 100000) ?? 0;
    eye = { pos: [c[0], c[1], floor + EYE_HEIGHT], heading: 0 };
  }

  onMount(() => {
    // handlers are read at event time, so later prop changes are honoured
    const s = new CellScene(canvas, {
      click: (i) => handlers.click(i),
      down: (i) => handlers.down?.(i) ?? false,
      move: (i) => handlers.move?.(i),
      up: (i) => handlers.up?.(i),
      eye: (e) => (eye = e),
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
      if (import.meta.env.DEV)
        console.debug(`scene updated in ${(performance.now() - started).toFixed(0)} ms`);
      s.select(selection);
      if (fitted !== key) {
        // an empty list may be a transient state: frame again once objects arrive
        if (list.length) fitted = key;
        s.fit();
        placeEye(s);
        status = `${list.length} objects, ${cache.size} distinct meshes, ${(
          (performance.now() - started) /
          1000
        ).toFixed(1)} s`;
      }
    })();
  });

  $effect(() => {
    scene?.select(selection);
  });

  $effect(() => {
    scene?.setHighlights(highlights);
  });

  $effect(() => {
    scene?.setNavMesh(navmesh);
  });

  $effect(() => {
    const s = scene;
    const g = ghost;
    if (!s) return;
    void meshes().then((cache) => s.setGhost(g?.object ?? null, g?.ok ?? true, cache));
  });

  $effect(() => {
    scene?.setInset(insetOpen ? (insetBox ?? null) : null, eye);
    setPref(PREF_KEYS.insetOpen, insetOpen ? undefined : '0');
  });

  $effect(() => {
    scene?.setOpaqueDisplay(opaque);
    setPref(PREF_KEYS.opaqueDisplay, opaque);
  });
</script>

<div class="view">
  <canvas bind:this={canvas}></canvas>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="inset"
    class:closed={!insetOpen}
    bind:this={insetBox}
    tabindex={insetOpen ? 0 : -1}
    role="application"
    aria-label="Camera view: W and S walk, A and D turn"
    onpointerdown={() => insetBox?.focus()}
    onkeydown={(e) => walkKey(e, true)}
    onkeyup={(e) => walkKey(e, false)}
    onblur={stopWalking}
  >
    <button
      title={insetOpen ? 'Hide the camera view' : 'Show the camera view'}
      onclick={() => (insetOpen = !insetOpen)}>{insetOpen ? '–' : 'Camera'}</button
    >
    {#if insetOpen && eye}
      <div
        class="eye-info"
        title="Drag the yellow disc in the top-down view to move the camera, its handle to turn it; the wheel over the disc raises or lowers it. Click this view, then W / S walk and A / D turn (Shift: faster)"
      >
        <button onclick={() => raise(16)} title="Raise the camera">▲</button>
        <button onclick={() => raise(-16)} title="Lower the camera">▼</button>
        z {Math.round(eye.pos[2])}, heading {Math.round(
          ((eye.heading * 180) / Math.PI + 360) % 360,
        )}°
      </div>
    {/if}
  </div>
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
  /* the camera view is drawn by the scene under this box; the box keeps the pointer off the
     top-down view there */
  .inset {
    position: absolute;
    top: 1px;
    right: 1px;
    width: 33%;
    aspect-ratio: 1;
    max-height: calc(100% - 2px);
    border-left: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  .inset:focus {
    outline: 2px solid #ffd166;
    outline-offset: -2px;
  }
  .inset.closed {
    width: auto;
    aspect-ratio: auto;
    border: none;
  }
  .inset > button {
    position: absolute;
    top: 0.3rem;
    right: 0.3rem;
    font-size: 11px;
    padding: 0.1rem 0.4rem;
  }
  .eye-info {
    position: absolute;
    left: 0.3rem;
    bottom: 0.3rem;
    font-size: 11px;
    color: #ffd166;
    background: rgba(0, 0, 0, 0.45);
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
  }
  .eye-info button {
    font-size: 10px;
    padding: 0 0.3rem;
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
