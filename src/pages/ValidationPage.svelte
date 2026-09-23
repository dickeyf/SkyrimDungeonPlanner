<script lang="ts">
  /**
   * Step 10, part 2: read-only review of the automatic catalogue with the committed
   * annotations applied. Editing comes in part 3.
   */
  import annotationsJson from '../../data/annotations/imperial.json';
  import ProfileView from '../components/ProfileView.svelte';
  import { applyAnnotations, parseAnnotations } from '$lib/catalogue/annotations';
  import { buildReview } from '$lib/catalogue/review';
  import { catalogueStore as store } from '$lib/session/catalogueStore.svelte';
  import { session } from '$lib/session/session.svelte';

  const annotations = parseAnnotations(annotationsJson);
  const analysis = $derived(store.analysis);
  const review = $derived(analysis ? buildReview(analysis) : null);
  const annotated = $derived(analysis ? applyAnnotations(analysis.catalogue, annotations) : null);

  let tab = $state<'types' | 'near' | 'composite' | 'pieces'>('types');
  let openType = $state<number | null>(null);

  // wide cyan underneath, thin magenta on top: coinciding lines show magenta on cyan
  const COLORS = ['#3fb8c9', '#e0409a'];

  function typeName(group: number): string {
    const id = `${analysis!.kit.kit}:G${group}`;
    const name = annotated?.renamed.get(id);
    return name && name !== id ? name : `G${group}`;
  }

  /** Display name of a final connection id: annotated names as is, automatic ids as G<n>. */
  function connLabel(conn: string): string {
    const m = /:G(\d+)$/.exec(conn);
    return m ? `G${m[1]}` : conn;
  }

  /** One face per direction (a face covers several cells with the same types). */
  function pieceFaces(p: import('$lib/catalogue/types').Piece): string {
    const byDir = new Map(p.faces.map((f) => [f.dir, f]));
    return [...byDir.values()]
      .map((f) => `${f.dir}:${connLabel(f.conn)}${f.extraConn ? `+${f.extraConn.join('+')}` : ''}`)
      .join('  ');
  }

  function faceLabel(fi: number): string {
    const f = analysis!.faces[fi]!;
    return `${f.piece} ${f.opening.dir}`;
  }

  function profile(fi: number) {
    return analysis!.faces[fi]!.profile;
  }

  const validatedPieces = $derived(
    annotated ? annotated.catalogue.pieces.filter((p) => p.review.validated).length : 0,
  );
</script>

<section>
  <h2>Validation: {store.kit.kit} kit</h2>
  <p class="hint">
    Review the connection types proposed by the mesh analysis. Each type is shown by the profile of
    its opening, seen from outside the piece (u to the right, v up, origin at the centre of the
    covered cells and on the cell floor). Annotations come from
    <code>data/annotations/imperial.json</code>; editing arrives in the next part.
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
    <p class="ok">
      {review.types.length} connection types ({annotated.unnamedTypes} unnamed),
      {review.near.length} near-match pairs, {review.containment.length} containment candidates,
      {validatedPieces}/{annotated.catalogue.pieces.length} pieces validated,
      {annotated.excludedPieces.length} excluded.
    </p>
    {#if annotated.issues.length}
      <div class="warn">
        <b>Annotation issues</b>
        <ul>
          {#each annotated.issues as issue, i (i)}
            <li>{JSON.stringify(issue)}</li>
          {/each}
        </ul>
      </div>
    {/if}

    <nav class="tabs">
      <button class:active={tab === 'types'} onclick={() => (tab = 'types')}>Types</button>
      <button class:active={tab === 'near'} onclick={() => (tab = 'near')}
        >Near matches ({review.near.length})</button
      >
      <button class:active={tab === 'composite'} onclick={() => (tab = 'composite')}
        >Composite faces ({review.containment.length})</button
      >
      <button class:active={tab === 'pieces'} onclick={() => (tab = 'pieces')}>Pieces</button>
    </nav>

    {#if tab === 'types'}
      <div class="grid">
        {#each review.types as t (t.group)}
          <article>
            <header>
              <b>{typeName(t.group)}</b>
              <span class="hint">
                {t.faces.length} faces, mate {t.mate === undefined
                  ? 'none'
                  : t.mate === t.group
                    ? 'self'
                    : typeName(t.mate)}
              </span>
            </header>
            <ProfileView layers={[{ segments: profile(t.representative), color: COLORS[0]! }]} />
            <div class="hint">
              {t.width.toFixed(0)} x {t.height.toFixed(0)}, floor {t.vMin.toFixed(0)}
            </div>
            {#if t.mate !== undefined && t.mate !== t.group}
              <div class="hint">mirror of {typeName(t.mate)}</div>
            {/if}
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
        = second type. Where magenta runs inside cyan, the two openings coincide; where they separate,
        a gap would show between the pieces. Next part: you decide "same type" or "different".
      </p>
      <div class="grid">
        {#each review.near as n (`${n.a}-${n.b}`)}
          <article>
            <header>
              <b style:color={COLORS[0]}>{typeName(n.a)}</b> ~
              <b style:color={COLORS[1]}>{typeName(n.b)}</b>
            </header>
            <ProfileView
              size={220}
              layers={[
                { segments: profile(n.faceA), color: COLORS[0]! },
                { segments: profile(n.faceB), color: COLORS[1]! },
              ]}
            />
            <div class="hint">
              best {n.bestScore.toFixed(3)} over {n.count} face pairs<br />
              {faceLabel(n.faceA)} / {faceLabel(n.faceB)}
            </div>
          </article>
        {/each}
      </div>
    {:else if tab === 'composite'}
      <p class="hint">
        A <b>composite face</b> carries two openings at once: for example the end of a large
        corridor closed by a wall pierced with a small door. Its outline contains the whole outline
        of the large corridor <i>and</i> the whole arch of the small corridor, so that face can join either
        one. Wide cyan line = the simpler opening found inside, thin magenta line = the composite face.
        Next part: you confirm "this face also accepts that type".
      </p>
      <div class="grid">
        {#each review.containment as c (`${c.inner}-${c.outer}`)}
          {@const inner = review.types[c.inner]!}
          {@const outer = review.types[c.outer]!}
          <article>
            <header>
              <span
                ><b style:color={COLORS[1]}>{typeName(c.outer)}</b> also accepts
                <b style:color={COLORS[0]}>{typeName(c.inner)}</b></span
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
              {(c.innerCoverage * 100).toFixed(0)} % of {typeName(c.inner)} lies on
              {typeName(c.outer)}<br />
              faces: {outer.faces.map(faceLabel).join(', ')}
            </div>
          </article>
        {/each}
      </div>
    {:else}
      <table>
        <thead>
          <tr><th>Piece</th><th>Category</th><th>Faces</th><th>Validated</th></tr>
        </thead>
        <tbody>
          {#each annotated.catalogue.pieces as p (p.formKey)}
            <tr>
              <td>{p.editorId}</td>
              <td>{p.category}</td>
              <td>{pieceFaces(p)}</td>
              <td class={p.review.validated ? 'ok' : 'hint'}>{p.review.validated ? 'yes' : 'no'}</td
              >
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
  .tabs {
    margin: 1rem 0;
  }
  .tabs button.active {
    border-bottom: 2px solid var(--accent);
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
</style>
