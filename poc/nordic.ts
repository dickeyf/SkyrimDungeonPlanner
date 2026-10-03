/**
 * V4 step 1 (R19): first measurement of the Nordic kit from Skyrim.esm's STAT records. Lists
 * the model sub-folders under `dungeons/nordic/`, the pieces' sizes from their object bounds
 * (OBND), how well candidate XY and Z modules fit those sizes, and the pieces that could join
 * the Imperial kit (names or folders mixing both).
 */
import { analyseKit } from '$lib/catalogue/analyze';
import { loadKitStats } from '$lib/catalogue/build';
import { NORDIC_KIT, type KitDefinition } from '$lib/catalogue/kits';
import { ArchiveIndex } from '$lib/vfs';
import type { KitStat } from '$lib/catalogue/extract';
import { bindProfileSelect, describeView, openDataView, type DataView } from './shared/dataView';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
let view: DataView | null = null;

/** A provisional kit: every piece under the prefix, no sub-folder known yet (all "other"). */
const probe = (kit: string, modelPrefix: string): KitDefinition => ({
  kit,
  module: { xy: 1, z: 1 },
  modelPrefix,
  subkits: {},
});

async function useView(v: DataView): Promise<void> {
  view = v;
  $('status').textContent = describeView(v);
  $('status').className = 'ok';
  $<HTMLButtonElement>('run').disabled = false;
  $<HTMLButtonElement>('analyse').disabled = false;
  bindProfileSelect($<HTMLSelectElement>('profile'), v, (next) => void useView(next));
}

/** Share of sizes within `tol` of a multiple of `m` (at least one module). */
function fit(sizes: number[], m: number, tol: number): number {
  const ok = sizes.filter((s) => {
    const r = s % m;
    return s >= m - tol && (r <= tol || m - r <= tol);
  });
  return sizes.length ? ok.length / sizes.length : 0;
}

function size(s: KitStat): [number, number, number] | null {
  const b = s.bounds;
  return b ? [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] : null;
}

function table(head: string[], rows: (string | number)[][]): string {
  return (
    `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>` +
    rows.map((r) => `<tr>${r.map((c) => `<td>${escape(String(c))}</td>`).join('')}</tr>`).join('') +
    '</table>'
  );
}

$('run').addEventListener('click', async () => {
  if (!view) return;
  $('result').textContent = 'Working...';
  const t0 = performance.now();
  const nordic = (await loadKitStats(view.overlay, probe('NordicProbe', 'dungeons/nordic/'))).stats;
  const dungeons = (await loadKitStats(view.overlay, probe('DungeonsProbe', 'dungeons/'))).stats;

  // 1. sub-folders
  const folders = new Map<string, KitStat[]>();
  for (const s of nordic) folders.set(s.subkit, [...(folders.get(s.subkit) ?? []), s]);
  const folderRows = [...folders]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([f, list]) => [
      f || '(root)',
      list.length,
      list
        .slice(0, 6)
        .map((s) => s.editorId)
        .join(', '),
    ]);

  // 2. sizes and candidate modules, per sub-folder and overall
  const sizes = nordic.map(size).filter((x): x is [number, number, number] => !!x);
  const xy = sizes.flatMap((s) => [s[0], s[1]]).filter((v) => v >= 100);
  const z = sizes.map((s) => s[2]).filter((v) => v >= 100);
  const moduleRows = [128, 192, 256, 320, 384, 448, 512].map((m) => [
    m,
    `${(fit(xy, m, 24) * 100).toFixed(0)} %`,
    `${(fit(xy, m, 48) * 100).toFixed(0)} %`,
    `${(fit(z, m, 24) * 100).toFixed(0)} %`,
  ]);
  const hist = new Map<number, number>();
  for (const v of xy)
    hist.set(Math.round(v / 16) * 16, (hist.get(Math.round(v / 16) * 16) ?? 0) + 1);
  const common = [...hist]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([v, n]) => `${v} x${n}`)
    .join(', ');

  // 3. per folder: typical size
  const sizeRows = [...folders].map(([f, list]) => {
    const s = list.map(size).filter((x): x is [number, number, number] => !!x);
    const med = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)] ?? 0;
    return [
      f || '(root)',
      s.length,
      med(s.map((v) => v[0])).toFixed(0),
      med(s.map((v) => v[1])).toFixed(0),
      med(s.map((v) => v[2])).toFixed(0),
    ];
  });

  // 4. transitions: names or folders mixing the two kits
  const mixed = dungeons.filter((s) => {
    const path = s.modelPath;
    const id = s.editorId.toLowerCase();
    return (
      /trans|imp2nor|nor2imp|impnor|norimp/.test(id) ||
      (path.includes('/nordic/') && /^imp/.test(id)) ||
      (path.includes('/imperial/') && /^nor/.test(id)) ||
      /transition/.test(path)
    );
  });

  $('result').innerHTML =
    `<p class="ok">${nordic.length} STATs under dungeons/nordic/ (${dungeons.length} under dungeons/), ` +
    `${((performance.now() - t0) / 1000).toFixed(1)} s</p>` +
    `<h3>Sub-folders</h3>${table(['folder', 'pieces', 'examples'], folderRows)}` +
    `<h3>Median size per sub-folder (object bounds)</h3>${table(['folder', 'pieces', 'x', 'y', 'z'], sizeRows)}` +
    `<h3>Candidate modules</h3><p>Share of the sizes (x and y over 100 units; z) near a multiple of the module.</p>` +
    table(['module', 'xy ±24', 'xy ±48', 'z ±24'], moduleRows) +
    `<p>Most common xy sizes (rounded to 16): ${common}</p>` +
    `<h3>Possible transitions with the Imperial kit (${mixed.length})</h3>` +
    table(
      ['EditorID', 'model'],
      mixed.slice(0, 80).map((s) => [s.editorId, s.modelPath]),
    );
});

