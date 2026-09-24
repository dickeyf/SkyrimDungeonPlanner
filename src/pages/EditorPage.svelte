<script lang="ts">
  /**
   * Step 13: edit a cell's tiles. Pure editing logic lives in $lib/grid/edit; this page wires
   * it to the scene (pointer events), the keyboard and the piece palette. Nothing is written
   * to the plugin until step 15.
   */
  import { onMount } from 'svelte';
  import CellView from '../components/CellView.svelte';
  import type { Catalogue, FormKey, Piece, PieceCategory } from '$lib/catalogue/types';
  import { editorStore as ed } from '$lib/editor/editorStore.svelte';
  import {
    addTile,
    cellAt,
    changeCount,
    changes,
    commit,
    conflictsFor,
    footprintCells,
    historyOf,
    layoutFromGrid,
    moveTile,
    redo,
    removeTile,
    rotateTile,
    undo,
    type EditResult,
    type History,
    type Layout,
  } from '$lib/grid';
  import type { CellIndex, Vec3 } from '$lib/catalogue/types';
  import { piecesByFormKey, summarizeCell } from '$lib/level';
  import {
    CATEGORY_COLORS,
    layoutObjects,
    sceneGrid,
    tileObject,
    type PointerInfo,
    type SceneHandlers,
  } from '$lib/render';
  import { catalogueStore } from '$lib/session/catalogueStore.svelte';
  import { session } from '$lib/session/session.svelte';

  const emptyCatalogue: Catalogue = { version: 1, kits: [], connectionTypes: [], pieces: [] };

  let cellKey = $state('');
  let history = $state.raw<History | null>(null);
  let original = $state.raw<Layout | null>(null);
  let placing = $state<{ piece: FormKey; rotation: 0 | 1 | 2 | 3 } | null>(null);
  let drag = $state.raw<{ key: string; grab: CellIndex; target: CellIndex } | null>(null);
  let ghost = $state.raw<{ object: ReturnType<typeof tileObject>; ok: boolean } | null>(null);
  let message = $state('');
  let filter = $state('');
  let category = $state<PieceCategory | 'all'>('all');

  onMount(() => {
    if (session.ready && !ed.store && ed.rememberedPlugin) void ed.openPlugin();
  });

  $effect(() => {
    if (!cellKey && ed.cells.length) cellKey = ed.cells[0]!.key;
  });

  // a newly loaded cell starts a fresh edit history
  $effect(() => {
    const loaded = ed.loaded;
    if (!loaded) {
      history = null;
      original = null;
      return;
    }
    const own = new Map(loaded.refs.map((r) => [r.key, r.own]));
    const layout = layoutFromGrid(loaded.grid, own);
    original = layout;
    history = historyOf(layout);
    placing = null;
    drag = null;
    ghost = null;
  });

  const catalogue = $derived(ed.catalogue ?? emptyCatalogue);
  const pieces = $derived(piecesByFormKey(catalogue));
  const anchor = $derived(ed.loaded?.grid.anchor);
  const layout = $derived(history?.present ?? null);
  const models = $derived(
    new Map((catalogueStore.stats?.stats ?? []).map((st) => [st.formKey, st.model])),
  );
  const objects = $derived(
    layout && ed.loaded ? layoutObjects(layout, ed.loaded, catalogue, models) : [],
  );
  const grid = $derived(ed.loaded ? sceneGrid(ed.loaded, 12) : null);
  const summary = $derived(ed.loaded ? summarizeCell(ed.loaded, pieces) : null);
  const pending = $derived(original && layout ? changes(original, layout) : null);
  const selectedTile = $derived(ed.selected ? layout?.tiles.get(ed.selected) : undefined);

  const palette = $derived.by(() => {
    const needle = filter.trim().toLowerCase();
    return catalogue.pieces
      .filter(
        (p) =>
          p.review.validated &&
          (category === 'all' || p.category === category) &&
          (!needle || p.editorId.toLowerCase().includes(needle)),
      )
      .sort((a, b) => a.editorId.localeCompare(b.editorId));
  });

  // ---- editing -----------------------------------------------------------------------------

  const REASONS: Record<string, string> = {
    conflict: 'refused: it would share a cell with another tile (red)',
    'read-only': 'refused: this tile belongs to a master and cannot be edited',
    missing: 'the tile no longer exists',
    'unknown-piece': 'unknown piece',
  };

  function apply(r: EditResult, what: string): boolean {
    if (!history) return false;
    if (!r.ok) {
      message = `${what} ${REASONS[r.reason]}`;
      return false;
    }
    history = commit(history, r.layout);
    message = '';
    return true;
  }

  const cellUnder = (w: Vec3): CellIndex => [
    Math.floor((w[0] - anchor!.origin[0]) / anchor!.module.xy),
    Math.floor((w[1] - anchor!.origin[1]) / anchor!.module.xy),
    0,
  ];

  function showGhost(piece: Piece, cell: CellIndex, rotation: 0 | 1 | 2 | 3, ignore?: string) {
    if (!layout || !anchor) return;
    const ok =
      conflictsFor(layout, pieces, footprintCells(piece, cell, rotation), ignore).length === 0;
    const object = tileObject(
      { key: 'ghost', piece: piece.formKey, cell, rotation, own: true },
      piece,
      anchor,
    );
    ghost = { object, ok };
  }

  function startPlacing(piece: Piece): void {
    placing = { piece: piece.formKey, rotation: 0 };
    ed.selected = null;
    message = `Placing ${piece.editorId}: click to place, R to rotate, Esc to stop.`;
  }

  function stopPlacing(): void {
    placing = null;
    ghost = null;
    message = '';
  }

  const handlers: SceneHandlers = {
    click(info: PointerInfo) {
      if (placing && layout && anchor) {
        const piece = pieces.get(placing.piece)!;
        const cell = cellAt(info.world, anchor, piece, placing.rotation);
        const r = addTile(layout, pieces, placing.piece, cell, placing.rotation);
        if (apply(r, 'Placement') && r.ok && !info.shift) {
          // keep placing the same piece; Shift+click places and stops
        } else if (r.ok && info.shift) {
          stopPlacing();
          ed.selected = r.key;
        }
        return;
      }
      ed.selected = info.key;
    },
    down(info: PointerInfo) {
      if (placing || !layout || !info.key || info.key !== ed.selected) return false;
      const tile = layout.tiles.get(info.key);
      if (!tile?.own) return false;
      const grab = cellUnder(info.world);
      drag = { key: info.key, grab, target: tile.cell };
      return true;
    },
    move(info: PointerInfo) {
      if (!layout || !anchor) return;
      if (placing) {
        const piece = pieces.get(placing.piece)!;
        showGhost(piece, cellAt(info.world, anchor, piece, placing.rotation), placing.rotation);
      } else if (drag) {
        const tile = layout.tiles.get(drag.key)!;
        const now = cellUnder(info.world);
        const target: CellIndex = [
          tile.cell[0] + now[0] - drag.grab[0],
          tile.cell[1] + now[1] - drag.grab[1],
          tile.cell[2],
        ];
        drag = { ...drag, target };
        showGhost(pieces.get(tile.piece)!, target, tile.rotation, tile.key);
      }
    },
    up() {
      if (drag && layout) {
        const tile = layout.tiles.get(drag.key)!;
        const same = drag.target.every((v, i) => v === tile.cell[i]);
        if (!same) apply(moveTile(layout, pieces, drag.key, drag.target), 'Move');
      }
      drag = null;
      ghost = null;
    },
  };

  function rotateSelected(turns: 1 | -1): void {
    if (layout && ed.selected) apply(rotateTile(layout, pieces, ed.selected, turns), 'Rotation');
  }

  function deleteSelected(): void {
    if (layout && ed.selected && apply(removeTile(layout, ed.selected), 'Deletion')) {
      ed.selected = null;
    }
  }

  function onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
    if (!history) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) {
      history = undo(history);
      ghost = null;
    } else if ((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey))) {
      history = redo(history);
      ghost = null;
    } else if (key === 'r') {
      const turns = e.shiftKey ? -1 : 1;
      if (placing) {
        placing = { ...placing, rotation: ((placing.rotation + turns + 4) % 4) as 0 | 1 | 2 | 3 };
        ghost = null;
      } else rotateSelected(turns);
    } else if (key === 'delete' || key === 'backspace') {
      deleteSelected();
    } else if (key === 'escape') {
      if (placing) stopPlacing();
      else ed.selected = null;
    } else return;
    e.preventDefault();
  }

  const COLORS: Record<string, string> = CATEGORY_COLORS;
