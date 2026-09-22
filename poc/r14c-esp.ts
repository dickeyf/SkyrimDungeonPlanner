/**
 * R14c proof of concept: parse a plugin found through the virtual Data view, write it back
 * byte-identical, then add a REFR and save the result to a copy for xEdit / CK checks.
 */
import { PREF_KEYS, getPref, readAll, setPref, writeFileAtomic } from '$lib/fs';
import { Plugin, formIdHex, formIdIndex, toFormKey, type CellEntry } from '$lib/format/esp';
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
let current: {
  info: OverlayFileInfo;
  bytes: Uint8Array;
  plugin: Plugin;
  cells: CellEntry[];
} | null = null;

async function useView(view: DataView): Promise<void> {
  plugins = await view.overlay.listFiles('', { suffix: '.esp' });
  const select = $<HTMLSelectElement>('plugin');
  select.innerHTML = plugins
    .map(
      (p, i) =>
        `<option value="${i}">${escape(p.name)}  [${escape(p.layer.name)}, ${(p.size / 1024).toFixed(0)} KB]</option>`,
    )
    .join('');
  const remembered = getPref(PREF_KEYS.workPlugin);
  const idx = plugins.findIndex((p) => p.name === remembered);
  if (idx !== -1) select.value = String(idx);
  $('status').textContent = `${describeView(view)} ${plugins.length} plugins visible.`;
  $('status').className = 'ok';
  $<HTMLButtonElement>('parse').disabled = plugins.length === 0;
  bindProfileSelect($<HTMLSelectElement>('profile'), view, (next) => void useView(next));
}

async function setup(): Promise<void> {
  try {
    await useView(await openDataView());
  } catch (error) {
    $('status').textContent = (error as Error).message;
    $('status').className = 'err';
  }
}

$('parse').addEventListener('click', async () => {
  const info = plugins[Number($<HTMLSelectElement>('plugin').value)];
  if (!info) return;
  try {
    const t0 = performance.now();
    const bytes = await readAll(info.handle);
    const t1 = performance.now();
    const plugin = Plugin.parse(bytes, info.name);
    const t2 = performance.now();
    setPref(PREF_KEYS.workPlugin, info.name);
    const cells = await plugin.interiorCells();
    current = { info, bytes, plugin, cells };
    const h = plugin.header;
    const counted = plugin.countNodes();
    $('header').innerHTML =
      `<table>` +
      `<tr><td>file</td><td>${escape(info.name)} in layer "${escape(info.layer.name)}", ${bytes.length} bytes</td></tr>` +
      `<tr><td>version</td><td>${h.version.toFixed(2)}</td></tr>` +
      `<tr><td>author / description</td><td>${escape(h.author)} / ${escape(h.description)}</td></tr>` +
      `<tr><td>masters</td><td>${h.masters.map(escape).join(', ')}</td></tr>` +
      `<tr><td>HEDR numRecords</td><td class="${counted === h.numRecords ? 'ok' : 'warn'}">${h.numRecords} (tree has ${counted})</td></tr>` +
      `<tr><td>HEDR nextObjectId</td><td>${formIdHex(h.nextObjectId)}</td></tr>` +
      `<tr><td>flags</td><td>${h.isMaster ? 'ESM ' : ''}${h.isLight ? 'ESL ' : ''}${!h.isMaster && !h.isLight ? 'plain ESP' : ''}</td></tr>` +
      `<tr><td>records by type</td><td>${plugin
        .summary()
        .map((s) => `${s.type} ${s.records}`)
        .join(', ')}</td></tr>` +
      `<tr><td>read / parse</td><td>${(t1 - t0).toFixed(1)} ms / ${(t2 - t1).toFixed(1)} ms</td></tr>` +
      `</table>`;
    const rows: string[] = [];
    const cellSelect = $<HTMLSelectElement>('cell');
    cellSelect.innerHTML = '';
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]!;
      const refs = await plugin.cellRefs(c);
      const own = refs.filter((r) => formIdIndex(r.record.formId) === plugin.ownIndex).length;
      rows.push(
        `<tr><td>${escape(c.info.editorId)}</td><td>${escape(c.info.name)}</td><td>${formIdHex(c.record.formId)}</td>` +
          `<td class="num">${refs.length}</td><td class="num">${own}</td><td class="num">${plugin.cellPlacedCount(c)}</td></tr>`,
      );
      cellSelect.add(new Option(`${c.info.editorId} (${refs.length} refs)`, String(i)));
    }
    $('cells').innerHTML =
      `<table><tr><th>EditorID</th><th>Name</th><th>FormID</th><th>REFR</th><th>own REFR</th><th>placed (all types)</th></tr>${rows.join('')}</table>`;
    $<HTMLButtonElement>('roundtrip').disabled = false;
    $<HTMLButtonElement>('add').disabled = cells.length === 0;
    $('roundtrip-result').textContent = '-';
    log(`parsed ${info.name}: ${counted} nodes, ${cells.length} interior cells`, 'ok');
  } catch (error) {
    log(`parse failed: ${(error as Error).message}`, 'err');
  }
});

