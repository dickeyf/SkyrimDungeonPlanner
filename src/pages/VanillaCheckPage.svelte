<script lang="ts">
  /**
   * Vanilla check (V4 step 5): the tool's reading and junction checks run on the CELLs of the
   * game's master built with the chosen kit, to compare the catalogue with what Bethesda built.
   */
  import SessionNotice from '../components/SessionNotice.svelte';
  import KitPicker from '../components/KitPicker.svelte';
  import { applyAnnotations } from '$lib/catalogue/annotations';
  import type { JointGeometry } from '$lib/grid/assist';
  import {
    HANDLE_KEYS,
    ensureAccess,
    isProjectFolder,
    loadHandle,
    pickDirectory,
    readAll,
    saveHandle,
    writeProjectFile,
  } from '$lib/fs';
  import { MIN_VANILLA_COUNT, serializeVanillaPairs } from '$lib/catalogue/vanillaPairs';
  import { vanillaPairsOf } from '$lib/session/vanillaPairs';
  import { acceptedOverlaps } from '$lib/grid/overlaps';
  import { EspLevelStore, checkVanillaCells, type VanillaReport } from '$lib/level';
  import { annotationStore } from '$lib/session/annotationStore.svelte';
  import { catalogueStore as store } from '$lib/session/catalogueStore.svelte';
  import { session } from '$lib/session/session.svelte';

  let master = $state('Skyrim.esm');
  let minTiles = $state(15);
  let report = $state.raw<VanillaReport | null>(null);
  let reportKit = $state('');
  let busy = $state(false);
  let progress = $state('');
  let error = $state('');
  /** Judge with the committed pairs of the game (V4 step 9b), or without them. */
  let usePairs = $state(true);
  let saveMessage = $state('');

  /** Write the pairs the game uses (at least MIN_VANILLA_COUNT times) into the repository. */
  async function savePairs(): Promise<void> {
    if (!report) return;
    saveMessage = '';
    try {
      let project = await loadHandle<FileSystemDirectoryHandle>(HANDLE_KEYS.projectFolder);
      if (!project || !(await ensureAccess(project, 'readwrite')))
        project = await pickDirectory('project-folder', 'readwrite');
      if (!(await isProjectFolder(project))) {
        saveMessage = `"${project.name}" is not a checkout of this project (package.json).`;
        return;
      }
      await saveHandle(HANDLE_KEYS.projectFolder, project);
      const pairs = report.seen.filter((p) => p.count >= MIN_VANILLA_COUNT);
      const path = await writeProjectFile(
        project,
        'data/vanilla',
        `${reportKit.toLowerCase()}.json`,
        serializeVanillaPairs({ version: 1, kit: reportKit, master, pairs }),
      );
      saveMessage = `${pairs.length} pairs written to ${path}: review and commit it with git (reload the page to use them).`;
    } catch (e) {
      saveMessage = `Not saved: ${(e as Error).message}`;
    }
  }

  async function run(): Promise<void> {
    if (!session.view) return;
    busy = true;
    error = '';
    report = null;
    try {
      const kit = store.kit;
      const analysis = store.analysisOf(kit) ?? (await store.analyse(false, kit));
      if (!analysis) throw new Error(store.error || 'no analysis');
      const catalogue = applyAnnotations(
        analysis.catalogue,
        annotationStore.currentOf(kit.kit),
      ).catalogue;
      const editorIds = new Map(catalogue.pieces.map((p) => [p.formKey, p.editorId]));
      const profiles = new Map(
        analysis.faces.map((f) => [`${f.piece}:${f.opening.dir}`, f.profile]),
      );
      const geometry: JointGeometry = {
        module: { xy: kit.module.xy!, z: kit.module.z! },
        profileOf: (k, dir) => profiles.get(`${editorIds.get(k)}:${dir}`),
        ...(usePairs ? { vanilla: acceptedOverlaps(vanillaPairsOf(kit.kit)) } : {}),
      };
      progress = `reading ${master}...`;
      const file = await session.view.overlay.resolveFile(master);
      if (!file) throw new Error(`${master} not found in the Data view`);
      const level = EspLevelStore.parse(await readAll(file.file), master);
      report = await checkVanillaCells(level, catalogue, geometry, {
        minTiles,
        onProgress: (done, total, cell) => (progress = `${done} / ${total} ${cell}`),
      });
      reportKit = kit.kit;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
      progress = '';
    }
  }

  const fmt = (v: readonly number[]) => v.map((x) => Math.round(x)).join(', ');
  const totals = $derived.by(() => {
    if (!report) return null;
    const t = {
      cells: report.cells.length,
      tiles: 0,
      main: 0,
      others: 0,
      outside: {} as Record<string, number>,
      open: 0,
      seams: 0,
      mismatches: 0,
      sections: 0,
    };
    for (const c of report.cells) {
      t.tiles += c.kitTiles;
      t.main += c.sections[0]?.tiles ?? 0;
      t.others += c.sections.slice(1).reduce((n, s) => n + s.tiles, 0);
      t.sections += c.sections.length;
      for (const [k, v] of Object.entries(c.outside)) t.outside[k] = (t.outside[k] ?? 0) + v;
      t.open += c.open;
      t.seams += c.seams;
      t.mismatches += c.mismatches;
    }
    return t;
  });
  /** For each offset of the secondary sections, the pieces they hold. */
  const offsetPieces = $derived.by(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const c of report?.cells ?? [])
      for (const s of c.sections.slice(1)) {
        const k = fmt(s.offset);
        const e = (m[k] ??= {});
        for (const [p, n] of Object.entries(s.pieces)) e[p] = (e[p] ?? 0) + n;
      }
    return m;
  });
  const top = (r: Record<string, number> | undefined) =>
    Object.entries(r ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([p, n]) => `${p} ${n}`)
      .join(', ');

  /** Offsets of the secondary sections, the most frequent first. */
  const offsets = $derived.by(() => {
    const m: Record<string, number> = {};
    for (const c of report?.cells ?? [])
      for (const s of c.sections.slice(1)) {
        const k = fmt(s.offset);
        m[k] = (m[k] ?? 0) + s.tiles;
      }
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30);
  });
