<script lang="ts">
  /**
   * Steps 13-14: edit a cell's tiles. Pure logic lives in $lib/grid (edit, assist); this page
   * wires it to the scene (pointer events), the keyboard, the piece palette and the contextual
   * assistant (open faces and compatible pieces). Nothing is written to the plugin until
   * step 15.
   */
  import SessionNotice from '../components/SessionNotice.svelte';
  import { untrack } from 'svelte';
  import CellView from '../components/CellView.svelte';
  import ProfileView from '../components/ProfileView.svelte';
  import type { Catalogue, FormKey, Piece, PieceCategory } from '$lib/catalogue/types';
  import { editorStore as ed } from '$lib/editor/editorStore.svelte';
  import { leakChecker, type LeakVerdict } from '$lib/editor/leakChecker.svelte';
  import { textureChecker } from '$lib/editor/textureChecker.svelte';
  import { bake } from '$lib/navmesh/bake';
  import { buildNavMesh } from '$lib/navmesh/build';
  import {
    coveredTiles,
    mergeNavMesh,
    removeTriangles,
    trianglesInTiles,
  } from '$lib/navmesh/stitch';
  import {
    elementsInBox,
    pickElement,
    trianglesOfSelection,
    type NavElement,
  } from '$lib/navmesh/pick';
  import type { NavMeshData } from '$lib/format/esp/navm';
  import { fromFormKey } from '$lib/format/esp/formId';
  import { getPref, setPref } from '$lib/fs';
  import {
    addTile,
    badJoints,
    candidatesFor,
    checkCandidates,
    jointsOfTile,
    layoutJunction,
    layoutJunctions,
    layoutSides,
    cellAt,
    changeCount,
    changes,
    commit,
    conflictsFor,
    faceAt,
    inFrameOf,
    DEPTH_TOL,
    SEAM_TOL,
    faceRect,
    footprintCells,
    historyOf,
    acceptedOverlaps,
    layoutFromGrid,
    relativePlacement,
    openFaces,
    placeTile,
    withoutTile,
    redo,
    removeTile,
    removeTiles,
    moveTiles,
    tileWorldPlacement,
    rotateTile,
    sharedCells,
    snapPlacement,
    surroundings,
    undo,
    type BadJoint,
    type Candidate,
    type JointGeometry,
    type LayoutJunction,
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
    type NavLayer,
    type PointerInfo,
    type SceneHandlers,
  } from '$lib/render';
  import { setOverlap } from '$lib/catalogue/annotationEdits';
  import { annotationStore } from '$lib/session/annotationStore.svelte';
  import { catalogueStore } from '$lib/session/catalogueStore.svelte';
  import { session } from '$lib/session/session.svelte';

  const emptyCatalogue: Catalogue = { version: 1, kits: [], connectionTypes: [], pieces: [] };

  let cellKey = $state('');
  let history = $state.raw<History | null>(null);
  /** The cell `history` belongs to: a layout is only drawn with its own cell (and anchor). */
  let historyFor = $state.raw<typeof ed.loaded>(null);
  let original = $state.raw<Layout | null>(null);
  let placing = $state<{ piece: FormKey; rotation: 0 | 1 | 2 | 3 } | null>(null);
  let drag = $state.raw<{
    key: string;
    grab: CellIndex;
    target: CellIndex;
    rotation: 0 | 1 | 2 | 3;
  } | null>(null);
  let ghost = $state.raw<{ object: ReturnType<typeof tileObject>; ok: boolean } | null>(null);
  /** Shift+drag: the selection rectangle, from where the drag started to the pointer. */
  let box = $state.raw<{ from: Vec3; to: Vec3 } | null>(null);
  /** Dragging a selection of several tiles: where the drag started and the cell offset now. */
  let groupDrag = $state.raw<{ grab: CellIndex; delta: CellIndex } | null>(null);
  let message = $state('');
  let filter = $state('');
  let category = $state<PieceCategory | 'all'>('all');
  let showFaces = $state(true);
  let activeFace = $state<string | null>(null);

  // open the last cell of the working plugin once it is open (no "Load" click needed)
  let autoCellFor = '';
  $effect(() => {
    const store = ed.store;
    if (!store || ed.loaded || ed.busy || autoCellFor === store.name) return;
    const first = ed.initialCell;
    if (!first) return;
    autoCellFor = store.name;
    void ed.openCell(first);
  });

  async function chooseCell(key: string): Promise<void> {
    if (
      pending &&
      changeCount(pending) &&
      !window.confirm('Open another cell and drop the unsaved edits of this one?')
    ) {
      cellKey = ed.loaded?.cell ?? cellKey;
      return;
    }
    cellKey = key;
    await ed.openCell(key);
  }

  // open the remembered working plugin as soon as the game folder is restored, which may
  // finish after this page is shown (browser reload on /editor)
  let autoOpened = false;
  $effect(() => {
    if (autoOpened || !session.ready || ed.store || !ed.rememberedPlugin) return;
    autoOpened = true;
    void ed.openPlugin();
  });

  $effect(() => {
    if (ed.loaded) cellKey = ed.loaded.cell;
    else if (!cellKey && ed.cells.length) cellKey = ed.initialCell ?? '';
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
    const layout = layoutFromGrid(
      loaded.grid,
      own,
      untrack(() => accepted),
    );
    original = layout;
    history = historyOf(layout);
    historyFor = loaded;
    placing = null;
    drag = null;
    ghost = null;
    activeFace = null;
  });

  const catalogue = $derived(ed.catalogue ?? emptyCatalogue);
  const accepted = $derived(acceptedOverlaps(catalogue.overlaps ?? []));

  // an overlap marked as intended applies to the whole history at once
  $effect(() => {
    const set = accepted;
    const h = untrack(() => history);
    if (!h || h.present.accepted === set) return;
    const withSet = (l: Layout): Layout => ({ ...l, accepted: set });
    history = {
      past: h.past.map(withSet),
      present: withSet(h.present),
      future: h.future.map(withSet),
    };
  });
  const pieces = $derived(piecesByFormKey(catalogue));
  const anchor = $derived(ed.loaded?.grid.anchor);
  const layout = $derived(history?.present ?? null);
  const models = $derived(
    new Map((catalogueStore.stats?.stats ?? []).map((st) => [st.formKey, st.model])),
  );
  const objects = $derived(
    layout && ed.loaded && historyFor === ed.loaded
      ? layoutObjects(layout, ed.loaded, catalogue, models)
      : [],
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
  // ---- deep junction check (R16): background, cached by pieces and relative placement --------

  const junctions = $derived(
    layout && anchor ? layoutJunctions(layout, pieces, types, anchor) : [],
  );
  $effect(() => {
    const js = junctions;
    if (!layout || !anchor || js.length === 0) {
      leakChecker.cancel();
      return;
    }
    const sides = layoutSides(layout, pieces, anchor);
    const p = pieces;
    let alive = true;
    void ed.meshes().then((m) => {
      if (alive) void leakChecker.run(js, sides, p, m);
    });
    // leaving the editor, or a new layout, stops the run
    return () => {
      alive = false;
      leakChecker.cancel();
    };
  });
  const verdictOf = (key: string): LeakVerdict | undefined => leakChecker.verdicts.get(key);
  const leaking = $derived(junctions.filter((j) => (verdictOf(j.key)?.leaks.length ?? 0) > 0));
  /** Verdict of a joint of the layout (or of a simulated layout), undefined until checked. */
  function jointVerdict(joint: BadJoint, l: Layout): LeakVerdict | undefined {
    if (!anchor || joint.against.length === 0) return undefined;
    return verdictOf(layoutJunction(joint, l, pieces, anchor).key);
  }

  // ---- texture continuity (optional, off by default) -------------------------------------------

  $effect(() => {
    const js = junctions;
    if (!textureChecker.enabled || js.length === 0) return;
    const p = pieces;
    void ed.meshes().then((m) => textureChecker.request(js, p, m));
  });
  const textureBroken = $derived(
    textureChecker.enabled
      ? junctions.filter((j) => (textureChecker.verdicts.get(j.key)?.length ?? 0) > 0)
      : [],
  );
  /** Texture breaks of a joint of the layout (or of a simulated one), undefined until checked. */
  function jointBreaks(joint: BadJoint, l: Layout) {
    if (!anchor || joint.against.length === 0) return undefined;
    return textureChecker.verdicts.get(layoutJunction(joint, l, pieces, anchor).key);
  }

  const active = $derived(opens.find((o) => o.id === activeFace));
  const activeBad = $derived(bad.find((o) => o.id === activeFace));
  const shared = $derived(layout ? sharedCells(layout, pieces) : []);
  const seams = $derived(bad.filter((j) => j.fit === 'seam').length);

  // store messages (saved, cell added...) show for a few seconds
  let toast = $state('');
  $effect(() => {
    const text = ed.message;
    if (!text) return;
    toast = text;
    const timer = setTimeout(() => (toast = ''), 6000);
    return () => clearTimeout(timer);
  });
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
  // every junction of the selected tile, good ones included, to inspect a verdict
  const tileJoints = $derived(
    ed.selected && layout && layout.tiles.has(ed.selected)
      ? jointsOfTile(layout, pieces, types, ed.selected, geometry)
      : [],
  );
  let inspected = $state<string | null>(null);
  const inspectedJoint = $derived(tileJoints.find((j) => j.id === inspected));
  const nameOf = (key: string) => pieces.get(layout?.tiles.get(key)?.piece ?? '')?.editorId;
  const FIT_LABEL: Record<string, string> = {
    exact: 'exact',
    included: 'included',
    seam: 'seam',
    mismatch: 'mismatch',
  };
  const activePiece = $derived(active ? layout?.tiles.get(active.tile)?.piece : undefined);
  const validPieces = $derived(new Map([...pieces].filter(([, p]) => p.review.validated)));
  // the clicked face proposes, every neighbour of the new tile must accept (step 15b)
  // placements that fit by profile; those with a junction known to leak are set apart
  const fitting = $derived(
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
  const leakFree = (c: Candidate): boolean => {
    if (!layout || !anchor) return true;
    const placed = addTile(layout, pieces, c.piece, c.cell, c.rotation);
    if (!placed.ok) return true;
    return jointsOfTile(placed.layout, pieces, types, placed.key).every(
      (j) => (jointVerdict(j, placed.layout)?.leaks.length ?? 0) === 0,
    );
  };
  const candidates = $derived(fitting.filter(leakFree));
  const leakyCandidates = $derived(fitting.filter((c) => !leakFree(c)));
  let candFilter = $state('');
  let candCategory = $state<PieceCategory | 'all'>('all');
  /**
   * With the texture check on, each candidate's junctions once placed, to rank the ones that keep
   * the texture continuous first: 0 continuous, 1 not checked yet, 2 a texture break.
   */
  const candidateJunctions = $derived.by((): { c: Candidate; js: LayoutJunction[] }[] => {
    if (!textureChecker.enabled || !layout || !anchor) return [];
    const a = anchor;
    const l = layout;
    return candidates.flatMap((c) => {
      const placed = addTile(l, pieces, c.piece, c.cell, c.rotation);
      if (!placed.ok) return [];
      const js = jointsOfTile(placed.layout, pieces, types, placed.key)
        .filter((j) => j.against.length > 0)
        .map((j) => layoutJunction(j, placed.layout, pieces, a));
      return [{ c, js }];
    });
  });
  $effect(() => {
    const needed = candidateJunctions.flatMap((x) => x.js);
    if (needed.length === 0) return;
    const p = pieces;
    void ed.meshes().then((m) => textureChecker.request(needed, p, m));
  });
  const candidateTexture = $derived.by((): WeakMap<Candidate, 0 | 1 | 2> => {
    const out = new WeakMap<Candidate, 0 | 1 | 2>();
    for (const { c, js } of candidateJunctions) {
      const verdicts = js.map((j) => textureChecker.verdicts.get(j.key));
      out.set(c, verdicts.some((v) => v && v.length > 0) ? 2 : verdicts.every((v) => v) ? 0 : 1);
    }
    return out;
  });
  const shownCandidates = $derived.by(() => {
    const needle = candFilter.trim().toLowerCase();
    const shown = candidates.filter((c) => {
      const p = pieces.get(c.piece)!;
      return (
        (candCategory === 'all' || p.category === candCategory) &&
        (!needle || p.editorId.toLowerCase().includes(needle))
      );
    });
    // stable sort: texture-continuous placements first when the check is on
    return textureChecker.enabled
      ? shown
          .map((c, i) => ({ c, i, rank: candidateTexture.get(c) ?? 1 }))
          .sort((x, y) => x.rank - y.rank || x.i - y.i)
          .map((x) => x.c)
      : shown;
  });
  const around = $derived(
    active && layout && anchor && ed.loaded
      ? surroundings(active, layout, pieces, ed.loaded.grid.opaque, anchor)
      : null,
  );
  // ---- NavMesh tools (V2 steps 10 to 12): bake, replace, clear, fill, lock -------------------

  type NavMode = 'bake' | 'replace' | 'clear';
  type NavWrite = { navm?: string; nav: NavMeshData | null };

  /**
   * An operation on the cell's NavMeshes, computed before anything is written: the state of every
   * NAVM after it (drawn), the edits that write it, and why it cannot be written, if so.
   */
  let navPreview = $state.raw<{
    mode: NavMode;
    vertices: readonly Vec3[];
    triangles: readonly (readonly number[])[];
    writes: NavWrite[];
    unlinked: [Vec3, Vec3][];
    note: string;
    /** Why it cannot be written, if so. */
    blocked?: string;
  } | null>(null);

  /** Per-cell "locked" flag (D37): the finishing phase, no replace or clear. Kept in the browser. */
  const lockKey = $derived(
    ed.store && ed.loaded ? `navLock.${ed.store.name}.${ed.loaded.cell}` : '',
  );
  let lockVersion = $state(0);
  const locked = $derived(lockVersion >= 0 && !!lockKey && getPref(lockKey) === '1');
  function setLocked(on: boolean): void {
    if (lockKey) setPref(lockKey, on ? '1' : undefined);
    lockVersion++;
    navPreview = null;
  }

  const navGrid = $derived(anchor ? { origin: anchor.origin, module: anchor.module } : null);

  /** "Fill": bake the tiles no NavMesh of the cell covers yet (with a walkable area). */
  function fillNavMesh(): void {
    if (!layout || !ed.loaded || !navGrid) return;
    const footprints = [...layout.tiles.keys()].map((key) => ({ key, cells: tileCells(key) }));
    const covered = new Set(
      ed.loaded.navmeshes.flatMap((n) => [...coveredTiles(n.nav, footprints, navGrid)]),
    );
    const keys = footprints
      .map((f) => f.key)
      .filter((key) => {
        const piece = pieces.get(layout!.tiles.get(key)!.piece);
        return !covered.has(key) && !!piece?.walkable?.length;
      });
    if (!keys.length) {
      message = 'Every tile with a walkable floor already has a NavMesh.';
      return;
    }
    planNavMesh('bake', keys);
  }

  /** The tiles the NavMesh tools work on: the region and the selected elements' tiles, or all. */
  function navTargets(): string[] {
    if (!layout) return [];
    const keys = [...navRegion];
    const nav = activeNav?.nav;
    if (nav && navSel.length) {
      const V = nav.vertices;
      const tris = trianglesOfSelection(nav, navKind, navSel);
      for (const i of tris) {
        const t = nav.triangles[i]!.vertices;
        const c: Vec3 = [0, 1, 2].map(
          (a) => t.reduce((s, v) => s + V[v]![a]!, 0) / 3,
        ) as unknown as Vec3;
        for (const key of tilesInBox(c, c)) keys.push(key);
      }
    }
    return keys.length ? [...new Set(keys)] : [...layout.tiles.keys()];
  }

  function planNavMesh(mode: NavMode, only?: string[]): void {
    if (!layout || !anchor || !ed.loaded || !ed.store || !navGrid) return;
    const keys = only ?? navTargets();
    const started = performance.now();
    let blocked: string | undefined;
    if (pending && changeCount(pending)) blocked = 'save the tile edits first';
    if (navChanged) blocked = 'write or undo the NavMesh edits first';
    if (mode !== 'bake' && locked) blocked = 'the cell NavMesh is locked (finishing phase)';
    const footprints = keys.map((key) => ({ key, cells: tileCells(key) }));
    // the NAVM's parent cell, as a FormID of the plugin itself (its index after the masters)
    const cellFormId = fromFormKey(ed.loaded.cell, ed.store.masters, ed.store.name);

    // 1. replace and clear: the selected tiles' triangles go, from every NAVM holding some
    let navmeshes = ed.loaded.navmeshes.map((n) => ({ ...n }));
    // one write per NAVM key, the last one winning
    const writes: Record<string, NavWrite> = {};
    let removed = 0;
    if (mode !== 'bake') {
      navmeshes = navmeshes.map((n) => {
        const inside = trianglesInTiles(n.nav, footprints, navGrid);
        if (!inside.length) return n;
        if (!n.own) blocked ??= `the NavMesh ${n.key} belongs to a master (D22)`;
        removed += inside.length;
        const nav = removeTriangles(n.nav, inside);
        writes[n.key] = { navm: n.key, nav: nav.triangles.length ? nav : null };
        return { ...n, nav };
      });
      navmeshes = navmeshes.filter((n) => n.nav.triangles.length > 0);
    }

    // 2. bake and replace: the tiles still without NavMesh are baked beside the others (D64)
    let baked = 0;
    let target: (typeof navmeshes)[number] | null = null;
    let unlinked: [Vec3, Vec3][] = [];
    let skipped = 0;
    let tileCount = 0;
    if (mode !== 'clear') {
      const covered = new Set(
        navmeshes.flatMap((n) => [...coveredTiles(n.nav, footprints, navGrid)]),
      );
      skipped = covered.size;
      const tiles = keys.flatMap((key) => {
        const tile = layout!.tiles.get(key);
        const piece = tile && pieces.get(tile.piece);
        if (!tile || covered.has(key) || !piece?.walkable?.length) return [];
        const at = tileWorldPlacement(tile, piece, anchor!);
        return [{ key, rings: piece.walkable, pos: at.pos, heading: at.rot[2] }];
      });
      tileCount = tiles.length;
      const exclude = navmeshes.flatMap((n) =>
        n.nav.triangles.map(
          (t) => t.vertices.map((v) => n.nav.vertices[v]!) as unknown as [Vec3, Vec3, Vec3],
        ),
      );
      const result = bake(
        tiles,
        {},
        { origin: [anchor.origin[0], anchor.origin[1]], cell: anchor.module.xy },
        exclude,
      );
      if (result.triangles.length) {
        // the bake joins the own NAVM sharing the most vertices with it, else the largest own
        // one, else a new one; the others stay as they are
        const touching = (n: (typeof navmeshes)[number]) =>
          result.vertices.filter((p) =>
            n.nav.vertices.some(
              (q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= 1 && Math.abs(q[2] - p[2]) <= 64,
            ),
          ).length;
        const scored = navmeshes.filter((n) => n.own).map((n) => ({ n, touch: touching(n) }));
        scored.sort(
          (x, y) => y.touch - x.touch || y.n.nav.triangles.length - x.n.nav.triangles.length,
        );
        target = scored[0]?.n ?? null;
        const others = navmeshes.filter((n) => n !== target).flatMap((n) => n.nav.vertices);
        try {
          const merged = mergeNavMesh(target?.nav ?? null, result, cellFormId, {
            weld: 0.5,
            step: 64,
            others,
          });
          // the same validity rules as a fresh NavMesh: no edge shared by three triangles
          buildNavMesh(
            cellFormId,
            merged.nav.vertices,
            merged.nav.triangles.map((t) => t.vertices),
          );
          baked = merged.added;
          unlinked = merged.unlinked;
          if (target) {
            writes[target.key] = { navm: target.key, nav: merged.nav };
            navmeshes = navmeshes.map((n) => (n === target ? { ...n, nav: merged.nav } : n));
          } else {
            writes['new'] = { nav: merged.nav };
            navmeshes = [...navmeshes, { key: 'new', own: true, nav: merged.nav }];
          }
        } catch (e) {
          blocked ??= `the result is not a valid NAVM: ${(e as Error).message}`;
          console.warn('NavMesh preview:', e);
        }
      }
    }

    // draw every NavMesh of the cell as it would be
    const vertices: Vec3[] = [];
    const triangles: (readonly number[])[] = [];
    for (const n of navmeshes) {
      const base = vertices.length;
      vertices.push(...n.nav.vertices);
      for (const t of n.nav.triangles) triangles.push(t.vertices.map((v) => v + base));
    }
    const parts = [
      mode !== 'bake' ? `${removed} triangles removed from the selected tiles` : '',
      mode !== 'clear'
        ? `${tileCount} tiles baked (${skipped} with NavMesh skipped), ${baked} triangles added to ` +
          (target ? `the NavMesh ${target.key}` : baked ? 'a new NavMesh' : 'nothing') +
          `, ${unlinked.length} unlinked border edges`
        : '',
      `${Object.keys(writes).length} NavMesh record${Object.keys(writes).length === 1 ? '' : 's'} to write`,
      `${(performance.now() - started).toFixed(0)} ms`,
    ];
    if (!Object.keys(writes).length) blocked ??= 'nothing to write';
    navPreview = {
      mode,
      vertices,
      triangles,
      writes: Object.values(writes),
      unlinked,
      note: parts.filter(Boolean).join('; '),
      ...(blocked ? { blocked } : {}),
    };
  }

  async function writeNavMesh(): Promise<void> {
    const p = navPreview;
    if (!p || p.blocked) return;
    const what =
      p.mode === 'bake'
        ? 'Write this NavMesh into the plugin now?'
        : p.mode === 'replace'
          ? 'Delete the NavMesh of the selected tiles and write the new bake in its place?'
          : 'Delete the NavMesh of the selected tiles?';
    if (
      !window.confirm(
        `${what}\n\nA timestamped backup of the current file is made first. Then open the ` +
          'plugin in the Creation Kit and Finalize the NavMesh (door links, cover).',
      )
    )
      return;
    const ok = await ed.save(
      p.writes.map((w) => ({ kind: 'navmesh', nav: w.nav, ...(w.navm ? { navm: w.navm } : {}) })),
    );
    if (ok) navPreview = null;
  }

  // ---- "Edit NavMesh" mode (V2 step 14): select and delete NavMesh elements, wipe a NAVM ------

  let navEdit = $state(false);
  let navKind = $state<NavElement>('triangle');
  /** The NAVM being edited (its key). */
  let navActive = $state<string | null>(null);
  /** Edited NavMeshes by key, null once wiped; the others are as loaded. */
  let navWork = $state.raw<Record<string, NavMeshData | null>>({});
  let navUndo = $state.raw<Record<string, NavMeshData | null>[]>([]);
  let navRedo = $state.raw<Record<string, NavMeshData | null>[]>([]);
  let navSel = $state.raw<(number | string)[]>([]);
  /** Tiles within the last Shift+drag rectangle drawn on empty floor: where the tools bake. */
  let navRegion = $state.raw<string[]>([]);

  // a new cell starts a fresh NavMesh edit
  $effect(() => {
    void ed.loaded;
    navWork = {};
    navUndo = [];
    navRedo = [];
    navSel = [];
    navRegion = [];
    navActive = null;
  });

  /** The cell's NavMeshes with the edits applied (wiped ones left out). */
  const navNow = $derived(
    (ed.loaded?.navmeshes ?? []).flatMap((n) => {
      const work = n.key in navWork ? navWork[n.key] : n.nav;
      return work ? [{ ...n, nav: work }] : [];
    }),
  );
  const navChanged = $derived(Object.keys(navWork).length > 0);
  const activeNav = $derived(navNow.find((n) => n.key === navActive));

  function navCommit(next: Record<string, NavMeshData | null>): void {
    navUndo = [...navUndo, navWork];
    navRedo = [];
    navWork = next;
    navSel = [];
  }

  function navClick(info: PointerInfo): void {
    // a click on another NAVM's triangle makes it the active one
    const hit = (n: (typeof navNow)[number]) =>
      pickElement(n.nav, 'triangle', info.world[0], info.world[1], 0) !== undefined;
    if (!activeNav || !hit(activeNav)) {
      const other = navNow.find(hit);
      if (other && other.key !== navActive) {
        navActive = other.key;
        navSel = [];
        if (navKind === 'triangle') return;
      }
    }
    const nav = navNow.find((n) => n.key === navActive)?.nav;
    if (!nav) return;
    const tol = anchor ? anchor.module.xy / 10 : 12;
    const picked = pickElement(nav, navKind, info.world[0], info.world[1], tol);
    if (picked === undefined) {
      if (!info.shift) {
        navSel = [];
        navRegion = [];
      }
      return;
    }
    if (info.shift)
      navSel = navSel.includes(picked) ? navSel.filter((x) => x !== picked) : [...navSel, picked];
    else navSel = [picked];
  }

  function navBoxSelect(from: Vec3, to: Vec3): void {
    const nav = activeNav?.nav;
    const inside = nav ? elementsInBox(nav, navKind, from[0], from[1], to[0], to[1]) : [];
    navSel = [...new Set([...navSel, ...inside])];
    // a rectangle over tiles without NavMesh marks them for Bake
    navRegion = inside.length ? [] : tilesInBox(from, to);
    navPreview = null;
  }

  function navDeleteSelection(): void {
    const nav = activeNav?.nav;
    if (!nav || !navActive || !navSel.length) return;
    if (!activeNav.own) {
      message = 'This NavMesh belongs to a master and is not edited (D22).';
      return;
    }
    const gone = trianglesOfSelection(nav, navKind, navSel);
    if (!gone.length) return;
    const after = removeTriangles(nav, gone);
    navCommit({ ...navWork, [navActive]: after.triangles.length ? after : null });
    message = `${gone.length} triangles deleted (not saved yet).`;
  }

  function navWipe(key: string): void {
    const n = navNow.find((x) => x.key === key);
    if (!n) return;
    if (!n.own) {
      message = 'This NavMesh belongs to a master and is not edited (D22).';
      return;
    }
    if (!window.confirm(`Wipe the whole NavMesh ${key} (${n.nav.triangles.length} triangles)?`))
      return;
    navCommit({ ...navWork, [key]: null });
    message = `NavMesh ${key} wiped (not saved yet).`;
  }

  function navUndoStep(): void {
    if (!navUndo.length) return;
    navRedo = [...navRedo, navWork];
    navWork = navUndo[navUndo.length - 1]!;
    navUndo = navUndo.slice(0, -1);
    navSel = [];
  }

  function navRedoStep(): void {
    if (!navRedo.length) return;
    navUndo = [...navUndo, navWork];
    navWork = navRedo[navRedo.length - 1]!;
    navRedo = navRedo.slice(0, -1);
    navSel = [];
  }

  async function navSave(): Promise<void> {
    if (!navChanged) return;
    if (pending && changeCount(pending)) {
      window.alert('Save or undo the tile edits first.');
      return;
    }
    if (
      !window.confirm(
        'Write the NavMesh changes into the plugin now?\n\nA timestamped backup of the current ' +
          'file is made first.',
      )
    )
      return;
    const ok = await ed.save(
      Object.entries(navWork).map(([navm, nav]) => ({ kind: 'navmesh', navm, nav })),
    );
    if (ok) {
      navWork = {};
      navUndo = [];
      navRedo = [];
    }
  }

  function toggleNavEdit(): void {
    if (
      navEdit &&
      navChanged &&
      !window.confirm('Leave NavMesh editing and drop its unsaved changes?')
    )
      return;
    navEdit = !navEdit;
    navWork = {};
    navUndo = [];
    navRedo = [];
    navSel = [];
    navRegion = [];
    navPreview = null;
    ed.selection = [];
    if (navEdit && !navActive) navActive = ed.loaded?.navmeshes[0]?.key ?? null;
  }

  /** Colour of a NAVM in the list and the view, by its rank. */
  const NAV_COLORS = ['#3a8dde', '#46b07a', '#c58b3a', '#a565c9', '#d0576f', '#4fb6b8'];

  /** What the scene draws: the NavMeshes being edited and the selection, or a bake preview. */
  const navLayers = $derived.by((): NavLayer[] | null => {
    if (!navEdit) {
      return navPreview
        ? [
            {
              vertices: navPreview.vertices,
              triangles: navPreview.triangles,
              fill: '#3a8dde',
              line: '#b8dcff',
            },
          ]
        : null;
    }
    if (navPreview)
      return [
        {
          vertices: navPreview.vertices,
          triangles: navPreview.triangles,
          fill: '#3a8dde',
          line: '#b8dcff',
        },
      ];
    const layers: NavLayer[] = navNow.map((n, i) => {
      const active = n.key === navActive;
      return {
        vertices: n.nav.vertices,
        triangles: n.nav.triangles.map((t) => t.vertices),
        fill: active ? '#ffb347' : NAV_COLORS[i % NAV_COLORS.length]!,
        line: active ? '#ffe2b8' : '#b8dcff',
        opacity: active ? 0.4 : 0.2,
      };
    });
    const nav = activeNav?.nav;
    if (nav && navSel.length) {
      const V = nav.vertices;
      if (navKind === 'triangle')
        layers.push({
          vertices: V,
          triangles: (navSel as number[]).map((i) => nav.triangles[i]!.vertices),
          fill: '#ff3030',
          line: '#ffffff',
          opacity: 0.55,
        });
      else if (navKind === 'edge') {
        // a WebGL line is one pixel wide: selected edges are drawn as red ribbons
        const w = (anchor ? anchor.module.xy : 128) / 40;
        const vertices: Vec3[] = [];
        const triangles: number[][] = [];
        for (const name of navSel as string[]) {
          const [u, v] = name.split(':').map(Number) as [number, number];
          const p = V[u]!;
          const q = V[v]!;
          const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
          const nx = (-(q[1] - p[1]) / len) * w;
          const ny = ((q[0] - p[0]) / len) * w;
          const n = vertices.length;
          vertices.push(
            [p[0] + nx, p[1] + ny, p[2]],
            [p[0] - nx, p[1] - ny, p[2]],
            [q[0] - nx, q[1] - ny, q[2]],
            [q[0] + nx, q[1] + ny, q[2]],
          );
          triangles.push([n, n + 1, n + 2], [n, n + 2, n + 3]);
        }
        layers.push({ vertices, triangles, fill: '#ff2020', line: '#ff2020', opacity: 0.95 });
      } else
        layers.push({
          points: (navSel as number[]).map((v) => V[v]!),
          fill: '#ff3030',
          line: '#ff3030',
        });
    }
    if (layout && anchor && navRegion.length) {
      const m = anchor.module;
      const lines: (readonly [Vec3, Vec3])[] = [];
      for (const key of navRegion)
        for (const [i, j, k] of tileCells(key)) {
          const x = anchor.origin[0] + i * m.xy;
          const y = anchor.origin[1] + j * m.xy;
          const z = anchor.origin[2] + k * m.z;
          const c: Vec3[] = [
            [x, y, z],
            [x + m.xy, y, z],
            [x + m.xy, y + m.xy, z],
            [x, y + m.xy, z],
          ];
          for (let a = 0; a < 4; a++) lines.push([c[a]!, c[(a + 1) % 4]!]);
        }
      layers.push({ lines, fill: '#ffffff', line: '#ffffff' });
    }
    return layers;
  });

  /** Footprint cells of a tile, moved by `delta`. */
  function tileCells(key: string, delta: CellIndex = [0, 0, 0]): CellIndex[] {
    const tile = layout?.tiles.get(key);
    const piece = tile && pieces.get(tile.piece);
    if (!tile || !piece) return [];
    return footprintCells(piece, tile.cell, tile.rotation).map(
      (c) => [c[0] + delta[0], c[1] + delta[1], c[2] + delta[2]] as CellIndex,
    );
  }

  const groupMove = $derived(
    groupDrag && layout && (groupDrag.delta[0] || groupDrag.delta[1])
      ? moveTiles(layout, pieces, ed.selection, groupDrag.delta)
      : null,
  );
  /** The selection rectangle and, while a group is dragged, where its tiles would land. */
  const selectionHighlights = $derived.by((): Highlight[] => {
    if (!anchor) return [];
    const out: Highlight[] = [];
    if (box) {
      out.push({
        min: [Math.min(box.from[0], box.to[0]), Math.min(box.from[1], box.to[1])],
        max: [Math.max(box.from[0], box.to[0]), Math.max(box.from[1], box.to[1])],
        color: '#ffffff',
        opacity: 0.2,
      });
    }
    for (const [a, b] of navPreview?.unlinked ?? []) {
      out.push({
        min: [Math.min(a[0], b[0]) - 4, Math.min(a[1], b[1]) - 4],
        max: [Math.max(a[0], b[0]) + 4, Math.max(a[1], b[1]) + 4],
        color: '#ff3030',
        opacity: 0.9,
      });
    }
    if (groupDrag && groupMove) {
      for (const key of ed.selection)
        for (const c of tileCells(key, groupDrag.delta))
          out.push({ ...cellBox(c), color: groupMove.ok ? '#7fdc7f' : '#e05050', opacity: 0.45 });
    }
    return out;
  });

  /** Keys of the tiles whose footprint meets the rectangle between two world points. */
  function tilesInBox(a: Vec3, b: Vec3): string[] {
    if (!layout || !anchor) return [];
    const x0 = Math.min(a[0], b[0]);
    const x1 = Math.max(a[0], b[0]);
    const y0 = Math.min(a[1], b[1]);
    const y1 = Math.max(a[1], b[1]);
    return [...layout.tiles.keys()].filter((key) =>
      tileCells(key).some((c) => {
        const r = cellBox(c);
        return r.max[0] > x0 && r.min[0] < x1 && r.max[1] > y0 && r.min[1] < y1;
      }),
    );
  }

  function toggleSelected(key: string): void {
    ed.selection = ed.selection.includes(key)
      ? ed.selection.filter((k) => k !== key)
      : [...ed.selection, key];
  }

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
      ...leaking.map((j) => ({
        ...faceRect(j.joint, anchor),
        color: '#b04bff',
        opacity: j.joint.id === activeFace ? 0.95 : 0.75,
      })),
      ...textureBroken.map((j) => ({
        ...faceRect(j.joint, anchor),
        color: '#35c2d6',
        opacity: j.joint.id === activeFace ? 0.95 : 0.7,
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

  /** Every pair among the tiles claiming a shared cell. */
  const overlapPairs = (keys: string[]): [string, string][] =>
    keys.flatMap((a, i) => keys.slice(i + 1).map((b): [string, string] => [a, b]));

  function acceptOverlap(a: string, b: string): void {
    const ta = layout?.tiles.get(a);
    const tb = layout?.tiles.get(b);
    const ea = ta && pieces.get(ta.piece)?.editorId;
    const eb = tb && pieces.get(tb.piece)?.editorId;
    if (!ta || !tb || !ea || !eb) return;
    const rel = relativePlacement(ta, tb);
    annotationStore.update((ann) =>
      setOverlap(ann, { pieces: [ea, eb], rotation: rel.rotation, offset: [...rel.offset] }, true),
    );
    ed.refreshCatalogue();
    activeShared = null;
    message = `${ea} + ${eb} recorded as an intended overlap. Save the annotations in Settings, Validation.`;
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

  /**
   * Where the piece being placed goes: snapped onto a nearby open face it fits (pieces do not
   * all line up with the plain grid), else on the grid under the pointer.
   */
  function placementAt(world: Vec3): { cell: CellIndex; rotation: 0 | 1 | 2 | 3 } {
    const p = placing!;
    const snapped =
      layout && anchor
        ? snapPlacement({
            world,
            anchor,
            layout,
            pieces,
            types,
            piece: p.piece,
            rotation: p.rotation,
            opens,
            geometry,
          })
        : null;
    return (
      snapped ?? {
        cell: cellAt(world, anchor!, pieces.get(p.piece)!, p.rotation),
        rotation: p.rotation,
      }
    );
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
      if (navEdit) {
        navClick(info);
        return;
      }
      if (placing && layout && anchor) {
        const { cell, rotation } = placementAt(info.world);
        const r = addTile(layout, pieces, placing.piece, cell, rotation);
        // a snap may have turned the piece: keep that rotation for the next one
        if (r.ok) placing = { ...placing, rotation };
        if (apply(r, 'Placement') && r.ok && !info.shift) {
          // keep placing the same piece; Shift+click places and stops
        } else if (r.ok && info.shift) {
          stopPlacing();
          ed.selected = r.key;
        }
        return;
      }
      // a leak first: open the nearest free face (within two cells), where a piece plugs it
      const leak =
        showFaces && anchor
          ? faceAt(
              info.world,
              leaking.map((j) => j.joint),
              anchor,
            )
          : undefined;
      if (leak && anchor) {
        const centre = (o: OpenFace) => {
          const r = faceRect(o, anchor);
          return [(r.min[0] + r.max[0]) / 2, (r.min[1] + r.max[1]) / 2];
        };
        const [lx, ly] = centre(leak);
        let plug: OpenFace | undefined;
        let best = 2 * anchor.module.xy;
        for (const o of opens) {
          const [ox, oy] = centre(o);
          const d = Math.hypot(ox! - lx!, oy! - ly!);
          if (d <= best) {
            best = d;
            plug = o;
          }
        }
        if (plug) {
          openFace(plug);
          activeShared = null;
          return;
        }
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
      if (info.shift && info.key) toggleSelected(info.key);
      else ed.selected = info.key;
    },
    down(info: PointerInfo) {
      if (navEdit) {
        if (!info.shift) return false;
        box = { from: info.world, to: info.world };
        return true;
      }
      if (placing || !layout) return false;
      // Shift+drag: select the tiles within a rectangle
      if (info.shift) {
        box = { from: info.world, to: info.world };
        return true;
      }
      if (!info.key || !ed.selection.includes(info.key)) return false;
      if (ed.selection.length > 1) {
        groupDrag = { grab: cellUnder(info.world), delta: [0, 0, 0] };
        return true;
      }
      const tile = layout.tiles.get(info.key);
      if (!tile?.own) return false;
      const grab = cellUnder(info.world);
      drag = { key: info.key, grab, target: tile.cell, rotation: tile.rotation };
      return true;
    },
    move(info: PointerInfo) {
      if (!layout || !anchor) return;
      if (box) {
        box = { ...box, to: info.world };
      } else if (groupDrag) {
        const now = cellUnder(info.world);
        groupDrag = {
          ...groupDrag,
          delta: [now[0] - groupDrag.grab[0], now[1] - groupDrag.grab[1], 0],
        };
      } else if (placing) {
        const { cell, rotation } = placementAt(info.world);
        showGhost(pieces.get(placing.piece)!, cell, rotation);
      } else if (drag) {
        const tile = layout.tiles.get(drag.key)!;
        const piece = pieces.get(tile.piece)!;
        const now = cellUnder(info.world);
        const onGrid: CellIndex = [
          tile.cell[0] + now[0] - drag.grab[0],
          tile.cell[1] + now[1] - drag.grab[1],
          tile.cell[2],
        ];
        // snap as for a new piece, from the dragged tile's centre, with the tile out of the way
        const rest = withoutTile(layout, tile.key);
        const cells = footprintCells(piece, onGrid, tile.rotation);
        const centre: Vec3 = [
          anchor.origin[0] +
            ((Math.min(...cells.map((c) => c[0])) + Math.max(...cells.map((c) => c[0])) + 1) / 2) *
              anchor.module.xy,
          anchor.origin[1] +
            ((Math.min(...cells.map((c) => c[1])) + Math.max(...cells.map((c) => c[1])) + 1) / 2) *
              anchor.module.xy,
          0,
        ];
        const snapped = snapPlacement({
          world: centre,
          anchor,
          layout: rest,
          pieces,
          types,
          piece: tile.piece,
          rotation: tile.rotation,
          opens: openFaces(rest, pieces),
          geometry,
        });
        const target = snapped?.cell ?? onGrid;
        const rotation = snapped?.rotation ?? tile.rotation;
        drag = { ...drag, target, rotation };
        showGhost(piece, target, rotation, tile.key);
      }
    },
    up(info: PointerInfo) {
      if (box && navEdit) {
        if (
          anchor &&
          Math.hypot(box.to[0] - box.from[0], box.to[1] - box.from[1]) < anchor.module.xy / 8
        )
          navClick(info);
        else navBoxSelect(box.from, box.to);
        box = null;
        return;
      }
      if (box) {
        // hardly moved: a Shift+click, which adds or removes the tile under the pointer
        if (
          anchor &&
          Math.hypot(box.to[0] - box.from[0], box.to[1] - box.from[1]) < anchor.module.xy / 8
        ) {
          box = null;
          if (info.key) toggleSelected(info.key);
          return;
        }
        const inside = tilesInBox(box.from, box.to);
        // the rectangle adds to the selection
        ed.selection = [...new Set([...ed.selection, ...inside])];
        box = null;
        return;
      }
      if (groupDrag) {
        if (groupMove) apply(groupMove, 'Move');
        groupDrag = null;
        return;
      }
      if (drag && layout) {
        const tile = layout.tiles.get(drag.key)!;
        const same =
          drag.target.every((v, i) => v === tile.cell[i]) && drag.rotation === tile.rotation;
        if (!same) apply(placeTile(layout, pieces, drag.key, drag.target, drag.rotation), 'Move');
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

  async function newCell(): Promise<void> {
    if (pending && changeCount(pending)) {
      window.alert('Save or undo the edits of this cell first.');
      return;
    }
    const editorId = window.prompt(
      'EditorID of the new interior cell (letters, digits and _), e.g. MyDungeon01:',
    );
    if (!editorId?.trim()) return;
    await ed.addCell(editorId.trim());
    if (ed.loaded) cellKey = ed.loaded.cell;
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
    if (!layout || ed.selection.length === 0) return;
    const r =
      ed.selection.length === 1
        ? removeTile(layout, ed.selection[0]!)
        : removeTiles(layout, ed.selection);
    if (apply(r, 'Deletion')) ed.selection = [];
  }

  function onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
    if (!history) return;
    const key = e.key.toLowerCase();
    if (navEdit) {
      if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) navUndoStep();
      else if ((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey)))
        navRedoStep();
      else if ((e.ctrlKey || e.metaKey) && key === 's') void navSave();
      else if (key === 'delete' || key === 'backspace') navDeleteSelection();
      else if (key === 'escape') navSel = [];
      else return;
      e.preventDefault();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === 's') {
      void save();
    } else if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) {
      history = undo(history);
      ghost = null;
    } else if ((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey))) {
      history = redo(history);
      ghost = null;
    } else if ((e.ctrlKey || e.metaKey) && key === 'a') {
      ed.selection = layout ? [...layout.tiles.keys()] : [];
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
      Choose the working plugin in <a href="#/settings">Settings</a>.
      {#if ed.busy}<span>opening...</span>{/if}
      {#if ed.error}<span class="err">{ed.error}</span>{/if}
    </p>
  {:else}
    <div class="toolbar">
      <select
        value={cellKey}
        disabled={ed.busy}
        title="Cell of the working plugin"
        onchange={(e) => chooseCell((e.currentTarget as HTMLSelectElement).value)}
      >
        {#each ed.cells as c (c.key)}
          <option value={c.key}>{c.editorId} ({c.placedCount} placed)</option>
        {/each}
      </select>
      <button disabled={ed.busy} onclick={newCell}>New cell...</button>
      {#if history}
        <span class="group">
          <button
            disabled={!history.past.length}
            title="Undo (Ctrl+Z)"
            onclick={() => (history = undo(history!))}>↶ Undo</button
          >
          <button
            disabled={!history.future.length}
            title="Redo (Ctrl+Y)"
            onclick={() => (history = redo(history!))}>↷ Redo</button
          >
        </span>
      {/if}
      <span class="spacer"></span>
      {#if ed.busy}<span class="hint">{catalogueStore.progress || 'working...'}</span>{/if}
      {#if ed.error}<span class="err">{ed.error}</span>{/if}
      {#if annotationStore.dirty}
        <a class="warn" href="#/settings/validation" title="Save them in Settings, Validation"
          >Annotations to save</a
        >
      {/if}
      <button
        class="save"
        disabled={ed.busy || !pending || !changeCount(pending)}
        onclick={save}
        title={pending && changeCount(pending)
          ? `${pending.added.length} added, ${pending.moved.length} moved, ${pending.removed.length} removed (Ctrl+S)`
          : 'Nothing to save'}
        >Save{pending && changeCount(pending) ? ` (${changeCount(pending)})` : ''}</button
      >
      <button
        disabled={ed.busy}
        title="Read the plugin again from disk, e.g. after saving it in the Creation Kit"
        onclick={reloadPlugin}>Reload plugin</button
      >
    </div>
    {#if toast}<p class="toast">{toast}</p>{/if}

    {#if ed.loaded && layout && summary}
      <div class="cols">
        <aside>
          <div class="selection">
            {#if placing}
              <b>Placing {pieces.get(placing.piece)?.editorId}</b>, rotation {placing.rotation *
                90}°<br />
              <span class="hint"
                >Near an orange face it fits, the piece snaps onto it. Click to place (Shift+click:
                place and stop), R / Shift+R to rotate, Esc to stop.</span
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
                Two tiles overlap here (tolerated in a loaded level, refused for new placements). If
                it is intended (a door nested into its neighbour to hide the joint, with no visible
                seam), mark it: the pair is then accepted in that exact placement everywhere, not
                flagged, and may be placed.
              </div>
              {#each overlapPairs(activeShared.tiles) as [a, b] (a + b)}
                <button onclick={() => acceptOverlap(a, b)}
                  >Mark {pieces.get(layout.tiles.get(a)!.piece)?.editorId} +
                  {pieces.get(layout.tiles.get(b)!.piece)?.editorId} as intended</button
                >
              {/each}
              <div class="hint">Esc to close.</div>
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
              <details class="hint">
                <summary>Details</summary>
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
              </details>
              <h3 class="list-title">
                Compatible pieces ({shownCandidates.length}{shownCandidates.length ===
                candidates.length
                  ? ''
                  : ` of ${candidates.length}`})
              </h3>
              <div class="filters">
                <input placeholder="search compatible pieces" bind:value={candFilter} />
                <select bind:value={candCategory}>
                  <option value="all">all</option>
                  <option value="hall">hall</option>
                  <option value="room">room</option>
                  <option value="door">door</option>
                </select>
              </div>
              <div class="hint">Hover to preview, click to place, Esc to close.</div>
              {#if leakyCandidates.length}
                <div class="hint">
                  {leakyCandidates.length} set aside, known to leak:
                  {[...new Set(leakyCandidates.map((c) => pieces.get(c.piece)!.editorId))].join(
                    ', ',
                  )}
                </div>
              {/if}
              <ul class="candidates">
                {#each shownCandidates as c, n (n)}
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
                        {#if textureChecker.enabled && candidateTexture.get(c) === 2}
                          <span class="texture-break">texture break</span>
                        {/if}
                      </span>
                    </button>
                  </li>
                {/each}
              </ul>
            {:else if ed.selection.length > 1}
              <b>{ed.selection.length} tiles selected</b><br />
              <button onclick={deleteSelected}>Delete (Del)</button>
              <button onclick={() => (ed.selection = [])}>Clear selection (Esc)</button>
              <div class="hint">
                Drag one of them to move them all. Shift+click adds or removes a tile, Shift+drag
                adds the tiles within a rectangle, Ctrl+A selects every tile.
              </div>
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
              {#if tileJoints.length}
                {@const issues = tileJoints.filter(
                  (j) => j.fit === 'seam' || j.fit === 'mismatch',
                ).length}
                <details class="joints" open={issues > 0}>
                  <summary
                    >Junctions ({tileJoints.length}{issues ? `, ${issues} to check` : ''})</summary
                  >
                  {#each tileJoints as j (j.id)}
                    <button
                      class:active={inspected === j.id}
                      class={j.fit}
                      onclick={() => (inspected = inspected === j.id ? null : j.id)}
                    >
                      {j.tile === selectedTile.key
                        ? `${j.dir} to ${j.against.map(nameOf).join(', ')}`
                        : `${nameOf(j.tile)} (${j.dir}) into this`}:
                      {FIT_LABEL[j.fit]}{Number.isNaN(j.gap) ? '' : ` ${j.gap.toFixed(1)}`}
                      {#if layout && (jointVerdict(j, layout)?.leaks.length ?? 0) > 0}
                        <span class="leak">· leak</span>
                      {/if}
                      {#if textureChecker.enabled && layout && (jointBreaks(j, layout)?.length ?? 0) > 0}
                        <span class="texture-break">· texture</span>
                      {/if}
                    </button>
                  {/each}
                </details>
                {#if inspectedJoint}
                  {@const verdict = layout ? jointVerdict(inspectedJoint, layout) : undefined}
                  {#if verdict && verdict.leaks.length > 0 && layout && anchor}
                    {@const lj = layoutJunction(inspectedJoint, layout, pieces, anchor)}
                    <div class="warn">
                      Visible leak (deep check):
                      {#each verdict.leaks as leak, i (i)}
                        <br />gap {leak.width.toFixed(1)} units at
                        {leakChecker
                          .leakCentre(lj, leak)
                          .map((v) => v.toFixed(0))
                          .join(', ')}, seen from {leak.seen} of {leak.views} standing points
                      {/each}
                    </div>
                  {:else if verdict}
                    <div class="hint">
                      Deep check: no visible leak ({verdict.candidates} hidden gap{verdict.candidates ===
                      1
                        ? ''
                        : 's'}).
                    </div>
                  {/if}
                  {#if textureChecker.enabled && layout}
                    {@const breaks = jointBreaks(inspectedJoint, layout)}
                    {#if breaks && breaks.length > 0}
                      <div class="warn">
                        Texture break:
                        {#each breaks as b, i (i)}
                          <br />{b.cause === 'texture'
                            ? `${b.texture.split('/').pop()} meets ${b.other?.split('/').pop()}`
                            : `${b.texture.split('/').pop()} shifted by ${b.offset.toFixed(2)} of a repeat`}
                          over {b.length.toFixed(0)} units
                        {/each}
                      </div>
                    {:else if breaks}
                      <div class="hint">Texture continuous across the junction.</div>
                    {/if}
                  {/if}
                  <ProfileView size={140} layers={jointLayers(inspectedJoint)} />
                  <div class="hint diag">
                    {#if inspectedJoint.detail}
                      red on green within {inspectedJoint.detail.mineOnTheirs.toFixed(1)}, green on
                      red within {inspectedJoint.detail.theirsOnMine.toFixed(1)} units (exact: both under
                      {SEAM_TOL}; included: one under {SEAM_TOL})
                    {:else}
                      judged by connection types (no profile)
                    {/if}
                    {#if inspectedJoint.depth !== undefined}
                      <br />gap between the opening planes: {inspectedJoint.depth.toFixed(1)} units (seam
                      over {DEPTH_TOL}; negative: they overlap)
                    {/if}
                  </div>
                {/if}
              {/if}
            {:else}
              <span class="hint"
                >Click an orange face to add a piece that fits, or pick a piece below. Click a tile
                to select it.</span
              >
              <details class="hint">
                <summary>Shortcuts</summary>
                Drag: pan (or move the selected tiles) · Shift+click: add to the selection · Shift+drag:
                select a rectangle · Ctrl+A: select all · Wheel: zoom · R / Shift+R: rotate · Del: delete
                · Esc: cancel · Ctrl+Z / Ctrl+Y: undo / redo · Ctrl+S: save
              </details>
            {/if}
            {#if message}<div class="warn">{message}</div>{/if}
          </div>

          {#if !active && !navEdit}<div class="palette">
              <h3 class="list-title">Pieces</h3>
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
            </div>{/if}

          <div class="navmesh-edit">
            <button class:active={navEdit} onclick={toggleNavEdit}
              >{navEdit ? 'Leave NavMesh editing' : 'Edit NavMesh'}</button
            >
            {#if navEdit}
              <div class="kinds">
                Select:
                {#each ['triangle', 'edge', 'vertex'] as const as k (k)}
                  <label
                    ><input
                      type="radio"
                      name="navkind"
                      checked={navKind === k}
                      onchange={() => {
                        navKind = k;
                        navSel = [];
                      }}
                    />
                    {k}s</label
                  >
                {/each}
              </div>
              <ul class="navms">
                {#each navNow as n, i (n.key)}
                  <li>
                    <button
                      class:active={n.key === navActive}
                      onclick={() => {
                        navActive = n.key;
                        navSel = [];
                      }}
                    >
                      <span
                        class="swatch"
                        style:background={n.key === navActive
                          ? '#ffb347'
                          : NAV_COLORS[i % NAV_COLORS.length]}
                      ></span>
                      {n.key.split(':')[0]}
                      <span class="hint"
                        >{n.nav.triangles.length} triangles{n.own ? '' : ', master'}{n.key in
                        navWork
                          ? ', edited'
                          : ''}</span
                      >
                    </button>
                    {#if n.own}<button title="Wipe this NavMesh" onclick={() => navWipe(n.key)}
                        >Wipe</button
                      >{/if}
                  </li>
                {:else}
                  <li class="hint">No NavMesh in this cell.</li>
                {/each}
              </ul>
              <div class="hint">
                {navSel.length}
                {navKind}{navSel.length === 1 ? '' : 's'} selected. Click to select, Shift+click to add
                or remove, Shift+drag a rectangle; Del deletes (a triangle, or the triangles using a selected
                edge or vertex); Ctrl+Z / Ctrl+Y undo and redo.
              </div>
              <button disabled={!navSel.length} onclick={navDeleteSelection}
                >Delete selection</button
              >
              <button disabled={!navChanged} onclick={navSave}>Write NavMesh changes</button>
            {/if}
          </div>
          <div class="navmesh-preview" class:hidden={!navEdit}>
            <b>Bake</b>
            <button onclick={fillNavMesh} title="Bake every tile no NavMesh covers yet">Fill</button
            >
            <button
              onclick={() => planNavMesh('bake')}
              title="Bake the tiles of the white rectangle (Shift+drag on empty floor), or the cell"
              >Bake {navRegion.length
                ? 'region'
                : navSel.length
                  ? 'selection'
                  : 'whole cell'}</button
            >
            <button disabled={locked} onclick={() => planNavMesh('replace')}>Replace</button>
            <button disabled={locked} onclick={() => planNavMesh('clear')}>Clear</button>
            <label title="Finishing phase: no replace or clear in this cell"
              ><input
                type="checkbox"
                checked={locked}
                onchange={(e) => setLocked(e.currentTarget.checked)}
              /> Locked</label
            >
            {#if navPreview}
              <div class="hint">
                {navPreview.mode === 'bake'
                  ? 'Bake'
                  : navPreview.mode === 'replace'
                    ? 'Replace'
                    : 'Clear'} preview: {navPreview.note}.
              </div>
              <button
                disabled={!!navPreview.blocked}
                title={navPreview.blocked ?? 'Write it into the plugin'}
                onclick={writeNavMesh}>Write NavMesh</button
              >
              <button onclick={() => (navPreview = null)}>Cancel</button>
              {#if navPreview.blocked}<div class="warn">
                  Cannot write: {navPreview.blocked}.
                </div>{/if}
              {#if navPreview.unlinked.length}
                <div class="hint">
                  Red: new border edges next to a NavMesh but not welded to it; link them in the
                  Creation Kit.
                </div>
              {/if}
            {/if}
          </div>
          <div class="legend">
            <label><input type="checkbox" bind:checked={showFaces} /> Show marks</label>
            <span><i style:background="#e8a33a"></i>open face {opens.length}</span>
            <span><i style:background="#e8d23a"></i>seam {seams}</span>
            <span><i style:background="#e04040"></i>mismatch {bad.length - seams}</span>
            <span><i style:background="#ff2bd6"></i>shared cell {shared.length}</span>
            <label
              ><input
                type="checkbox"
                checked={textureChecker.enabled}
                onchange={(e) => textureChecker.setEnabled(e.currentTarget.checked)}
              /> Texture continuity check</label
            >
            {#if textureChecker.enabled}
              <span><i style:background="#35c2d6"></i>texture break {textureBroken.length}</span>
            {/if}
            <span
              ><i style:background="#b04bff"></i>leak {leaking.length}{leakChecker.done <
              leakChecker.total
                ? ` (checking ${leakChecker.done}/${leakChecker.total})`
                : ''}</span
            >
          </div>
          <details class="hint">
            <summary>Cell info</summary>
            {ed.loaded.refs.length} references: {ed.loaded.grid.tiles.length} tiles,
            {ed.loaded.grid.opaque.length} other objects (not part of the kit), {ed.loaded.grid
              .overlaps.length} shared cells when loaded.
          </details>
        </aside>

        <CellView
          {objects}
          {grid}
          {ghost}
          highlights={[...highlights, ...selectionHighlights]}
          {handlers}
          meshes={() => ed.meshes()}
          selection={navEdit ? [] : ed.selection}
          navmesh={navLayers}
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
  .joints {
    margin-top: 0.4rem;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .joints button {
    text-align: left;
    font-size: 12px;
  }
  .joints button.seam {
    color: #e8d23a;
  }
  .joints button.mismatch {
    color: #e04040;
  }
  .joints .leak {
    color: #c77dff;
  }
  .texture-break {
    color: #35c2d6;
  }
  .navmesh-preview.hidden {
    display: none;
  }
  .navms {
    list-style: none;
    margin: 0.3rem 0;
    padding: 0;
    max-height: 12rem;
    overflow: auto;
  }
  .navms li {
    display: flex;
    gap: 0.3rem;
  }
  .navms li button:first-child {
    flex: 1;
    text-align: left;
  }
  .navms button.active,
  .navmesh-edit > button.active {
    outline: 1px solid #ffb347;
  }
  .joints button.active {
    border-color: var(--accent);
  }
  .diag {
    user-select: text;
    font-family: monospace;
  }
  /* the one primary action: filled with the accent colour */
  .save {
    font-weight: 600;
    color: var(--bg);
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 0.3rem 1rem;
    cursor: pointer;
  }
  .save:hover:not(:disabled) {
    filter: brightness(1.1);
  }
  .save:disabled {
    color: var(--fg-muted);
    background: transparent;
    border-color: var(--border);
    cursor: default;
  }
  .group {
    display: inline-flex;
    gap: 2px;
  }
  .spacer {
    flex: 1;
  }
  .toast {
    margin: 0 0 0.5rem;
    padding: 0.3rem 0.6rem;
    border-left: 3px solid var(--accent);
    background: var(--bg-panel);
    font-size: 13px;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.8rem;
    font-size: 12px;
    color: var(--fg-muted);
    margin: 0.5rem 0;
  }
  .legend i {
    display: inline-block;
    width: 0.7rem;
    height: 0.7rem;
    margin-right: 0.3rem;
    vertical-align: -1px;
  }
  .legend label {
    flex-basis: 100%;
  }
  .list-title {
    margin: 0.5rem 0 0.3rem;
    font-size: 15px;
  }
  .filters {
    display: flex;
  }
  .filters input {
    flex: 1;
    min-width: 0;
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