</script>

<svelte:window onkeydown={onKey} />

<section>
  {#if !session.ready}
    <p class="warn">Configure the game folder first (<a href="#/setup">Setup</a>).</p>
  {:else if !ed.store}
    <p class="warn">
      Choose the working plugin in <a href="#/setup">Setup</a>.
      {#if ed.busy}<span>opening...</span>{/if}
      {#if ed.error}<span class="err">{ed.error}</span>{/if}
    </p>
  {:else}
    <div class="toolbar">
      <b>{ed.store.name}</b>
      <select bind:value={cellKey} disabled={ed.busy}>
        {#each ed.cells as c (c.key)}
          <option value={c.key}>{c.editorId} ({c.placedCount} placed)</option>
        {/each}
      </select>
      <button disabled={ed.busy || !cellKey} onclick={() => ed.openCell(cellKey)}>Load cell</button>
      {#if history}
        <button disabled={!history.past.length} onclick={() => (history = undo(history!))}
          >Undo</button
        >
        <button disabled={!history.future.length} onclick={() => (history = redo(history!))}
          >Redo</button
        >
      {/if}
      {#if pending && changeCount(pending)}
        <span class="warn">
          unsaved: {pending.added.length} added, {pending.moved.length} moved, {pending.removed
            .length} removed
        </span>
      {/if}
      {#if ed.busy}<span>{catalogueStore.progress || 'working...'}</span>{/if}
      {#if ed.error}<span class="err">{ed.error}</span>{/if}
    </div>

    {#if ed.loaded && layout && summary}
      <div class="cols">
        <aside>
          <div class="selection">
            {#if placing}
              <b>Placing {pieces.get(placing.piece)?.editorId}</b>, rotation {placing.rotation *
                90}°<br />
              <span class="hint"
                >Click to place (Shift+click: place and stop), R / Shift+R to rotate, Esc to stop.</span
              >
            {:else if selectedTile}
              <b>{pieces.get(selectedTile.piece)?.editorId}</b>
              {selectedTile.origin ? '' : '(new)'}<br />
              cell {selectedTile.cell.join(', ')}, rotation {selectedTile.rotation * 90}°<br />
              {#if selectedTile.own}
                <button onclick={() => rotateSelected(1)}>Rotate (R)</button>
                <button onclick={deleteSelected}>Delete (Del)</button>
                <div class="hint">Drag the selected tile to move it.</div>
              {:else}
                <span class="hint">Master tile: read-only.</span>
              {/if}
            {:else}
              <span class="hint"
                >Click a tile to select it, or a piece below to place it. Drag to pan, wheel to
                zoom, Ctrl+Z / Ctrl+Y to undo / redo.</span
              >
            {/if}
            {#if message}<div class="warn">{message}</div>{/if}
          </div>

          <div class="palette">
            <div class="filters">
              <input placeholder="search pieces" bind:value={filter} />
              <select bind:value={category}>
                <option value="all">all</option>
                <option value="hall">hall</option>
                <option value="room">room</option>
                <option value="door">door</option>
              </select>
            </div>
            <ul>
              {#each palette as p (p.formKey)}
                <li>
                  <button
                    class:active={placing?.piece === p.formKey}
                    onclick={() => startPlacing(p)}
                  >
                    <span class="swatch" style:background={COLORS[p.category] ?? '#999'}></span>
                    {p.editorId}
                    <span class="hint"
                      >{new Set(p.cells.map((c) => c[0])).size}x{new Set(p.cells.map((c) => c[1]))
                        .size}</span
                    >
                  </button>
                </li>
              {/each}
            </ul>
          </div>

          <p class="hint">
            {ed.loaded.refs.length} references: {ed.loaded.grid.tiles.length} tiles,
            {ed.loaded.grid.opaque.length} other objects, {ed.loaded.grid.overlaps.length} shared cells
            (tolerated).
          </p>
        </aside>

        <CellView
          {objects}
          {grid}
          {ghost}
          {handlers}
          meshes={() => ed.meshes()}
          selected={ed.selected}
          fitKey={ed.loaded.cell}
        />
      </div>
    {/if}
  {/if}
</section>

<style>
  .hint {
    color: var(--fg-muted);
    font-size: 12px;
  }
  .toolbar {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 0.5rem;
  }
  .cols {
    display: grid;
    grid-template-columns: 20rem 1fr;
    gap: 0.75rem;
    align-items: start;
  }
  .selection {
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.5rem;
    margin-bottom: 0.5rem;
    font-size: 13px;
    min-height: 5.5rem;
  }
  .palette .filters {
    display: flex;
  }
  .palette input {
    flex: 1;
    min-width: 0;
  }
  .palette ul {
    list-style: none;
    padding: 0;
    margin: 0.3rem 0;
    max-height: 50vh;
    overflow: auto;
  }
  .palette li button {
    width: 100%;
    text-align: left;
    margin: 1px 0;
    font-size: 12px;
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .palette li button.active {
    border-color: var(--accent);
    color: var(--accent);
  }
  .swatch {
    display: inline-block;
    width: 0.7rem;
    height: 0.7rem;
    flex: none;
  }
</style>