</script>

<section>
  <h2>Vanilla check: {store.kit.kit} kit</h2>
  <p class="hint">
    Reads the game's own CELLs built with the kit and runs the tool's reading and checks on them:
    how many pieces sit on a grid, in how many sections (groups of pieces sharing one grid), and
    which junctions the checks flag. What Bethesda built is mostly right: a frequent flag is a
    likely false alarm.
  </p>
  {#if !session.ready}
    <SessionNotice />
  {:else}
    <p>
      <KitPicker />
      <label>Master <input bind:value={master} size="14" /></label>
      <label
        >CELLs with at least <input
          type="number"
          bind:value={minTiles}
          min="1"
          style="width: 4rem"
        /> kit pieces</label
      >
      <label
        title="Take the pairs of pieces the game puts together (data/vanilla) as right junctions"
        ><input type="checkbox" bind:checked={usePairs} /> use the game's pairs</label
      >
      <button disabled={busy} onclick={run}>Run</button>
      {#if busy}<span class="hint">{progress || store.progress || 'working...'}</span>{/if}
      {#if error}<span class="err">{error}</span>{/if}
    </p>
  {/if}

  {#if report && totals}
    <h3>{reportKit}: {totals.cells} CELLs, {totals.tiles} kit pieces placed</h3>
    <ul>
      <li>
        On a grid: {totals.main + totals.others} ({Math.round(
          ((totals.main + totals.others) / totals.tiles) * 100,
        )} %):
        {totals.main} in the main sections, {totals.others} in {totals.sections - totals.cells} other
        sections
      </li>
      <li>
        On no grid: {Object.entries(totals.outside)
          .map(([k, v]) => `${k} ${v}`)
          .join(', ') || 'none'}
      </li>
      <li>
        Main sections: {totals.open} open faces, {totals.seams} seams, {totals.mismatches} mismatches
      </li>
    </ul>

    <p>
      {report.seen.length} pairs of pieces meet at an opening, {report.seen.filter(
        (p) => p.count >= MIN_VANILLA_COUNT,
      ).length} of them at least {MIN_VANILLA_COUNT} times.
      {#if import.meta.env.DEV}<button onclick={savePairs}
          >Save the game's pairs to the repository</button
        >{/if}
      {#if saveMessage}<span class="hint">{saveMessage}</span>{/if}
    </p>

    <h3>Offsets of the other sections (x, y, z from the main grid; pieces)</h3>
    <table>
      <thead><tr><th>offset</th><th>pieces</th><th>most frequent pieces</th></tr></thead>
      <tbody>
        {#each offsets as [k, n] (k)}
          <tr><td>({k})</td><td>{n}</td><td>{top(offsetPieces[k])}</td></tr>
        {/each}
      </tbody>
    </table>

    <h3>Most frequent bad junctions</h3>
    <table>
      <thead><tr><th>junction</th><th>seams</th><th>mismatches</th></tr></thead>
      <tbody>
        {#each report.pairs.slice(0, 80) as p (p.pair)}
          <tr><td>{p.pair}</td><td>{p.seams}</td><td>{p.mismatches}</td></tr>
        {/each}
      </tbody>
    </table>

    <h3>CELLs</h3>
    <table>
      <thead>
        <tr
          ><th>CELL</th><th>pieces</th><th>sections (pieces, offset)</th><th>on no grid</th><th
            >open</th
          ><th>seams</th><th>mismatches</th></tr
        >
      </thead>
      <tbody>
        {#each report.cells as c (c.key)}
          <tr>
            <td>{c.editorId}</td>
            <td>{c.kitTiles}</td>
            <td
              >{c.sections
                .map((s, i) => (i ? `${s.tiles} (${fmt(s.offset)})` : `${s.tiles}`))
                .join(' · ')}</td
            >
            <td
              >{Object.entries(c.outside)
                .map(([k, v]) => `${k} ${v}`)
                .join(', ')}</td
            >
            <td>{c.open}</td>
            <td>{c.seams}</td>
            <td>{c.mismatches}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  table {
    border-collapse: collapse;
    font-size: 12px;
    margin: 0.5rem 0;
  }
  td,
  th {
    border: 1px solid var(--border);
    padding: 0.15rem 0.4rem;
    text-align: left;
  }
  label {
    margin-right: 0.6rem;
  }
</style>
