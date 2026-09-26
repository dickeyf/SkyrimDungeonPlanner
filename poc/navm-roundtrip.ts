/**
 * V2 step 2: decode the NVNM field of every NAVM of a plugin, re-encode it and compare byte
 * for byte; also check the triangle indices against the counts (edge flags hypothesis).
 */
import { readAll } from '$lib/fs';
import {
  Plugin,
  decodeNvnm,
  encodeNvnm,
  findSubrecord,
  formIdHex,
  recordSubrecords,
  type NavMeshData,
} from '$lib/format/esp';
import type { OverlayFileInfo } from '$lib/vfs';
import { bindProfileSelect, describeView, openDataView, type DataView } from './shared/dataView';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $<HTMLPreElement>('log');
const log = (m: string, cls = '') => {
  const line = document.createElement('div');
  line.textContent = `${new Date().toLocaleTimeString()}  ${m}`;
  if (cls) line.className = cls;
  logEl.prepend(line);
};
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

let plugins: OverlayFileInfo[] = [];

async function useView(view: DataView): Promise<void> {
  const esps = await view.overlay.listFiles('', { suffix: '.esp' });
  const esms = await view.overlay.listFiles('', { suffix: '.esm' });
  plugins = [...esps, ...esms];
  $<HTMLSelectElement>('plugin').innerHTML = plugins
    .map(
      (p, i) =>
        `<option value="${i}">${escape(p.name)}  [${escape(p.layer.name)}, ${(p.size / 1024).toFixed(0)} KB]</option>`,
    )
    .join('');
  $('status').textContent = `${describeView(view)} ${plugins.length} plugins visible.`;
  $('status').className = 'ok';
  $<HTMLButtonElement>('check').disabled = plugins.length === 0;
  bindProfileSelect($<HTMLSelectElement>('profile'), view, (next) => void useView(next));
}

/** Index problems, assuming flag bit i marks edge i as an edge link (else a triangle or -1). */
function consistency(nav: NavMeshData): string[] {
  const out: string[] = [];
  nav.triangles.forEach((t, i) => {
    for (const v of t.vertices)
      if (v < 0 || v >= nav.vertices.length) out.push(`tri ${i}: vertex ${v}`);
    t.edges.forEach((e, k) => {
      if (e === -1) return;
      const external = (t.flags & (1 << k)) !== 0;
      const limit = external ? nav.edgeLinks.length : nav.triangles.length;
      if (e < 0 || e >= limit) out.push(`tri ${i}: edge ${k} = ${e}${external ? ' (link)' : ''}`);
    });
  });
  for (const d of nav.doorLinks)
    if (d.triangle < 0 || d.triangle >= nav.triangles.length)
      out.push(`door link triangle ${d.triangle}`);
  return out;
}

function firstDifference(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

function row(id: string, nav: NavMeshData): string {
  const parent =
    nav.parent.kind === 'cell'
      ? `cell ${formIdHex(nav.parent.cell)}`
      : `world ${formIdHex(nav.parent.worldspace)} (${nav.parent.x}, ${nav.parent.y})`;
  const flags = [...new Set(nav.triangles.map((t) => t.flags.toString(16)))];
  const num = (n: number) => `<td class="num">${n}</td>`;
  return (
    `<tr><td>${id}</td><td>${parent}</td>${num(nav.vertices.length)}${num(nav.triangles.length)}` +
    `${num(nav.edgeLinks.length)}${num(nav.doorLinks.length)}${num(nav.cover.length)}` +
    `${num(nav.grid.divisor)}<td>${flags.slice(0, 8).join(' ')}</td></tr>`
  );
}

$('check').addEventListener('click', async () => {
  const info = plugins[Number($<HTMLSelectElement>('plugin').value)];
  if (!info) return;
  $('result').textContent = 'Working...';
  try {
    const t0 = performance.now();
    const plugin = Plugin.parse(await readAll(info.handle), info.name);
    const records = plugin.recordsOfType('NAVM');
    let decoded = 0;
    let identical = 0;
    let trailing = 0;
    let inconsistent = 0;
    const failures: string[] = [];
    const rows: string[] = [];
    const parentOf = new Map<number, string>();
    const links: { from: number; parent: string; to: number }[] = [];
    for (const record of records) {
      const id = formIdHex(record.formId);
      try {
        const nvnm = findSubrecord(await recordSubrecords(record), 'NVNM');
        if (!nvnm) continue;
        decoded++;
        const nav = decodeNvnm(nvnm.data);
        const parentKey =
          nav.parent.kind === 'cell' ? `c${nav.parent.cell}` : `w${nav.parent.worldspace}`;
        parentOf.set(record.formId, parentKey);
        for (const l of nav.edgeLinks)
          links.push({ from: record.formId, parent: parentKey, to: l.navMesh });
        const diff = firstDifference(encodeNvnm(nav), nvnm.data);
        if (diff === -1) identical++;
        else failures.push(`${id}: first difference at byte ${diff} of ${nvnm.data.length}`);
        if (nav.trailing.length > 0) {
          trailing++;
          failures.push(`${id}: ${nav.trailing.length} unknown trailing bytes`);
        }
        const problems = consistency(nav);
        if (problems.length > 0) {
          inconsistent++;
          failures.push(
            `${id}: ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? '...' : ''}`,
          );
        }
        if (rows.length < 500) rows.push(row(id, nav));
      } catch (error) {
        failures.push(`${id}: ${(error as Error).message}`);
      }
    }
    // Interior edge links whose target NAVM belongs to the same cell (R2).
    const interior = links.filter((l) => l.parent.startsWith('c'));
    const sameCell = interior.filter((l) => parentOf.get(l.to) === l.parent);
    const cellsWithSameCellLinks = new Set(sameCell.map((l) => l.parent)).size;
    const examples = [...new Set(sameCell.map((l) => `${formIdHex(l.from)} -> ${formIdHex(l.to)}`))]
      .slice(0, 10)
      .join(', ');
    const r2 =
      `<p>Interior edge links: ${interior.length}, ${sameCell.length} to a NAVM of the same cell ` +
      `(${cellsWithSameCellLinks} cells). ${escape(examples)}</p>`;
    const ok = identical === decoded && failures.length === 0;
    const shown = failures.slice(0, 50).map(escape).join('\n');
    const more = failures.length > 50 ? `\n... ${failures.length - 50} more` : '';
    $('result').innerHTML =
      `<p class="${ok ? 'ok' : 'err'}">${records.length} NAVM, ${decoded} with NVNM: ` +
      `${identical} identical, ${trailing} with trailing bytes, ${inconsistent} with index problems ` +
      `(${(performance.now() - t0).toFixed(0)} ms)</p>` +
      r2 +
      (failures.length ? `<pre>${shown}${more}</pre>` : '');
    $('list').innerHTML =
      `<table><tr><th>NAVM</th><th>parent</th><th>vertices</th><th>triangles</th><th>edge links</th>` +
      `<th>doors</th><th>cover</th><th>grid</th><th>triangle flags (hex)</th></tr>${rows.join('')}</table>`;
    log(`${info.name}: ${identical}/${decoded} identical`, ok ? 'ok' : 'err');
  } catch (error) {
    $('result').textContent = (error as Error).message;
    log(`failed: ${(error as Error).message}`, 'err');
  }
});

openDataView()
  .then(useView)
  .catch((error: Error) => {
    $('status').textContent = error.message;
    $('status').className = 'err';
  });
