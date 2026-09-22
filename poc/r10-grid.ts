/**
 * R10 proof of concept: build a provisional Imperial catalogue (STAT records of Skyrim.esm
 * joined with the R5 measurements), read a cell's references (working plugin or vanilla),
 * derive the grid, and draw the result: recognized tiles as cells, opaque refs as dots.
 */
import { PREF_KEYS, getPref, readAll, setPref } from '$lib/fs';
import { FileRangeSource } from '$lib/format/bsa';
import {
  Plugin,
  collectCellRefs,
  decodeStat,
  listInteriorCells,
  modelArchivePath,
  readTopGroup,
  scanTopGroups,
  toFormKey,
  type CellEntry,
  type RefEntry,
  type StatInfo,
} from '$lib/format/esp';
import { cellsAreNormalized, type CellIndex, type Piece } from '$lib/catalogue/types';
import { deriveGrid, type DeriveResult } from '$lib/grid';
import type { PlacedRef } from '$lib/grid/types';
import type { OverlayFileInfo } from '$lib/vfs';
import { bindProfileSelect, describeView, openDataView, type DataView } from './shared/dataView';

interface PieceTable {
  module: number;
  zModule: number;
  pieces: Record<
    string,
    { subkit: string; pivot: [number, number, number]; cells: CellIndex[]; fits: boolean }
  >;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $<HTMLPreElement>('log');
const log = (m: string, cls = '') => {
  const line = document.createElement('div');
  line.textContent = `${new Date().toLocaleTimeString()}  ${m}`;
  if (cls) line.className = cls;
  logEl.prepend(line);
};
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

let view: DataView | null = null;
let plugins: OverlayFileInfo[] = [];
let stats: Map<number, StatInfo> | null = null; // Skyrim.esm STAT by FormID (index 0)
let catalogue: Map<string, Piece> | null = null; // by FormKey
let subkitOf = new Map<string, string>();
let table: PieceTable | null = null;
let cells: { entry: CellEntry; masters: string[]; self: string }[] = [];

async function useView(v: DataView): Promise<void> {
  view = v;
  plugins = await v.overlay.listFiles('', { suffix: '.esp' });
  const select = $<HTMLSelectElement>('plugin');
  select.innerHTML = plugins
    .map((p, i) => `<option value="${i}">${escape(p.name)}</option>`)
    .join('');
  const remembered = getPref(PREF_KEYS.workPlugin);
  const idx = plugins.findIndex((p) => p.name === remembered);
  if (idx !== -1) select.value = String(idx);
  $('status').textContent = describeView(v);
  $('status').className = 'ok';
  $<HTMLButtonElement>('list').disabled = false;
  bindProfileSelect($<HTMLSelectElement>('profile'), v, (next) => void useView(next));
}

async function skyrimEsm(): Promise<FileRangeSource> {
  const found = await view!.overlay.resolveFile('Skyrim.esm');
  if (!found) throw new Error('Skyrim.esm not found');
  return FileRangeSource.open(found.file);
}

/** STAT records of Skyrim.esm joined with the R5 piece table -> provisional catalogue. */
async function buildCatalogue(): Promise<void> {
  if (catalogue) return;
  const t0 = performance.now();
  table = (await (await fetch('/poc/data/imperial-pieces.json')).json()) as PieceTable;
  const source = await skyrimEsm();
  const index = await scanTopGroups(source);
  const statGroup = await readTopGroup(source, index, 'STAT');
  if (!statGroup) throw new Error('no STAT group in Skyrim.esm');
  stats = new Map();
  catalogue = new Map();
  subkitOf = new Map();
  let imperial = 0;
  for (const node of statGroup.children) {
    if (node.kind !== 'record' || node.type !== 'STAT') continue;
    const info = await decodeStat(node);
    stats.set(info.formId, info);
    const path = modelArchivePath(info.model);
    if (!path.includes('/dungeons/imperial/')) continue;
    imperial++;
    const file = path.slice(path.lastIndexOf('/') + 1);
    const measured = table.pieces[file];
    if (!measured) continue;
    const formKey = toFormKey(info.formId, [], 'Skyrim.esm');
    if (!cellsAreNormalized(measured.cells)) {
      log(`${info.editorId}: cells are not indexed from the min corner, piece skipped`, 'err');
      continue;
    }
    subkitOf.set(formKey, measured.subkit);
    catalogue.set(formKey, {
      editorId: info.editorId,
      formKey,
      model: info.model,
      kit: 'Imperial',
      class: 'tile',
      category: /door/i.test(info.editorId)
        ? 'door'
        : measured.subkit.includes('hall')
          ? 'hall'
          : 'room',
      pivot: measured.pivot,
      cells: measured.cells,
      faces: [],
      walkable: null,
      obstacle: null,
      review: { auto: true, validated: false },
    });
  }
  log(
    `catalogue: ${stats.size} STAT in Skyrim.esm, ${imperial} imperial, ${catalogue.size} matched to R5 measurements (${(performance.now() - t0).toFixed(0)} ms)`,
    'ok',
  );
}

$('list').addEventListener('click', async () => {
  if (!view) return;
  try {
    cells = [];
    const select = $<HTMLSelectElement>('cell');
    select.innerHTML = '';
    if ($<HTMLSelectElement>('source').value === 'plugin') {
      const info = plugins[Number($<HTMLSelectElement>('plugin').value)];
      if (!info) throw new Error('no plugin selected');
      setPref(PREF_KEYS.workPlugin, info.name);
      const plugin = Plugin.parse(await readAll(info.handle), info.name);
      for (const entry of await plugin.interiorCells())
        cells.push({ entry, masters: plugin.masters, self: plugin.name });
    } else {
      const t0 = performance.now();
      const source = await skyrimEsm();
      const index = await scanTopGroups(source);
      const cellGroup = await readTopGroup(source, index, 'CELL');
      if (!cellGroup) throw new Error('no CELL group');
      const filter = $<HTMLInputElement>('filter').value.toLowerCase();
      for (const entry of await listInteriorCells(cellGroup)) {
        if (filter && !entry.info.editorId.toLowerCase().includes(filter)) continue;
        cells.push({ entry, masters: [], self: 'Skyrim.esm' });
      }
      log(`Skyrim.esm CELL group scanned in ${(performance.now() - t0).toFixed(0)} ms`);
    }
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]!;
      const n = c.entry.children
        ? c.entry.children.children.reduce(
            (s, g) => s + (g.kind === 'group' ? g.children.length : 0),
            0,
          )
        : 0;
      select.add(new Option(`${c.entry.info.editorId} (${n} placed)`, String(i)));
    }
    $<HTMLButtonElement>('derive').disabled = cells.length === 0;
    log(`${cells.length} cells listed`, 'ok');
  } catch (error) {
    log(`list failed: ${(error as Error).message}`, 'err');
  }
});