$('analyse').addEventListener('click', async () => {
  if (!view) return;
  $('result').textContent = 'Working...';
  const t0 = performance.now();
  const stats = (await loadKitStats(view.overlay, NORDIC_KIT)).stats;
  const index = await ArchiveIndex.build(view.overlay, view.plugins);
  const r = await analyseKit(stats, NORDIC_KIT, index, (done, total, current) => {
    $('progress').textContent = `${done} / ${total} ${current}`;
  });
  const ok = r.pieces.filter((p) => !p.error);
  const fits = ok.filter((p) => p.footprint.fits);
  const noOpening = ok.filter((p) => p.openings.length === 0);
  const errors = r.pieces.filter((p) => p.error);
  const dims = (p: (typeof ok)[number]) => {
    const c = p.footprint.cells;
    if (!c.length) return '-';
    const n = (a: number) => new Set(c.map((x) => x[a])).size;
    return `${n(0)}x${n(1)}x${n(2)}`;
  };
  // Z: heights of the openings' floors (zMin) relative to the NIF origin, and level spans
  const zs = new Map<number, number>();
  for (const p of ok)
    for (const o of p.openings) {
      const z = Math.round(o.zMin / 8) * 8;
      zs.set(z, (zs.get(z) ?? 0) + 1);
    }
  const zList = [...zs]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([z, n]) => `${z} x${n}`)
    .join(', ');
  const multi = ok.filter((p) => new Set(p.footprint.openingLevels).size > 1);
  const bySub = new Map<string, { n: number; fit: number }>();
  for (const p of ok) {
    const e = bySub.get(p.stat.subkit) ?? { n: 0, fit: 0 };
    e.n++;
    if (p.footprint.fits) e.fit++;
    bySub.set(p.stat.subkit, e);
  }
  $('progress').textContent = '';
  $('result').innerHTML =
    `<p class="ok">${r.pieces.length} structural pieces analysed in ${((performance.now() - t0) / 1000).toFixed(1)} s: ` +
    `${fits.length} on the 128 grid, ${ok.length - fits.length} off it, ${noOpening.length} without opening, ` +
    `${errors.length} unreadable; ${r.faces.length} faces in ${r.grouping.groups.length} profile groups.</p>` +
    `<h3>Per sub-folder</h3>${table(
      ['folder', 'pieces', 'on the grid'],
      [...bySub].map(([f, e]) => [f, e.n, e.fit]),
    )}` +
    `<h3>Opening floor heights (zMin, relative to the NIF origin)</h3><p>${zList}</p>` +
    `<h3>Pieces joining several levels (${multi.length})</h3>` +
    table(
      ['piece', 'levels', 'opening zMin'],
      multi.map((p) => [
        p.stat.editorId,
        [...new Set(p.footprint.openingLevels)].join(', '),
        p.openings.map((o) => o.zMin.toFixed(0)).join(', '),
      ]),
    ) +
    `<h3>Off the grid (${ok.length - fits.length})</h3>` +
    table(
      ['piece', 'cells', 'openings', 'notes'],
      ok
        .filter((p) => !p.footprint.fits)
        .map((p) => [
          p.stat.editorId,
          dims(p),
          p.openings.map((o) => `${o.dir} w${o.width.toFixed(0)}`).join(' '),
          p.footprint.notes.join('; '),
        ]),
    ) +
    `<h3>On the grid (${fits.length})</h3>` +
    table(
      ['piece', 'cells', 'openings'],
      fits.map((p) => [
        p.stat.editorId,
        dims(p),
        p.openings
          .map(
            (o) =>
              `${o.dir} w${o.width.toFixed(0)} L${p.footprint.openingLevels[p.openings.indexOf(o)]}`,
          )
          .join(' '),
      ]),
    ) +
    (errors.length
      ? `<h3>Unreadable</h3>${table(
          ['piece', 'error'],
          errors.map((p) => [p.stat.editorId, p.error!]),
        )}`
      : '');
});

openDataView()
  .then(useView)
  .catch((error: Error) => {
    $('status').textContent = error.message;
    $('status').className = 'err';
  });
