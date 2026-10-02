/**
 * V2 step 16: what the CK's Finalize writes. Decodes every NVMI field of the plugin's NAVI
 * records, re-encodes it and compares byte for byte; lists the entries, the door references
 * linked to a NavMesh (XNDP) and the NavMeshes' door links with their triangles' flags.
 */
import { readAll } from '$lib/fs';
import {
  Plugin,
  decodeNvmi,
  decodeRefr,
  decodeNvnm,
  encodeNvmi,
  findSubrecord,
  formIdHex,
  recordSubrecords,
  type NavInfo,
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
const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;
const vec = (v: readonly number[]) => v.map((x) => x.toFixed(1)).join(', ');

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

function firstDifference(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

/** Whether a point lies in a triangle, seen from above (yes / no / -). */
function markerInside(nav: NavMeshData | undefined, t: number, p: number[] | undefined): string {
  const tri = nav?.triangles[t];
  if (!nav || !tri || !p) return '-';
  const [a, b, c] = tri.vertices.map((v) => nav.vertices[v]!);
  const side = (u: readonly number[], w: readonly number[]) =>
    (w[0]! - u[0]!) * (p[1]! - u[1]!) - (w[1]! - u[1]!) * (p[0]! - u[0]!);
  const d = [side(a!, b!), side(b!, c!), side(c!, a!)];
  return d.every((x) => x >= 0) || d.every((x) => x <= 0) ? 'yes' : 'no';
}

function infoRow(n: NavInfo, nav?: NavMeshData): string {
  let check = '-';
  if (nav && nav.vertices.length) {
    const mean = [0, 1, 2].map(
      (a) => nav.vertices.reduce((s, v) => s + v[a]!, 0) / nav.vertices.length,
    );
    const mid = [0, 1, 2].map(
      (a) =>
        (Math.min(...nav.vertices.map((v) => v[a]!)) +
          Math.max(...nav.vertices.map((v) => v[a]!))) /
        2,
    );
    check = `mean ${vec(mean)} / bounds centre ${vec(mid)}`;
  }
  const parent =
    n.parent.kind === 'cell'
      ? `cell ${formIdHex(n.parent.cell)}`
      : `world ${formIdHex(n.parent.worldspace)} (${n.parent.x}, ${n.parent.y})`;
  const doors = n.doorLinks.map((d) => `${formIdHex(d.door)} (crc ${hex(d.crc)})`).join(' ');
  const island = n.island
    ? `${n.island.triangles.length} tri, ${n.island.vertices.length} vert`
    : '-';
  return (
    `<tr><td>${formIdHex(n.navMesh)}</td><td>${hex(n.flags)}</td><td>${vec(n.location)}</td>` +
    `<td>${n.preferred}</td><td>${n.edgeLinks.map(formIdHex).join(' ')}</td>` +
    `<td>${n.preferredEdgeLinks.map(formIdHex).join(' ')}</td><td>${doors}</td>` +
    `<td>${island}</td><td>${hex(n.crc)} ${parent}</td><td>${check}</td></tr>`
  );
}

$('check').addEventListener('click', async () => {
  const info = plugins[Number($<HTMLSelectElement>('plugin').value)];
  if (!info) return;
  $('result').textContent = 'Working...';
  try {
    const t0 = performance.now();
    const plugin = Plugin.parse(await readAll(info.handle), info.name);
    const own = plugin.recordsOfType('NAVM');
    const ownIds = new Set(own.map((r) => r.formId));
    const navs = new Map<number, NavMeshData>();
    for (const record of own) {
      const nvnm = findSubrecord(await recordSubrecords(record), 'NVNM');
      if (nvnm) navs.set(record.formId, decodeNvnm(nvnm.data));
    }
    const centroid = (nav: NavMeshData, t: number): number[] | undefined => {
      const tri = nav.triangles[t];
      if (!tri) return undefined;
      return [0, 1, 2].map((a) => tri.vertices.reduce((n, v) => n + nav.vertices[v]![a]!, 0) / 3);
    };

    // 1. NAVI: NVMI round trip, field order, NVPP / NVSI sizes
    const failures: string[] = [];
    const naviNotes: string[] = [];
    const entries: NavInfo[] = [];
    let identical = 0;
    let total = 0;
    for (const record of plugin.recordsOfType('NAVI')) {
      const subs = await recordSubrecords(record);
      const order = [...new Set(subs.map((s) => s.type))].join(' ');
      const nver = findSubrecord(subs, 'NVER');
      const version = nver
        ? new DataView(nver.data.buffer, nver.data.byteOffset).getUint32(0, true)
        : '-';
      const sizes = ['NVPP', 'NVSI']
        .map(
          (t) =>
            `${t} ${subs.filter((s) => s.type === t).reduce((n, s) => n + s.data.length, 0)} bytes`,
        )
        .join(', ');
      naviNotes.push(
        `NAVI ${formIdHex(record.formId)}: version ${version}, fields ${order}, ` +
          `${subs.filter((s) => s.type === 'NVMI').length} NVMI, ${sizes}`,
      );
      for (const s of subs) {
        if (s.type !== 'NVMI') continue;
        total++;
        try {
          const n = decodeNvmi(s.data);
          entries.push(n);
          const diff = firstDifference(encodeNvmi(n), s.data);
          if (diff === -1) identical++;
          else failures.push(`NVMI ${formIdHex(n.navMesh)}: first difference at byte ${diff}`);
          if (n.trailing.length)
            failures.push(`NVMI ${formIdHex(n.navMesh)}: ${n.trailing.length} trailing bytes`);
        } catch (error) {
          failures.push(`NVMI #${total}: ${(error as Error).message}`);
        }
      }
    }
    const missing = [...ownIds].filter((id) => !entries.some((e) => e.navMesh === id));

    // 2. door references linked to a NavMesh (XNDP), with their teleport (XTEL)
    const doorRows: string[] = [];
    // where a door's teleport lands: stored in the XTEL of the door leading to it
    const arrival = new Map<number, number[]>();
    for (const record of plugin.recordsOfType('REFR')) {
      const tel = findSubrecord(await recordSubrecords(record), 'XTEL');
      if (!tel || tel.data.length < 16) continue;
      const t = new DataView(tel.data.buffer, tel.data.byteOffset, tel.data.byteLength);
      arrival.set(t.getUint32(0, true), [
        t.getFloat32(4, true),
        t.getFloat32(8, true),
        t.getFloat32(12, true),
      ]);
    }
    for (const record of plugin.recordsOfType('REFR')) {
      const subs = await recordSubrecords(record);
      const xndp = findSubrecord(subs, 'XNDP');
      if (!xndp) continue;
      const v = new DataView(xndp.data.buffer, xndp.data.byteOffset, xndp.data.byteLength);
      const tel = findSubrecord(subs, 'XTEL');
      const tv = tel
        ? new DataView(tel.data.buffer, tel.data.byteOffset, tel.data.byteLength)
        : null;
      const telTo = tv ? formIdHex(tv.getUint32(0, true)) : '-';
      const nav = navs.get(v.getUint32(0, true));
      const c = nav ? centroid(nav, v.getInt16(4, true)) : undefined;
      let pos = '-';
      try {
        pos = vec((await decodeRefr(record)).pos);
      } catch {
        /* no DATA */
      }
      if (doorRows.length < 300)
        doorRows.push(
          `<tr><td>${formIdHex(record.formId)}</td><td>${formIdHex(v.getUint32(0, true))}</td>` +
            `<td>${v.getInt16(4, true)}</td><td>${xndp.data.length}</td><td>${telTo}</td>` +
            `<td>${pos}</td><td>${c ? vec(c) : '-'}</td>` +
            `<td>${arrival.has(record.formId) ? vec(arrival.get(record.formId)!) : '-'}</td>` +
            `<td>${markerInside(nav, v.getInt16(4, true), arrival.get(record.formId))}</td></tr>`,
        );
    }

    // 3. the plugin's NavMeshes' door links and the flags of their triangles
    const linkRows: string[] = [];
    const flagCount = new Map<number, number>();
    for (const record of own) {
      const nav = navs.get(record.formId);
      if (!nav) continue;
      for (const t of nav.triangles) flagCount.set(t.flags, (flagCount.get(t.flags) ?? 0) + 1);
      for (const d of nav.doorLinks)
        if (linkRows.length < 300)
          linkRows.push(
            `<tr><td>${formIdHex(record.formId)}</td><td>${d.triangle}</td><td>${hex(d.crc)}</td>` +
              `<td>${formIdHex(d.door)}</td><td>${hex(nav.triangles[d.triangle]?.flags ?? 0)}</td></tr>`,
          );
    }
    const flags = [...flagCount]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([f, n]) => `${hex(f)} x${n}`)
      .join(', ');

    const ok = identical === total && failures.length === 0;
    $('result').innerHTML =
      `<p class="${ok ? 'ok' : 'err'}">${total} NVMI: ${identical} identical ` +
      `(${(performance.now() - t0).toFixed(0)} ms). ${own.length} NAVM in the plugin, ` +
      `${missing.length} without an NVMI entry${missing.length ? ': ' + missing.slice(0, 10).map(formIdHex).join(' ') : ''}.</p>` +
      `<pre>${naviNotes.map(escape).join('\n')}</pre>` +
      (failures.length ? `<pre>${failures.slice(0, 50).map(escape).join('\n')}</pre>` : '');
    $('list').innerHTML =
      `<h3>NVMI entries (first 300)</h3><table><tr><th>NAVM</th><th>flags</th><th>location</th>` +
      `<th>pref %</th><th>edge links</th><th>preferred</th><th>doors</th><th>island</th>` +
      `<th>pathing cell</th><th>NAVM vertices</th></tr>${entries
        .slice(0, 300)
        .map((e) => infoRow(e, navs.get(e.navMesh)))
        .join('')}</table>` +
      `<h3>Doors with XNDP (first 300)</h3><table><tr><th>REFR</th><th>NAVM</th><th>triangle</th>` +
      `<th>size</th><th>XTEL to</th><th>door position</th><th>triangle centre</th><th>arrival marker</th><th>marker in triangle</th></tr>${doorRows.join('')}</table>` +
      `<h3>Door links in the plugin's NAVMs</h3><table><tr><th>NAVM</th><th>triangle</th><th>crc</th>` +
      `<th>door</th><th>triangle flags</th></tr>${linkRows.join('')}</table>` +
      `<p>Triangle flags in the plugin's NAVMs: ${flags}</p>`;
    log(`${info.name}: ${identical}/${total} NVMI identical`, ok ? 'ok' : 'err');
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
