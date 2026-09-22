<script lang="ts">
  import { loadKitStats, type KitStatsResult } from '$lib/catalogue/build';
  import { summarize, type KitStat } from '$lib/catalogue/extract';
  import { IMPERIAL_KIT } from '$lib/catalogue/kits';
  import type { PieceCategory } from '$lib/catalogue/types';
  import { session } from '$lib/session/session.svelte';

  let result = $state<KitStatsResult | null>(null);
  let busy = $state(false);
  let error = $state('');
  let filter = $state('');
  let category = $state<PieceCategory | 'all'>('all');
  let subkit = $state('all');

  const summary = $derived(result ? summarize(result.stats) : null);
  const rows = $derived.by(() => {
    if (!result) return [] as KitStat[];
    const needle = filter.trim().toLowerCase();
    return result.stats.filter(
      (s) =>
        (category === 'all' || s.category === category) &&
        (subkit === 'all' || s.subkit === subkit) &&
        (needle === '' ||
          s.editorId.toLowerCase().includes(needle) ||
          s.modelPath.includes(needle)),
    );
  });

  async function build(useCache: boolean): Promise<void> {
    if (!session.view) return;
    busy = true;
    error = '';
    try {
      result = await loadKitStats(session.view.overlay, IMPERIAL_KIT, 'Skyrim.esm', { useCache });
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  function bounds(s: KitStat): string {
    if (!s.bounds) return '';
    const size = s.bounds.max.map((v, i) => v - s.bounds!.min[i]!);
    return size.join(' x ');
  }
</script>

<section>
  <h2>Catalogue: {IMPERIAL_KIT.kit} kit</h2>
  <p class="hint">
    Step 8: the kit's base objects (STAT records) read straight from <code>Skyrim.esm</code>
    through the Data view, classified by mesh sub-folder and name. Module {IMPERIAL_KIT.module.xy} x {IMPERIAL_KIT
      .module.z}. Step 9 measures each piece's footprint and faces; step 10 lets you correct the
    classification.
  </p>

  {#if !session.ready}
    <p class="warn">Configure the game folder first (Setup).</p>
  {:else}
    <p>
      <button disabled={busy} onclick={() => build(true)}>Load pieces</button>
      <button disabled={busy} onclick={() => build(false)}>Rebuild (ignore cache)</button>
      {#if busy}<span>reading...</span>{/if}
      {#if error}<span class="err">{error}</span>{/if}
    </p>
  {/if}

  {#if result && summary}
    <p class="ok">
      {result.master}: {result.totalStats} STAT records, {summary.total} in the {IMPERIAL_KIT.kit}
      kit ({result.fromCache ? 'from cache' : 'extracted'} in {result.elapsedMs.toFixed(0)} ms).
    </p>
    <div class="counters">
      <table>
        <thead><tr><th>Category</th><th>Pieces</th></tr></thead>
        <tbody>
          {#each Object.entries(summary.byCategory) as [name, count] (name)}
            <tr><td>{name}</td><td class="num">{count}</td></tr>
          {/each}
        </tbody>
      </table>
      <table>
        <thead><tr><th>Sub-folder</th><th>Structural</th><th>All</th></tr></thead>
        <tbody>
          {#each summary.bySubkit as s (s.subkit)}
            <tr
              ><td>{s.subkit}</td><td class="num">{s.structural}</td><td class="num">{s.total}</td
              ></tr
            >
          {/each}
        </tbody>
      </table>
    </div>

    <p class="filters">
      <input placeholder="filter by EditorID or model" bind:value={filter} />
      <select bind:value={category}>
        <option value="all">all categories</option>
        <option value="hall">hall</option>
        <option value="room">room</option>
        <option value="door">door</option>
        <option value="other">other (props, other sub-kits)</option>
      </select>
      <select bind:value={subkit}>
        <option value="all">all sub-folders</option>
        {#each summary.bySubkit as s (s.subkit)}
          <option value={s.subkit}>{s.subkit}</option>
        {/each}
      </select>
      <span class="hint">{rows.length} shown</span>
    </p>

    <table class="pieces">
      <thead>
        <tr
          ><th>EditorID</th><th>Sub-folder</th><th>Category</th><th>Bounds (units)</th><th>Model</th
          ></tr
        >
      </thead>
      <tbody>
        {#each rows as s (s.formKey)}
          <tr class={s.category}>
            <td>{s.editorId}</td>
            <td>{s.subkit}</td>
            <td>{s.category}</td>
            <td class="num">{bounds(s)}</td>
            <td class="model">{s.model}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  .hint {
    color: var(--fg-muted);
  }
  .counters {
    display: flex;
    gap: 2rem;
    flex-wrap: wrap;
  }
  table {
    border-collapse: collapse;
    font-size: 13px;
  }
  th,
  td {
    padding: 0.15rem 0.6rem;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  td.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  td.model {
    color: var(--fg-muted);
    font-family: var(--mono);
    font-size: 12px;
  }
  .filters input {
    width: 20rem;
  }
  tr.other td:first-child {
    color: var(--fg-muted);
  }
  .pieces {
    width: 100%;
  }
</style>