$('derive').addEventListener('click', async () => {
  const chosen = cells[Number($<HTMLSelectElement>('cell').value)];
  if (!chosen) return;
  try {
    await buildCatalogue();
    const refs: RefEntry[] = await collectCellRefs(chosen.entry);
    const placed: PlacedRef[] = refs.map((r) => ({
      refFormKey: toFormKey(r.record.formId, chosen.masters, chosen.self),
      base: toFormKey(r.info.base, chosen.masters, chosen.self),
      pos: r.info.pos,
      rot: r.info.rot,
      scale: r.info.scale,
    }));
    const t0 = performance.now();
    const base = { module: table!.module, zModule: table!.zModule };
    const clockwise = deriveGrid(placed, catalogue!, { ...base, headingSign: -1 });
    const counter = deriveGrid(placed, catalogue!, { ...base, headingSign: 1 });
    const elapsed = performance.now() - t0;
    const result = counter.overlaps.length < clockwise.overlaps.length ? counter : clockwise;
    log(
      `rotation convention: heading clockwise -> ${clockwise.overlaps.length} overlapping cells; counter-clockwise -> ${counter.overlaps.length}; using ${result === counter ? 'counter-clockwise (+1)' : 'clockwise (-1)'}`,
      clockwise.overlaps.length === counter.overlaps.length ? 'warn' : 'ok',
    );
    report(chosen, placed, result, elapsed);
    draw(result);
  } catch (error) {
    log(`derive failed: ${(error as Error).message}`, 'err');
  }
});

