<script lang="ts">
  import SessionNotice from '../components/SessionNotice.svelte';
  import type { AnalysisResult } from '$lib/catalogue/analyze';
  import { summarize, type KitStat } from '$lib/catalogue/extract';
  import { IMPERIAL_KIT } from '$lib/catalogue/kits';
  import type { PieceCategory } from '$lib/catalogue/types';
  import { catalogueStore as store } from '$lib/session/catalogueStore.svelte';
  import { session } from '$lib/session/session.svelte';

  const result = $derived(store.stats);
  const analysis = $derived(store.analysis);
  let reference = $state.raw<Record<string, { pivot: number[]; cells: number[][] }> | null>(null);
  let referenceNote = $state('');
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

  async function analyse(force: boolean): Promise<void> {
    if (!(await store.analyse(force))) return;
    // reference measurements of the Python prototype, served in development only
    if (!import.meta.env.DEV) return;
    try {
      const response = await fetch('/poc/data/imperial-pieces.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const table = (await response.json()) as {
        pieces: Record<string, { pivot: number[]; cells: number[][] }>;
      };
      reference = table.pieces;
      referenceNote = `${Object.keys(reference).length} reference pieces loaded`;
    } catch (e) {
      reference = null;
      referenceNote = `reference measurements not loaded: ${(e as Error).message}`;
    }
  }

  function cellsKey(cells: readonly (readonly number[])[]): string {
    return cells
      .map((c) => `${c[0]},${c[1]}`)
      .sort()
      .join(';');
  }

  /** Compare a piece with the Python R5 measurement of the same mesh file. */
  function referenceCheck(p: AnalysisResult['pieces'][number]): 'same' | 'differs' | 'none' {
    if (!reference) return 'none';
    const file = p.stat.modelPath.slice(p.stat.modelPath.lastIndexOf('/') + 1);
    const ref = reference[file];
    if (!ref) return 'none';
    const samePivot =
      ref.pivot[0] === p.footprint.pivot[0] && ref.pivot[1] === p.footprint.pivot[1];
    return samePivot && cellsKey(ref.cells) === cellsKey(p.footprint.cells) ? 'same' : 'differs';
  }

  const referenceSummary = $derived.by(() => {
    if (!analysis || !reference) return null;
    const counts = { same: 0, differs: 0, none: 0 };
    for (const p of analysis.pieces) if (!p.error) counts[referenceCheck(p)]++;
    return counts;
  });

  function faceLabel(fi: number): string {
    const f = analysis!.faces[fi]!;
    return `${f.opening.dir}:G${f.group}`;
  }

  function cellSpan(p: AnalysisResult['pieces'][number]): string {
    const xs = new Set(p.footprint.cells.map((c) => c[0]));
    const ys = new Set(p.footprint.cells.map((c) => c[1]));
    return `${xs.size}x${ys.size}`;
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
    <SessionNotice />
  {:else}
    <p>
      <button disabled={store.busy} onclick={() => store.loadStats(true)}>Load pieces</button>
      <button disabled={store.busy} onclick={() => store.loadStats(false)}
        >Rebuild (ignore cache)</button
      >
      {#if store.busy}<span>{store.progress || 'working...'}</span>{/if}
      {#if store.error}<span class="err">{store.error}</span>{/if}
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

    <h3>Mesh analysis (step 9)</h3>
    <p>
      <button disabled={store.busy} onclick={() => analyse(false)}>Analyze meshes</button>
      <button disabled={store.busy} onclick={() => analyse(true)}>Re-analyze (ignore cache)</button>
    </p>
    {#if analysis}
      <p class="ok">
        {analysis.pieces.filter((p) => !p.error).length} pieces analysed,
        {analysis.pieces.filter((p) => p.error).length} failed, {analysis.faces.length} faces in
        {analysis.grouping.groups.length} connection types, {analysis.grouping.near.length} near matches,
        {(analysis.elapsedMs / 1000).toFixed(1)} s{store.analysisFromCache ? ' (from cache)' : ''}.
      </p>
      <p class={reference ? 'hint' : 'warn'}>{referenceNote}</p>
      {#if referenceSummary}
        <p class={referenceSummary.differs === 0 ? 'ok' : 'warn'}>
          Against the Python R5 reference: {referenceSummary.same} same footprint and pivot,
          {referenceSummary.differs} differ, {referenceSummary.none} not in the reference.
        </p>
      {/if}
      <div class="counters">
        <table>
          <thead>
            <tr
              ><th>Type</th><th>Faces</th><th>Mate</th><th>Width</th><th>Height</th><th>v min</th
              ></tr
            >
          </thead>
          <tbody>
            {#each analysis.grouping.groups as g (g.id)}
              <tr>
                <td>G{g.id}</td>
                <td class="num">{g.members.length}</td>
                <td>{g.mate === undefined ? 'none' : g.mate === g.id ? 'self' : `G${g.mate}`}</td>
                <td class="num">{g.width.toFixed(0)}</td>
                <td class="num">{g.height.toFixed(0)}</td>
                <td class="num">{g.vMin.toFixed(0)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if analysis.grouping.near.length}
          <table>
            <thead><tr><th>Near match</th><th>Score</th></tr></thead>
            <tbody>
              {#each analysis.grouping.near.slice(0, 20) as n (`${n.a}-${n.b}`)}
                <tr>
                  <td>
                    {analysis.faces[n.a]!.piece}
                    {faceLabel(n.a)} ~ {analysis.faces[n.b]!.piece}
                    {faceLabel(n.b)}
                  </td>
                  <td class="num">{n.score.toFixed(3)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
      <table class="pieces">
        <thead>
          <tr>
            <th>Piece</th><th>Source</th><th>Cells</th><th>Pivot</th><th>Faces (dir:type)</th><th
              >Fits</th
            ><th>vs R5</th>
          </tr>
        </thead>
        <tbody>
          {#each analysis.pieces as p (p.stat.formKey)}
            <tr class={p.error ? 'err' : ''}>
              <td>{p.stat.editorId}</td>
              <td class="model">{p.error ?? p.source}</td>
              <td class="num">{cellSpan(p)}</td>
              <td class="num"
                >{p.footprint.pivot
                  .slice(0, 2)
                  .map((v) => v.toFixed(0))
                  .join(',')}</td
              >
              <td>{p.faces.map(faceLabel).join('  ')}</td>
              <td class={p.footprint.fits ? 'ok' : 'warn'}>
                {p.footprint.fits ? 'yes' : p.footprint.notes.join('; ')}
              </td>
              <td
                class={referenceCheck(p) === 'same'
                  ? 'ok'
                  : referenceCheck(p) === 'differs'
                    ? 'err'
                    : ''}
              >
                {referenceCheck(p)}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    <h3>Base objects (step 8)</h3>
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
