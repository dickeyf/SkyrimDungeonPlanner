<script lang="ts">
  /**
   * Steps 13-14: edit a cell's tiles. Pure logic lives in $lib/grid (edit, assist); this page
   * wires it to the scene (pointer events), the keyboard, the piece palette and the contextual
   * assistant (open faces and compatible pieces). Nothing is written to the plugin until
   * step 15.
   */
  import SessionNotice from '../components/SessionNotice.svelte';
  import CellView from '../components/CellView.svelte';
  import ProfileView from '../components/ProfileView.svelte';
  import type { Catalogue, FormKey, Piece, PieceCategory } from '$lib/catalogue/types';
  import { editorStore as ed } from '$lib/editor/editorStore.svelte';
  import {
    addTile,
    badJoints,
    candidatesFor,
    checkCandidates,
    cellAt,
    changeCount,
    changes,
    commit,
    conflictsFor,
    faceAt,
    inFrameOf,
    SEAM_TOL,
    faceRect,
    footprintCells,
    historyOf,
    layoutFromGrid,
    openFaces,
    moveTile,
    redo,
    removeTile,
    rotateTile,
    sharedCells,
    surroundings,
    undo,
    type BadJoint,
    type Candidate,
    type JointGeometry,
    type EditResult,
    type History,
    type Layout,
    type OpenFace,
  } from '$lib/grid';
  import type { CellIndex, Vec3 } from '$lib/catalogue/types';
  import { editsFromChanges, piecesByFormKey, summarizeCell } from '$lib/level';
  import {
    CATEGORY_COLORS,
    layoutObjects,
    sceneGrid,
    tileObject,
    type Highlight,
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
  let showFaces = $state(true);
  let activeFace = $state<string | null>(null);

  // open the remembered working plugin as soon as the game folder is restored, which may
  // finish after this page is shown (browser reload on /editor)
  let autoOpened = false;
  $effect(() => {
    if (autoOpened || !session.ready || ed.store || !ed.rememberedPlugin) return;
    autoOpened = true;
    void ed.openPlugin();
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
    activeFace = null;
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

  // ---- assistant -----------------------------------------------------------------------------

  const types = $derived(new Map(catalogue.connectionTypes.map((t) => [t.id, t])));
  const opens = $derived(layout ? openFaces(layout, pieces) : []);
  /**
   * Stable between edits (it changes only with the cell or the catalogue analysis), so the
   * profile verdicts cached per geometry are reused from one edit to the next.
   */
  const geometry = $derived.by((): JointGeometry | undefined => {
    if (!anchor) return undefined;
    const byKey = profiles;
    const byForm = pieces;
    return {
      module: anchor.module,
      profileOf: (k, dir) => byKey.get(`${byForm.get(k)?.editorId}:${dir}`),
    };
  });
  const bad = $derived.by(() => {
    if (!layout) return [];
    const started = performance.now();
    const out = badJoints(layout, pieces, types, geometry);
    if (import.meta.env.DEV)
      console.debug(`junctions checked in ${(performance.now() - started).toFixed(0)} ms`);
    return out;
  });
  const active = $derived(opens.find((o) => o.id === activeFace));
  const activeBad = $derived(bad.find((o) => o.id === activeFace));
  const shared = $derived(layout ? sharedCells(layout, pieces) : []);
  let activeShared = $state.raw<ReturnType<typeof sharedCells>[number] | null>(null);
  const cellBox = (c: CellIndex) => ({
    min: [
      anchor!.origin[0] + c[0] * anchor!.module.xy,
      anchor!.origin[1] + c[1] * anchor!.module.xy,
    ] as [number, number],
    max: [
      anchor!.origin[0] + (c[0] + 1) * anchor!.module.xy,
      anchor!.origin[1] + (c[1] + 1) * anchor!.module.xy,
    ] as [number, number],
  });
  const activePiece = $derived(active ? layout?.tiles.get(active.tile)?.piece : undefined);
  const validPieces = $derived(new Map([...pieces].filter(([, p]) => p.review.validated)));
  // the clicked face proposes, every neighbour of the new tile must accept (step 15b)
  const candidates = $derived(
    active && layout
      ? checkCandidates(
          candidatesFor(active, layout, validPieces, types).sort((a, b) =>
            pieces.get(a.piece)!.editorId.localeCompare(pieces.get(b.piece)!.editorId),
          ),
          layout,
          pieces,
          types,
          geometry,
        )
      : [],
  );
  const around = $derived(
    active && layout && anchor && ed.loaded
      ? surroundings(active, layout, pieces, ed.loaded.grid.opaque, anchor)
      : null,
  );
  const highlights = $derived.by((): Highlight[] => {
    if (!anchor || !showFaces || placing) return [];
    // a bad joint's strip lies inside the neighbour, over the faulty junction
    return [
      ...opens.map((o) => ({
        ...faceRect(o, anchor),
        color: o.id === activeFace ? '#ffd24a' : '#e8a33a',
        opacity: o.id === activeFace ? 0.95 : 0.55,
      })),
      ...bad.map((o) => ({
        ...faceRect(o, anchor),
        color:
          o.fit === 'seam'
            ? o.id === activeFace
              ? '#fff27a'
              : '#e8d23a'
            : o.id === activeFace
              ? '#ff8080'
              : '#e04040',
        opacity: o.id === activeFace ? 0.95 : 0.7,
      })),
      ...shared.map((sc) => ({
        ...cellBox(sc.cell),
        color: '#ff2bd6',
        opacity: sc === activeShared ? 0.8 : 0.45,
      })),
    ];
  });

  /** Face profiles from the mesh analysis, by `EditorID:dir` (rotation 0). */
  const profiles = $derived(
    new Map(
      (catalogueStore.analysis?.faces ?? []).map((f) => [`${f.piece}:${f.opening.dir}`, f.profile]),
    ),
  );
  const profileOf = (pieceKey: FormKey | undefined, dir: string) =>
    pieceKey ? profiles.get(`${pieces.get(pieceKey)?.editorId}:${dir}`) : undefined;

  /** Profiles of a junction in this opening's frame (the same drawing the verdict judges). */
  function jointLayers(joint: BadJoint): { segments: number[][]; color: string }[] {
    const mine = profileOf(layout?.tiles.get(joint.tile)?.piece, joint.opening.dir);
    const layers = mine ? [{ segments: mine, color: '#e04040' }] : [];
    if (!anchor) return layers;
    for (const f of joint.facing) {
      const prof = profileOf(layout?.tiles.get(f.tile)?.piece, f.opening.dir);
      if (prof) {
        layers.push({ segments: inFrameOf(joint, f, prof, anchor.module), color: '#7fdc7f' });
      }
    }
    return layers;
  }

  function openFace(face: OpenFace | undefined): void {
    activeFace = face?.id ?? null;
    ghost = null;
    if (face) ed.selected = null;
  }

  function previewCandidate(c: Candidate | null): void {
    if (c) showGhost(pieces.get(c.piece)!, c.cell, c.rotation);
    else ghost = null;
  }

  function placeCandidate(c: Candidate): void {
    if (!layout) return;
    const r = addTile(layout, pieces, c.piece, c.cell, c.rotation);
    if (apply(r, 'Placement') && r.ok) {
      activeFace = null;
      ghost = null;
    }
  }

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
      const face = showFaces && anchor ? faceAt(info.world, [...opens, ...bad], anchor) : undefined;
      if (face) {
        openFace(face);
        activeShared = null;
        return;
      }
      const under = showFaces ? cellUnder(info.world) : null;
      const sc = under && shared.find((x) => x.cell[0] === under[0] && x.cell[1] === under[1]);
      activeFace = null;
      activeShared = sc ?? null;
      if (sc) {
        ed.selected = null;
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

  // ---- saving (step 15) ----------------------------------------------------------------------

  /** The CK warning is confirmed once per page load. */
  let ckWarned = false;

  async function save(): Promise<void> {
    if (!pending || !anchor || !changeCount(pending)) return;
    if (
      !ckWarned &&
      !window.confirm(
        'Save into the plugin now?\n\n' +
          'If the Creation Kit has this plugin open, do not save it from the CK afterwards ' +
          'without reloading it first: the CK would overwrite these changes.\n\n' +
          'A timestamped backup of the current file is made before writing.',
      )
    )
      return;
    ckWarned = true;
    stopPlacing();
    activeFace = null;
    await ed.save(editsFromChanges(pending, pieces, anchor));
  }

  // unsaved edits are lost when the page closes
  function onBeforeUnload(e: BeforeUnloadEvent): void {
    if (pending && changeCount(pending)) e.preventDefault();
  }

  async function reloadPlugin(): Promise<void> {
    if (
      pending &&
      changeCount(pending) &&
      !window.confirm('Reload the plugin from disk and drop the unsaved edits?')
    )
      return;
    const cell = ed.loaded?.cell;
    await ed.openPlugin(ed.store?.name);
    if (cell && ed.cells.some((c) => c.key === cell)) await ed.openCell(cell);
  }

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
    if ((e.ctrlKey || e.metaKey) && key === 's') {
      void save();
    } else if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) {
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
      else if (activeFace || activeShared) {
        openFace(undefined);
        activeShared = null;
      } else ed.selected = null;
    } else return;
    e.preventDefault();
  }

  const COLORS: Record<string, string> = CATEGORY_COLORS;
</script>

<svelte:window onkeydown={onKey} onbeforeunload={onBeforeUnload} />

<section>
  {#if !session.ready}
    <SessionNotice />
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
      <button
        disabled={ed.busy}
        title="Read the plugin again from disk, e.g. after saving it in the Creation Kit"
        onclick={reloadPlugin}>Reload plugin</button
      >
      {#if history}
        <button disabled={!history.past.length} onclick={() => (history = undo(history!))}
          >Undo</button
        >
        <button disabled={!history.future.length} onclick={() => (history = redo(history!))}
          >Redo</button
        >
      {/if}
      {#if pending && changeCount(pending)}
        <button class="save" disabled={ed.busy} onclick={save} title="Ctrl+S">Save to plugin</button
        >
        <span class="warn">
          unsaved: {pending.added.length} added, {pending.moved.length} moved, {pending.removed
            .length} removed
        </span>
      {/if}
      {#if ed.busy}<span>{catalogueStore.progress || 'working...'}</span>{/if}
      {#if ed.error}<span class="err">{ed.error}</span>{/if}
    </div>
    {#if ed.message}<p class="hint">{ed.message}</p>{/if}

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
            {:else if activeShared}
              <b class="err">Shared cell</b>
              {activeShared.cell.join(',')}, claimed by:
              {#each activeShared.tiles as k (k)}
                <div>
                  {pieces.get(layout.tiles.get(k)?.piece ?? '')?.editorId} at cell {layout.tiles
                    .get(k)
                    ?.cell.join(',')}, rot {(layout.tiles.get(k)?.rotation ?? 0) * 90}°
                </div>
              {/each}
              <div class="hint">
                Two tiles overlap here (tolerated in a loaded level, refused for new placements).
                Esc to close.
              </div>
            {:else if activeBad}
              {@const mine = pieces.get(layout.tiles.get(activeBad.tile)?.piece ?? '')}
              <b class="err"
                >{activeBad.fit === 'seam'
                  ? `Seam of ${activeBad.gap.toFixed(1)} units`
                  : activeBad.facing.length
                    ? Number.isNaN(activeBad.gap)
                      ? 'Mismatched junction'
                      : `Mismatched junction (${activeBad.gap.toFixed(0)} units off)`
                    : 'Opening against a wall'}</b
              >: {mine?.editorId} ({activeBad.dir}) runs into
              {activeBad.against
                .map((k) => pieces.get(layout.tiles.get(k)?.piece ?? '')?.editorId)
                .join(', ')}.
              <ProfileView size={140} layers={jointLayers(activeBad)} />
              <div class="hint">
                Red: this opening. Green: the openings in front, mirrored as seen from this side,
                shifted to their true place along the face. Exact or included (one drawing inside
                the other) passes; a gap over {SEAM_TOL} units is a seam.
              </div>
              <div class="hint diag">
                this: {activeBad.opening.face.conn}{activeBad.opening.face.extraConn?.length
                  ? ` +${activeBad.opening.face.extraConn.join('+')}`
                  : ''} (mate {types.get(activeBad.opening.face.conn)?.mate}), cells
                {activeBad.cells.map((c) => c.join(',')).join(' ')}
                {#each activeBad.facing as f (f.id)}
                  <br />facing: {pieces.get(layout.tiles.get(f.tile)?.piece ?? '')?.editorId}
                  {f.dir}
                  {f.opening.face.conn}{f.opening.face.extraConn?.length
                    ? ` +${f.opening.face.extraConn.join('+')}`
                    : ''}, cells {f.cells.map((c) => c.join(',')).join(' ')}
                {:else}
                  <br />facing: no opening on that side (wall)
                {/each}
              </div>
              <div class="hint">Esc to close.</div>
            {:else if active}
              {@const own = profileOf(activePiece, active.opening.dir)}
              <b>Open face</b> of {pieces.get(activePiece ?? '')?.editorId}
              ({active.dir}, {active.outside.length} cell{active.outside.length > 1 ? 's' : ''})
              {#if own}
                <ProfileView size={90} layers={[{ segments: own, color: '#e8a33a' }]} />
              {/if}
              <div class="hint">
                face cells {active.cells.map((c) => c.join(',')).join(' ')}, outside
                {active.outside.map((c) => c.join(',')).join(' ')}
              </div>
              {#if around && (around.tiles.length || around.opaque.length)}
                <div class="warn">
                  In front of this face (any level):
                  {#each around.tiles as t (t.key)}
                    <div>
                      tile {pieces.get(t.piece)?.editorId} at cell {t.cell.join(',')}, rot {t.rotation *
                        90}°
                    </div>
                  {/each}
                  {#each around.opaque as o (o.ref.refFormKey)}
                    <div>
                      {pieces.get(o.ref.base)?.editorId} kept out of the grid: {o.reason}
                      (pos {o.ref.pos.map((v) => v.toFixed(1)).join(', ')}, rz {(
                        (o.ref.rot[2] * 180) /
                        Math.PI
                      ).toFixed(1)}°)
                    </div>
                  {/each}
                </div>
              {/if}
              <div class="hint">
                {candidates.length} compatible placement{candidates.length === 1 ? '' : 's'}: hover
                to preview, click to place, Esc to close.
              </div>
              <ul class="candidates">
                {#each candidates as c, n (n)}
                  {@const prof = profileOf(c.piece, c.opening.dir)}
                  <li>
                    <button
                      onmouseenter={() => previewCandidate(c)}
                      onmouseleave={() => previewCandidate(null)}
                      onclick={() => placeCandidate(c)}
                    >
                      {#if prof}
                        <ProfileView size={44} layers={[{ segments: prof, color: '#7fdc7f' }]} />
                      {/if}
                      <span>
                        <span
                          class="swatch"
                          style:background={COLORS[pieces.get(c.piece)!.category] ?? '#999'}
                        ></span>
                        {pieces.get(c.piece)!.editorId}
                        <span class="hint">by {c.opening.dir}, {c.rotation * 90}°</span>
                        {#if c.fit === 'seam'}
                          <span class="warn"
                            >seam of {c.gap.toFixed(1)} with {c.seamWith
                              .map((k) => pieces.get(layout.tiles.get(k)?.piece ?? '')?.editorId)
                              .join(', ')}</span
                          >
                        {/if}
                      </span>
                    </button>
                  </li>
                {/each}
              </ul>
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
                >Click a tile to select it, an orange open face for compatible pieces (red: a
                junction that does not fit), or a piece below to place it. Drag to pan, wheel to
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

          <label class="hint"
            ><input type="checkbox" bind:checked={showFaces} /> Show open faces ({opens.length}),
            mismatched junctions ({bad.length}) and shared cells ({shared.length})</label
          >
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
          {highlights}
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
  .diag {
    user-select: text;
    font-family: monospace;
  }
  .save {
    font-weight: 600;
  }
  .candidates {
    list-style: none;
    padding: 0;
    margin: 0.3rem 0 0;
    max-height: 50vh;
    overflow: auto;
  }
  .candidates button {
    width: 100%;
    text-align: left;
    display: flex;
    gap: 0.5rem;
    align-items: center;
    font-size: 12px;
    margin: 1px 0;
  }
  .swatch {
    display: inline-block;
    width: 0.7rem;
    height: 0.7rem;
    flex: none;
  }
</style>
