<script lang="ts">
  /**
   * Step 10: review the automatic catalogue and record the few human decisions (near
   * matches, composite faces, pieces). Types are internal and never named by hand; this page
   * labels them G<n> for the session only. Writing into the repository is part 4.
   */
  import ProfileView from '../components/ProfileView.svelte';
  import {
    analysisFaceKey,
    isComposite,
    mergeDecision,
    setComposite,
    setMergeDecision,
    setPiece,
  } from '$lib/catalogue/annotationEdits';
  import { applyAnnotations, serializeAnnotations } from '$lib/catalogue/annotations';
  import { buildReview } from '$lib/catalogue/review';
  import type { Piece } from '$lib/catalogue/types';
  import {
    HANDLE_KEYS,
    ensureAccess,
    isProjectFolder,
    loadHandle,
    pickDirectory,
    saveHandle,
    writeProjectAnnotations,
  } from '$lib/fs';
  import { annotationStore as ann } from '$lib/session/annotationStore.svelte';
  import { catalogueStore as store } from '$lib/session/catalogueStore.svelte';
  import { session } from '$lib/session/session.svelte';

  const analysis = $derived(store.analysis);
  const review = $derived(analysis ? buildReview(analysis) : null);
  const annotated = $derived(analysis ? applyAnnotations(analysis.catalogue, ann.current) : null);

  /** Final type id -> smallest G label among the groups it covers (display only). */
  const labelOf = $derived.by((): ReadonlyMap<string, string> => {
    if (!annotated) return new Map();
    const entries = [...annotated.renamed].sort(
      (x, y) => Number(x[0].split(':G')[1]) - Number(y[0].split(':G')[1]),
    );
    // reversed so the smallest G label is the one kept for each final id
    return new Map(
      entries.reverse().map(([autoId, final]) => [final, `G${autoId.split(':G')[1]}`]),
    );
  });

  let tab = $state<'types' | 'near' | 'composite' | 'pieces'>('near');
  let openType = $state<number | null>(null);

  // wide cyan underneath, thin magenta on top: coinciding lines show magenta on cyan
  const COLORS = ['#3fb8c9', '#e0409a'];

  /** Label of a group after merges: merged groups show the same label. */
  function typeName(group: number): string {
    const final = annotated?.renamed.get(`${analysis!.kit.kit}:G${group}`);
    return (final && labelOf.get(final)) ?? `G${group}`;
  }

  function faceLabel(fi: number): string {
    const f = analysis!.faces[fi]!;
    return `${f.piece} ${f.opening.dir}`;
  }

  function profile(fi: number) {
    return analysis!.faces[fi]!.profile;
  }

  function pieceFaces(p: Piece): string {
    const byDir = new Map(p.faces.map((f) => [f.dir, f]));
    return [...byDir.values()]
      .map((f) => {
        const extra = (f.extraConn ?? []).map((c) => labelOf.get(c) ?? c);
        return `${f.dir}:${labelOf.get(f.conn) ?? f.conn}${extra.length ? `+${extra.join('+')}` : ''}`;
      })
      .join('  ');
  }

  const piecesView = $derived.by(() => {
    if (!analysis || !annotated) return [];
    const finalPieces = new Map(annotated.catalogue.pieces.map((p) => [p.editorId, p]));
    const notes = new Map(analysis.pieces.map((p) => [p.stat.editorId, p.footprint.notes]));
    return analysis.catalogue.pieces.map((p) => ({
      editorId: p.editorId,
      final: finalPieces.get(p.editorId),
      annotation: ann.current.pieces[p.editorId],
      notes: notes.get(p.editorId) ?? [],
    }));
  });

  function excludeNonFitting(): void {
    ann.update((a) => {
      let next = a;
      for (const p of piecesView) {
        if (p.notes.length && !p.annotation?.exclude) {
          next = setPiece(next, p.editorId, { exclude: p.notes.join('; ') });
        }
      }
      return next;
    });
  }

  function validateAll(): void {
    ann.update((a) => {
      let next = a;
      for (const p of piecesView) {
        if (!p.annotation?.exclude && !p.annotation?.validated) {
          next = setPiece(next, p.editorId, { validated: true });
        }
      }
      return next;
    });
  }

  /** Development only: the Vite dev server serves the working copy, so write into it. */
  const canWriteRepo = import.meta.env.DEV;
  let saveMessage = $state('');

  async function saveToRepository(): Promise<void> {
    saveMessage = '';
    try {
      let project = await loadHandle<FileSystemDirectoryHandle>(HANDLE_KEYS.projectFolder);
      if (!project || !(await ensureAccess(project, 'readwrite'))) {
        project = await pickDirectory('project-folder', 'readwrite');
      }
      if (!(await isProjectFolder(project))) {
        saveMessage = `"${project.name}" is not a checkout of this project (package.json).`;
        return;
      }
      await saveHandle(HANDLE_KEYS.projectFolder, project);
      const path = await writeProjectAnnotations(
        project,
        ann.current.kit,
        serializeAnnotations(ann.current),
      );
      ann.markSaved();
      saveMessage = `Written to ${path}: review and commit it with git.`;
    } catch (e) {
      saveMessage = `Not saved: ${(e as Error).message}`;
    }
  }

  function download(): void {
    const blob = new Blob([serializeAnnotations(ann.current)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'imperial.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const pairOf = (n: { faceA: number; faceB: number }): [string, string] => [
    analysisFaceKey(analysis!, n.faceA),
    analysisFaceKey(analysis!, n.faceB),
  ];
  const compositeOf = (c: { inner: number; outer: number }) => ({
    face: analysisFaceKey(analysis!, review!.types[c.outer]!.representative),
    accepts: analysisFaceKey(analysis!, review!.types[c.inner]!.representative),
  });

  const validatedPieces = $derived(
    annotated ? annotated.catalogue.pieces.filter((p) => p.review.validated).length : 0,
  );
  const decidedNear = $derived(
    review ? review.near.filter((n) => mergeDecision(ann.current, pairOf(n))).length : 0,
  );
  const acceptedComposites = $derived(
    review
      ? review.containment.filter((c) => {
          const { face, accepts } = compositeOf(c);
          return isComposite(ann.current, face, accepts);
        }).length
      : 0,
  );
</script>

<section>
  <h2>Validation: {store.kit.kit} kit</h2>
  <p class="hint">
    Decide what the analysis cannot decide alone: near matches, composite faces, pieces to leave
    out. Connection types are internal: they are never named, and G numbers only label them on this
    page.
  </p>

  {#if !session.ready}
    <p class="warn">Configure the game folder first (Setup).</p>
  {:else if !analysis}
    <p>
      <button disabled={store.busy} onclick={() => store.analyse(false)}>Load the analysis</button>
      {#if store.busy}<span>{store.progress || 'working...'}</span>{/if}
      {#if store.error}<span class="err">{store.error}</span>{/if}
    </p>
  {/if}

  {#if analysis && review && annotated}
    <div class="bar">
      <span>
        {decidedNear}/{review.near.length} near matches decided,
        {acceptedComposites}/{review.containment.length} composites accepted,
        {validatedPieces}/{annotated.catalogue.pieces.length} pieces validated,
        {annotated.excludedPieces.length} excluded, {annotated.catalogue.connectionTypes.length} types
      </span>
      {#if ann.dirty}
        <span class="warn">unsaved changes</span>
        <button onclick={() => ann.revert()}>Revert</button>
        {#if canWriteRepo}
          <button onclick={saveToRepository}>Save to repository</button>
        {/if}
        <button onclick={download}>Download JSON</button>
      {:else}
        <span class="ok">no changes</span>
      {/if}
      {#if saveMessage}<span class="hint">{saveMessage}</span>{/if}
    </div>

    {#if annotated.issues.length}
      <div class="warn">
        <b>Annotations that no longer match the analysis</b>
        <ul>
          {#each annotated.issues as issue, i (i)}
            <li>{JSON.stringify(issue)}</li>
          {/each}
        </ul>
      </div>
    {/if}

    <nav class="tabs">
      <button class:active={tab === 'near'} onclick={() => (tab = 'near')}
        >Near matches ({review.near.length})</button
      >
      <button class:active={tab === 'composite'} onclick={() => (tab = 'composite')}
        >Composite faces ({review.containment.length})</button
      >
      <button class:active={tab === 'pieces'} onclick={() => (tab = 'pieces')}>Pieces</button>
      <button class:active={tab === 'types'} onclick={() => (tab = 'types')}
        >Types (read-only)</button
      >
    </nav>

    {#if tab === 'types'}
      <div class="grid">
        {#each review.types as t (t.group)}
          <article>
            <header>
              <b>G{t.group}</b>
              <span class="hint">
                {t.faces.length} faces, mate {t.mate === undefined
                  ? 'none'
                  : t.mate === t.group
                    ? 'self'
                    : typeName(t.mate)}
              </span>
            </header>
            {#if typeName(t.group) !== `G${t.group}`}
              <div class="hint">merged into {typeName(t.group)}</div>
            {/if}
            <ProfileView layers={[{ segments: profile(t.representative), color: COLORS[0]! }]} />
            <div class="hint">
              {t.width.toFixed(0)} x {t.height.toFixed(0)}, floor {t.vMin.toFixed(0)}
            </div>
            <button onclick={() => (openType = openType === t.group ? null : t.group)}>
              {openType === t.group ? 'hide faces' : 'show faces'}
            </button>
            {#if openType === t.group}
              <ul class="faces">
                {#each t.faces as fi (fi)}
                  <li class:rep={fi === t.representative}>{faceLabel(fi)}</li>
                {/each}
              </ul>
            {/if}
          </article>
        {/each}
      </div>
    {:else if tab === 'near'}
      <p class="hint">
        Two types whose openings are <b>almost</b> the same shape (similarity between 80 % and 97 %),
        so the analysis did not merge them on its own. Wide cyan line = first type, thin magenta line
        = second type. Where magenta runs inside cyan, the openings coincide; where they separate, a gap
        would show between the pieces.
      </p>
      <div class="grid">
        {#each review.near as n (`${n.a}-${n.b}`)}
          {@const pair = pairOf(n)}
          {@const decision = mergeDecision(ann.current, pair)}
          <article class:done={decision !== undefined}>
            <header>
              <span
                ><b style:color={COLORS[0]}>G{n.a}</b> ~ <b style:color={COLORS[1]}>G{n.b}</b></span
              >
            </header>
            <ProfileView
              size={220}
              layers={[
                { segments: profile(n.faceA), color: COLORS[0]! },
                { segments: profile(n.faceB), color: COLORS[1]! },
              ]}
            />
            <div class="hint">
              best {(n.bestScore * 100).toFixed(1)} % over {n.count} face pairs<br />
              {faceLabel(n.faceA)} / {faceLabel(n.faceB)}
            </div>
            <div class="choices">
              <button
                class:chosen={decision === 'same-type'}
                onclick={() => ann.update((a) => setMergeDecision(a, pair, 'same-type'))}
                >Same type</button
              >
              <button
                class:chosen={decision === 'distinct'}
                onclick={() => ann.update((a) => setMergeDecision(a, pair, 'distinct'))}
                >Different</button
              >
              {#if decision}
                <button onclick={() => ann.update((a) => setMergeDecision(a, pair, undefined))}
                  >Undecide</button
                >
              {/if}
            </div>
          </article>
        {/each}
      </div>
    {:else if tab === 'composite'}
      <p class="hint">
        A <b>composite face</b> carries two openings at once: for example the end of a large corridor
        closed by a wall pierced with a small door. Its outline contains the whole outline of the simpler
        opening, so that face can also join it. Wide cyan line = the simpler opening found inside, thin
        magenta line = the composite face.
      </p>
      <div class="grid">
        {#each review.containment as c (`${c.inner}-${c.outer}`)}
          {@const inner = review.types[c.inner]!}
          {@const outer = review.types[c.outer]!}
          {@const link = compositeOf(c)}
          {@const accepted = isComposite(ann.current, link.face, link.accepts)}
          <article class:done={accepted}>
            <header>
              <span
                ><b style:color={COLORS[1]}>G{c.outer}</b> also accepts
                <b style:color={COLORS[0]}>G{c.inner}</b></span
              >
            </header>
            <ProfileView
              size={220}
              layers={[
                { segments: profile(inner.representative), color: COLORS[0]! },
                { segments: profile(outer.representative), color: COLORS[1]! },
              ]}
            />
            <div class="hint">
              {(c.innerCoverage * 100).toFixed(0)} % of G{c.inner} lies on G{c.outer}<br />
              faces: {outer.faces.map(faceLabel).join(', ')}
            </div>
            <label>
              <input
                type="checkbox"
                checked={accepted}
                onchange={(e) =>
                  ann.update((a) =>
                    setComposite(
                      a,
                      link.face,
                      link.accepts,
                      (e.currentTarget as HTMLInputElement).checked,
                    ),
                  )}
              />
              accept
            </label>
          </article>
        {/each}
      </div>
    {:else}
      <p>
        <button onclick={excludeNonFitting}>Exclude pieces that do not fit the grid</button>
        <button onclick={validateAll}>Validate all remaining</button>
      </p>
      <table>
        <thead>
          <tr><th>Piece</th><th>Category</th><th>Faces</th><th>Validated</th><th>Excluded</th></tr>
        </thead>
        <tbody>
          {#each piecesView as p (p.editorId)}
            <tr class:excluded={!p.final}>
              <td>{p.editorId}</td>
              <td>{p.final?.category ?? ''}</td>
              <td>{p.final ? pieceFaces(p.final) : p.annotation?.exclude}</td>
              <td>
                <input
                  type="checkbox"
                  disabled={!p.final}
                  checked={p.annotation?.validated ?? false}
                  onchange={(e) =>
                    ann.update((a) =>
                      setPiece(a, p.editorId, {
                        validated: (e.currentTarget as HTMLInputElement).checked,
                      }),
                    )}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={!!p.annotation?.exclude}
                  title={p.notes.join('; ')}
                  onchange={(e) =>
                    ann.update((a) =>
                      setPiece(a, p.editorId, {
                        exclude: (e.currentTarget as HTMLInputElement).checked
                          ? p.notes.join('; ') || 'excluded'
                          : undefined,
                      }),
                    )}
                />
                {#if p.notes.length && !p.annotation?.exclude}<span
                    class="warn"
                    title={p.notes.join('; ')}>does not fit</span
                  >{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}
</section>

<style>
  .hint {
    color: var(--fg-muted);
    font-size: 13px;
  }
  .bar {
    display: flex;
    gap: 1rem;
    align-items: center;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 1;
  }
  .tabs {
    margin: 1rem 0;
  }
  .tabs button.active,
  button.chosen {
    border-bottom: 2px solid var(--accent);
    color: var(--accent);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 0.75rem;
  }
  article {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.5rem;
    background: var(--bg-panel);
  }
  article.done {
    border-color: #4f7a4f;
  }
  article header {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.3rem;
  }
  ul.faces {
    font-size: 12px;
    max-height: 12rem;
    overflow: auto;
    padding-left: 1.2rem;
  }
  li.rep {
    color: var(--accent);
  }
  table {
    border-collapse: collapse;
    font-size: 13px;
    width: 100%;
  }
  th,
  td {
    padding: 0.15rem 0.6rem;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  tr.excluded td {
    color: var(--fg-muted);
    text-decoration: line-through;
  }
</style>
