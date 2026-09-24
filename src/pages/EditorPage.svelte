<script lang="ts">
  /**
   * Step 11: open a cell of the working plugin and show what the grid derivation recognizes.
   * The 3D view and the editing tools come with steps 12 to 14.
   */
  import { onMount } from 'svelte';
  import CellView from '../components/CellView.svelte';
  import { editorStore as ed } from '$lib/editor/editorStore.svelte';
  import { CATEGORY_COLORS } from '$lib/render';
  import type { Catalogue } from '$lib/catalogue/types';
  import { piecesByFormKey, summarizeCell } from '$lib/level';
  import { catalogueStore } from '$lib/session/catalogueStore.svelte';
  import { session } from '$lib/session/session.svelte';

  let cellKey = $state('');
  const emptyCatalogue: Catalogue = { version: 1, kits: [], connectionTypes: [], pieces: [] };

  onMount(() => {
    if (session.ready && !ed.store && ed.rememberedPlugin) void ed.openPlugin();
  });

  $effect(() => {
    if (!cellKey && ed.cells.length) cellKey = ed.cells[0]!.key;
  });

  const pieceOf = $derived(piecesByFormKey(ed.catalogue ?? emptyCatalogue));
  const statName = $derived(
    new Map((catalogueStore.stats?.stats ?? []).map((s) => [s.formKey, s.editorId])),
  );
  const summary = $derived(ed.loaded ? summarizeCell(ed.loaded, pieceOf) : null);

  const models = $derived(
    new Map((catalogueStore.stats?.stats ?? []).map((st) => [st.formKey, st.model])),
  );
  const selectedTile = $derived(
    ed.loaded && ed.selected
      ? ed.loaded.grid.tiles.find((t) => t.ref.refFormKey === ed.selected)
      : undefined,
  );
  const selectedOwn = $derived(
    selectedTile ? ed.loaded!.refs.find((r) => r.key === selectedTile.ref.refFormKey)?.own : false,
  );

  const COLORS: Record<string, string> = CATEGORY_COLORS;
</script>

<section>
  <h2>Editor</h2>
  {#if !session.ready}
    <p class="warn">Configure the game folder first (<a href="#/setup">Setup</a>).</p>
  {:else if !ed.store}
    <p class="warn">
      Choose the working plugin in <a href="#/setup">Setup</a>.
      {#if ed.busy}<span>opening...</span>{/if}
      {#if ed.error}<span class="err">{ed.error}</span>{/if}
    </p>
  {:else}
    <p>
      <b>{ed.store.name}</b>
      <span class="hint">{ed.message}</span>
    </p>
    <p>
      <label>
        Cell
        <select bind:value={cellKey} disabled={ed.busy}>
          {#each ed.cells as c (c.key)}
            <option value={c.key}
              >{c.editorId} {c.name ? `"${c.name}"` : ''} ({c.placedCount} placed)</option
            >
          {/each}
        </select>
      </label>
      <button disabled={ed.busy || !cellKey} onclick={() => ed.openCell(cellKey)}>Load cell</button>
      {#if ed.busy}<span>{catalogueStore.progress || 'working...'}</span>{/if}
      {#if ed.error}<span class="err">{ed.error}</span>{/if}
    </p>

    {#if ed.loaded && summary}
      {@const g = ed.loaded.grid}
      <p class="ok">
        {ed.loaded.refs.length} references: {g.tiles.length} tiles on the grid,
        {g.opaque.length} shown as-is (not editable), {g.overlaps.length} shared cells (tolerated, D58){ed
          .loaded.foreignTiles
          ? `, ${ed.loaded.foreignTiles} tiles from a master`
          : ''}. Grid anchor {g.anchor.origin.map((v) => v.toFixed(0)).join(', ')}, module
        {g.anchor.module.xy}.
      </p>

      <div class="cols">
        <div>
          <div class="selection">
            {#if selectedTile}
              <b>{pieceOf.get(selectedTile.ref.base)?.editorId ?? selectedTile.ref.base}</b><br />
              cell {selectedTile.cell.join(', ')}, rotation {selectedTile.rotation * 90}°<br />
              {selectedTile.ref.refFormKey}
              {selectedOwn ? '' : '(master override, read-only)'}
            {:else}
              <span class="hint">Click a tile to select it. Drag to pan, wheel to zoom.</span>
            {/if}
          </div>
          <table>
            <thead><tr><th>Tiles by category</th><th></th></tr></thead>
            <tbody>
              {#each summary.byCategory as [c, n] (c)}
                <tr
                  ><td><span class="swatch" style:background={COLORS[c] ?? '#999'}></span>{c}</td
                  ><td class="num">{n}</td></tr
                >
              {/each}
            </tbody>
          </table>
          <table>
            <thead><tr><th>Not a tile, why</th><th></th></tr></thead>
            <tbody>
              {#each summary.reasons as [r, n] (r)}
                <tr><td>{r}</td><td class="num">{n}</td></tr>
              {/each}
            </tbody>
          </table>
          <table>
            <thead><tr><th>Most frequent other objects</th><th></th></tr></thead>
            <tbody>
              {#each summary.topBases as [base, n] (base)}
                <tr><td>{statName.get(base) ?? base}</td><td class="num">{n}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>

        {#if ed.catalogue}
          <CellView
            loaded={ed.loaded}
            catalogue={ed.catalogue}
            {models}
            meshes={() => ed.meshes()}
            bind:selected={ed.selected}
          />
        {/if}
      </div>
    {/if}
  {/if}
</section>

<style>
  .hint {
    color: var(--fg-muted);
    font-size: 13px;
  }
  .cols {
    display: grid;
    grid-template-columns: 22rem 1fr;
    gap: 1rem;
    align-items: start;
  }
  table {
    border-collapse: collapse;
    font-size: 13px;
    width: 100%;
    margin-bottom: 1rem;
  }
  th,
  td {
    padding: 0.15rem 0.5rem;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  td.num {
    text-align: right;
  }
  .selection {
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.5rem;
    margin-bottom: 1rem;
    font-size: 13px;
    min-height: 4.5rem;
  }
  .swatch {
    display: inline-block;
    width: 0.8rem;
    height: 0.8rem;
    margin-right: 0.4rem;
    vertical-align: middle;
  }
</style>