$('roundtrip').addEventListener('click', () => {
  if (!current) return;
  const t0 = performance.now();
  const out = current.plugin.write();
  const elapsed = performance.now() - t0;
  const el = $('roundtrip-result');
  if (out.length !== current.bytes.length) {
    el.textContent = `DIFFERENT: wrote ${out.length} bytes, file has ${current.bytes.length}`;
    el.className = 'err';
    log(el.textContent, 'err');
    return;
  }
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== current.bytes[i]) {
      el.textContent = `DIFFERENT at byte ${i} (0x${i.toString(16)}): wrote 0x${out[i]!.toString(16)}, file has 0x${current.bytes[i]!.toString(16)}`;
      el.className = 'err';
      log(el.textContent, 'err');
      return;
    }
  }
  el.textContent = `IDENTICAL: ${out.length} bytes written in ${elapsed.toFixed(1)} ms, byte for byte equal to the file.`;
  el.className = 'ok';
  log(el.textContent, 'ok');
});

function copyName(name: string): string {
  return name.replace(/\.esp$/i, '') + '.r14c.esp';
}

$('add').addEventListener('click', async () => {
  if (!current) return;
  try {
    // Work on a fresh parse so repeated clicks do not accumulate edits.
    const plugin = Plugin.parse(current.bytes, current.info.name);
    const cells = await plugin.interiorCells();
    const cell = cells[Number($<HTMLSelectElement>('cell').value)];
    if (!cell) return;
    const refs = await plugin.cellRefs(cell);
    const model = refs.find((r) => formIdIndex(r.info.base) < plugin.ownIndex);
    if (!model) throw new Error('no reference with a master base in this cell');
    const added = plugin.addRefr(cell, {
      base: model.info.base,
      pos: [model.info.pos[0], model.info.pos[1], model.info.pos[2] + 512],
      rot: model.info.rot,
      scale: model.info.scale,
    });
    const out = plugin.write();
    const name = copyName(current.info.name);
    await writeFileAtomic(current.info.layer.dir, name, out);
    const key = toFormKey(model.info.base, plugin.masters, plugin.name);
    $('add-result').innerHTML =
      `Wrote <code>${escape(name)}</code> (${out.length} bytes) in layer "${escape(current.info.layer.name)}": new REFR ${formIdHex(added.formId)} ` +
      `of base ${escape(key)} at ${added && model.info.pos.map((v, i) => (i === 2 ? v + 512 : v).toFixed(0)).join(', ')}; ` +
      `HEDR numRecords ${plugin.header.numRecords}, nextObjectId ${formIdHex(plugin.header.nextObjectId)}.`;
    $('add-result').className = 'ok';
    $<HTMLButtonElement>('remove-copy').disabled = false;
    log(
      `copy written: ${name}, new REFR ${formIdHex(added.formId)} (copy of ${formIdHex(model.record.formId)})`,
      'ok',
    );
  } catch (error) {
    log(`add failed: ${(error as Error).message}`, 'err');
  }
});

$('remove-copy').addEventListener('click', async () => {
  if (!current?.info.layer.dir.removeEntry) return;
  const name = copyName(current.info.name);
  try {
    await current.info.layer.dir.removeEntry(name);
    log(`deleted ${name}`, 'ok');
    $<HTMLButtonElement>('remove-copy').disabled = true;
  } catch (error) {
    log(`delete failed: ${(error as Error).message}`, 'err');
  }
});

void setup();