function report(
  chosen: (typeof cells)[number],
  placed: PlacedRef[],
  result: DeriveResult,
  elapsed: number,
): void {
  const reasons = new Map<string, number>();
  for (const o of result.opaque) reasons.set(o.reason, (reasons.get(o.reason) ?? 0) + 1);
  // unknown bases: which STATs are they (imperial but unmeasured, or other kits / clutter)?
  const unknown = new Map<string, { count: number; model: string }>();
  for (const o of result.opaque) {
    if (o.reason !== 'unknown-base') continue;
    const formId = Number.parseInt(o.ref.base.slice(0, o.ref.base.indexOf(':')), 16);
    const owner = o.ref.base.slice(o.ref.base.indexOf(':') + 1);
    const stat = owner === 'Skyrim.esm' ? stats!.get(formId) : undefined;
    const key = stat ? stat.editorId : `${o.ref.base} (not a Skyrim.esm STAT)`;
    const e = unknown.get(key) ?? { count: 0, model: stat?.model ?? '' };
    e.count++;
    unknown.set(key, e);
  }
  const top = [...unknown].sort((a, b) => b[1].count - a[1].count).slice(0, 25);
  const bySubkit = new Map<string, number>();
  const byRotation = [0, 0, 0, 0];
  for (const t of result.tiles) {
    const sk = subkitOf.get(t.ref.base) ?? '?';
    bySubkit.set(sk, (bySubkit.get(sk) ?? 0) + 1);
    byRotation[t.rotation]!++;
  }
  const tileOf = new Map(result.tiles.map((t) => [t.ref.refFormKey, t]));
  const overlapPairs = new Map<string, number>();
  const piecePairs = new Map<string, { count: number; example: string }>();
  for (const ov of result.overlaps) {
    const tiles = ov.refs.map((r) => tileOf.get(r)!);
    const rots = tiles
      .map((t) => t.rotation)
      .sort()
      .join('+');
    overlapPairs.set(rots, (overlapPairs.get(rots) ?? 0) + 1);
    const label = tiles
      .map((t) => `${t.pieceEditorId} r${t.rotation}`)
      .sort()
      .join('  x  ');
    const e = piecePairs.get(label) ?? {
      count: 0,
      example: tiles
        .map((t) => `${t.pieceEditorId}@(${t.ref.pos.map((v) => v.toFixed(0)).join(',')})`)
        .join(' / '),
    };
    e.count++;
    piecePairs.set(label, e);
  }
  const worstPairs = [...piecePairs].sort((a, b) => b[1].count - a[1].count).slice(0, 20);
  $('result').innerHTML =
    `<p><b>${escape(chosen.entry.info.editorId)}</b>: ${placed.length} REFR, <span class="ok">${result.tiles.length} tiles</span>, ` +
    `<span class="warn">${result.opaque.length} opaque</span>, ${result.overlaps.length} overlapping cells, ${elapsed.toFixed(1)} ms</p>` +
    `<p>anchor: ${result.anchor.origin.map((v) => v.toFixed(1)).join(', ')} (module ${result.anchor.module.xy})</p>` +
    `<table><tr><th>opaque reason</th><th>count</th></tr>${[...reasons].map(([r, n]) => `<tr><td>${r}</td><td class="num">${n}</td></tr>`).join('')}</table>` +
    `<table><tr><th>tiles by subkit</th><th>count</th></tr>${[...bySubkit].map(([r, n]) => `<tr><td>${r}</td><td class="num">${n}</td></tr>`).join('')}</table>` +
    `<p>tiles by rotation (quarter turns 0..3): ${byRotation.join(' / ')}</p>` +
    `<table><tr><th>overlapping cells by rotations involved</th><th>count</th></tr>${[...overlapPairs].map(([r, n]) => `<tr><td>${r}</td><td class="num">${n}</td></tr>`).join('')}</table>` +
    `<table><tr><th>overlapping piece pairs (top 20)</th><th>cells</th><th>example (positions)</th></tr>${worstPairs
      .map(
        ([k, v]) =>
          `<tr><td>${escape(k)}</td><td class="num">${v.count}</td><td>${escape(v.example)}</td></tr>`,
      )
      .join('')}</table>` +
    `<table><tr><th>unknown base (top 25)</th><th>refs</th><th>model</th></tr>${top
      .map(
        ([k, v]) =>
          `<tr><td>${escape(k)}</td><td class="num">${v.count}</td><td>${escape(v.model)}</td></tr>`,
      )
      .join('')}</table>`;
  log(
    `${chosen.entry.info.editorId}: ${result.tiles.length} tiles, ${result.opaque.length} opaque, anchor ${result.anchor.origin.map((v) => v.toFixed(0)).join(',')}`,
    'ok',
  );
}

