<script lang="ts">
  /**
   * The Walkable tab's 3D view (V4): the piece's collision coloured by what the walkable
   * analysis takes each face for, the walkable floor at its height, the visual mesh faint.
   * Read from the current Data view; the scene itself lives in `WalkableScene`.
   */
  import { onDestroy, onMount } from 'svelte';
  import { BufferAttribute, BufferGeometry } from 'three';
  import type { Piece, Vec3 } from '$lib/catalogue/types';
  import { modelArchivePath } from '$lib/format/esp/stat';
  import { NifFile, collisionMesh, mergeShapes } from '$lib/format/nif';
  import type { FaceKind } from '$lib/navmesh/walkable';
  import { FACE_COLORS, WalkableScene } from '$lib/render';
  import { catalogueStore } from '$lib/session/catalogueStore.svelte';

  let { piece, rings }: { piece: Piece; rings: readonly (readonly Vec3[])[] } = $props();

  const KINDS: { kind: FaceKind; label: string; hint: string }[] = [
    {
      kind: 'floor',
      label: 'floor',
      hint: 'flat enough to walk, or a slope no taller than a step',
    },
    { kind: 'lowWall', label: 'low wall', hint: 'nearly vertical, no taller than a step' },
    { kind: 'wall', label: 'wall', hint: 'nearly vertical: blocks its height band' },
    { kind: 'soffit', label: 'soffit', hint: 'nearly vertical, turned down: a wall and a roof' },
    { kind: 'ceiling', label: 'ceiling', hint: 'turned down' },
    { kind: 'obstacle', label: 'obstacle', hint: 'too steep to walk, not a wall' },
  ];

  let host: HTMLDivElement;
  let scene: WalkableScene | null = null;
  let status = $state('');
  let kinds = $state<Record<FaceKind, boolean>>({
    floor: true,
    lowWall: true,
    wall: true,
    soffit: true,
    ceiling: false,
    obstacle: true,
  });
  let visual = $state(false);
  let walkable = $state(true);
  let wireframe = $state(true);

  onMount(() => {
    scene = new WalkableScene(host);
    scene.setBackground(getComputedStyle(host).getPropertyValue('--bg').trim() || '#1e1d24');
  });
  onDestroy(() => scene?.dispose());

  let loading = 0;
  $effect(() => {
    const p = piece;
    const r = rings;
    const ticket = ++loading;
    status = 'loading…';
    void load(p).then((meshes) => {
      if (ticket !== loading || !scene) return;
      scene.setPiece({ ...meshes, rings: r });
      scene.setLayers({ kinds: $state.snapshot(kinds), visual, walkable, wireframe });
      status = meshes.collision ? '' : 'no collision in this mesh';
    });
  });

  $effect(() => {
    scene?.setLayers({ kinds: $state.snapshot(kinds), visual, walkable, wireframe });
  });

  async function load(p: Piece) {
    const index = await catalogueStore.meshIndex();
    const read = await index?.read(modelArchivePath(p.model)).catch(() => undefined);
    if (!read) return { collision: null, visual: null };
    const nif = NifFile.parse(read.bytes);
    const collision = collisionMesh(nif) ?? null;
    const mesh = mergeShapes(nif, { skipAlpha: true });
    let geometry: BufferGeometry | null = null;
    if (mesh.indices.length) {
      geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
      geometry.setIndex(new BufferAttribute(mesh.indices, 1));
      geometry.computeVertexNormals();
    }
    return {
      collision: collision && { positions: collision.positions, indices: collision.indices },
      visual: geometry,
    };
  }
</script>

<div class="view3d">
  <div class="canvas" bind:this={host}></div>
  {#if status}<p class="status">{status}</p>{/if}
  <div class="layers">
    {#each KINDS as k (k.kind)}
      <label title={k.hint}>
        <input type="checkbox" bind:checked={kinds[k.kind]} />
        <span class="swatch" style:background={FACE_COLORS[k.kind]}></span>{k.label}
      </label>
    {/each}
  </div>
  <div class="layers">
    <label><input type="checkbox" bind:checked={walkable} /> walkable floor</label>
    <label><input type="checkbox" bind:checked={wireframe} /> collision edges</label>
    <label><input type="checkbox" bind:checked={visual} /> visual mesh</label>
  </div>
  <p class="hint">
    Drag to turn, right-drag to pan, wheel to zoom. Collision faces coloured by what the walkable
    analysis takes them for; the walkable floor in blue at its height, holes outlined in red.
  </p>
</div>

<style>
  .view3d {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .canvas {
    width: 100%;
    height: 480px;
    border-radius: 4px;
    overflow: hidden;
  }
  .layers {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1rem;
    font-size: 0.9em;
  }
  .layers label {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .swatch {
    display: inline-block;
    width: 0.8em;
    height: 0.8em;
    border-radius: 2px;
  }
  .status,
  .hint {
    margin: 0;
    font-size: 0.85em;
    opacity: 0.75;
  }
</style>