const COLORS: Record<string, string> = {
  smallhall: '#6fa8dc',
  largehall: '#3d85c6',
  smallroom: '#93c47d',
  largeroom: '#38761d',
  '?': '#999',
};

function draw(result: DeriveResult): void {
  const canvas = $<HTMLCanvasElement>('map');
  const ctx = canvas.getContext('2d')!;
  const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
  const h = (canvas.height = canvas.clientHeight * devicePixelRatio);
  ctx.clearRect(0, 0, w, h);
  const m = result.anchor.module.xy;
  const pts: [number, number][] = [];
  for (const t of result.tiles)
    for (const c of t.occupied) pts.push([c[0], c[1]], [c[0] + 1, c[1] + 1]);
  for (const o of result.opaque) {
    pts.push([
      (o.ref.pos[0] - result.anchor.origin[0]) / m,
      (o.ref.pos[1] - result.anchor.origin[1]) / m,
    ]);
  }
  if (pts.length === 0) return;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs) - 1;
  const maxX = Math.max(...xs) + 1;
  const minY = Math.min(...ys) - 1;
  const maxY = Math.max(...ys) + 1;
  const scale = Math.min(w / (maxX - minX), h / (maxY - minY));
  const sx = (x: number) => (x - minX) * scale;
  const sy = (y: number) => h - (y - minY) * scale; // +Y up on screen

  ctx.strokeStyle = '#2b2a33';
  ctx.lineWidth = 1;
  for (let x = Math.floor(minX); x <= maxX; x++) {
    ctx.beginPath();
    ctx.moveTo(sx(x), 0);
    ctx.lineTo(sx(x), h);
    ctx.stroke();
  }
  for (let y = Math.floor(minY); y <= maxY; y++) {
    ctx.beginPath();
    ctx.moveTo(0, sy(y));
    ctx.lineTo(w, sy(y));
    ctx.stroke();
  }
  for (const t of result.tiles) {
    ctx.fillStyle = COLORS[subkitOf.get(t.ref.base) ?? '?'] ?? '#999';
    for (const c of t.occupied) {
      ctx.globalAlpha = 0.55;
      ctx.fillRect(sx(c[0]) + 1, sy(c[1] + 1) + 1, scale - 2, scale - 2);
      ctx.globalAlpha = 1;
    }
  }
  for (const ov of result.overlaps) {
    ctx.strokeStyle = '#e07a7a';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx(ov.cell[0]) + 2, sy(ov.cell[1] + 1) + 2, scale - 4, scale - 4);
  }
  for (const o of result.opaque) {
    const x = (o.ref.pos[0] - result.anchor.origin[0]) / m;
    const y = (o.ref.pos[1] - result.anchor.origin[1]) / m;
    ctx.fillStyle = o.reason === 'unknown-base' ? '#d9c27a' : '#e07a7a';
    ctx.beginPath();
    ctx.arc(sx(x), sy(y), Math.max(2, scale * 0.06), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#e8e6ef';
  ctx.font = `${12 * devicePixelRatio}px system-ui`;
  ctx.fillText(
    `grid ${m}; tiles by subkit: ${Object.keys(COLORS)
      .filter((k) => k !== '?')
      .join(', ')}; yellow = unknown base, red = off-grid/tilted/scaled`,
    8,
    16 * devicePixelRatio,
  );
}

$('source').addEventListener('change', () => {
  $<HTMLSelectElement>('plugin').disabled = $<HTMLSelectElement>('source').value !== 'plugin';
});

openDataView()
  .then(useView)
  .catch((error: Error) => {
    $('status').textContent = error.message;
    $('status').className = 'err';
  });
