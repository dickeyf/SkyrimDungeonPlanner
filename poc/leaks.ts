/**
 * V2 step 5 (R16): deep junction check on a real cell. Every junction between two tiles gets
 * the exact check (free borders of either render mesh far from the other piece), then each
 * candidate gap is looked at from where the player stands: front faces grey, back faces red,
 * void black. A candidate that shows red or black around it is a visible leak.
 */
import * as THREE from 'three';
import { kvGet, readAll } from '$lib/fs';
import { Plugin, formIdHex, toFormKey, type CellEntry } from '$lib/format/esp';
import { modelArchivePath } from '$lib/format/esp/stat';
import { NifFile, mergeShapes } from '$lib/format/nif';
import type { Catalogue, CellIndex, FaceDir, Vec3 } from '$lib/catalogue/types';
import { deriveGrid, jointsOfTile, layoutFromGrid, type DeriveResult } from '$lib/grid';
import {
  junctionGaps,
  mergeWorldMeshes,
  placeMesh,
  type Gap,
  type JunctionFrame,
  type WorldMesh,
} from '$lib/grid/leaks';
import { piecesByFormKey } from '$lib/level/loadCell';
import { weldMesh, type WeldedGeometry } from '$lib/mesh/geometry';
import { ArchiveIndex, type OverlayFileInfo } from '$lib/vfs';
import { bindProfileSelect, describeView, openDataView, type DataView } from './shared/dataView';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

let catalogue: Catalogue | null = null;
let index: ArchiveIndex | null = null;
let plugins: OverlayFileInfo[] = [];
let current: { plugin: Plugin; cells: CellEntry[] } | null = null;

interface Junction {
  a: { key: string; edid: string; model: string; pos: Vec3; heading: number };
  /** Every tile facing a's opening: a gap next to one of them may be closed by another. */
  b: { key: string; edid: string; model: string; pos: Vec3; heading: number }[];
  frame: JunctionFrame;
  /** Unit normal pointing from a to b, horizontal. */
  normal: [number, number];
}

let junctions: Junction[] = [];
/** Every tile of the cell, for the views: the rest of the level must be there, or open passages end on void. */
let allTiles: { model: string; pos: Vec3; heading: number }[] = [];

/** Radius (units) around a junction within which tiles are drawn in its views. */
const VIEW_RADIUS = 1536;

async function useView(view: DataView): Promise<void> {
  catalogue = (await kvGet<Catalogue>('catalogue:Imperial')) ?? null;
  if (!catalogue) {
    $('status').textContent =
      "No analysed catalogue: open the app's Catalogue page once, then reload.";
    $('status').className = 'err';
    return;
  }
  index = await ArchiveIndex.build(view.overlay, view.plugins);
  plugins = await view.overlay.listFiles('', { suffix: '.esp' });
  $<HTMLSelectElement>('plugin').innerHTML = plugins
    .map((p, i) => `<option value="${i}">${escape(p.name)}</option>`)
    .join('');
  $('status').textContent = `${describeView(view)} ${plugins.length} plugins.`;
  $('status').className = 'ok';
  $<HTMLButtonElement>('parse').disabled = false;
  bindProfileSelect($<HTMLSelectElement>('profile'), view, (next) => void useView(next));
}

$('parse').addEventListener('click', async () => {
  const info = plugins[Number($<HTMLSelectElement>('plugin').value)];
  if (!info) return;
  const plugin = Plugin.parse(await readAll(info.handle), info.name);
  const cells = await plugin.interiorCells();
  current = { plugin, cells };
  $<HTMLSelectElement>('cell').innerHTML = cells
    .map(
      (c, i) =>
        `<option value="${i}">${escape(c.info.editorId)} ${formIdHex(c.record.formId)}</option>`,
    )
    .join('');
  $<HTMLButtonElement>('load').disabled = cells.length === 0;
});

/** The junction plane and extent of a world opening (cells behind it, facing `dir`). */
function frameOf(dir: FaceDir, cells: readonly CellIndex[], grid: DeriveResult): JunctionFrame {
  const { origin, module } = grid.anchor;
  const axis = dir[1] === 'X' ? 0 : 1;
  const u = 1 - axis;
  const along = cells.map((c) => c[axis]!);
  const across = cells.map((c) => c[u]!);
  const levels = cells.map((c) => c[2]);
  const edge = dir[0] === '+' ? Math.max(...along) + 1 : Math.min(...along);
  return {
    axis,
    plane: origin[axis]! + edge * module.xy,
    uMin: origin[u]! + Math.min(...across) * module.xy,
    uMax: origin[u]! + (Math.max(...across) + 1) * module.xy,
    zMin: origin[2] + Math.min(...levels) * module.z,
    zMax: origin[2] + (Math.max(...levels) + 1) * module.z,
  };
}

$('load').addEventListener('click', async () => {
  if (!current || !catalogue) return;
  const kit = catalogue.kits[0]!;
  const cell = current.cells[Number($<HTMLSelectElement>('cell').value)];
  if (!cell || !kit.module.xy || !kit.module.z) return;
  const plugin = current.plugin;
  const refs = await plugin.cellRefs(cell);
  const pieces = piecesByFormKey(catalogue);
  const grid = deriveGrid(
    refs.map((r) => ({
      refFormKey: toFormKey(r.record.formId, plugin.masters, plugin.name),
      base: toFormKey(r.info.base, plugin.masters, plugin.name),
      pos: r.info.pos,
      rot: r.info.rot,
      scale: r.info.scale,
    })),
    pieces,
    { module: kit.module.xy, zModule: kit.module.z },
  );
  const layout = layoutFromGrid(grid, new Map());
  const types = new Map(catalogue.connectionTypes.map((t) => [t.id, t]));
  const seen = new Set<string>();
  junctions = [];
  allTiles = [...layout.tiles.values()].map((t) => ({
    model: pieces.get(t.piece)!.model,
    pos: t.origin!.ref.pos,
    heading: t.origin!.ref.rot[2],
  }));
  for (const tile of layout.tiles.values()) {
    for (const joint of jointsOfTile(layout, pieces, types, tile.key)) {
      if (joint.tile !== tile.key) continue;
      {
        const frame = frameOf(joint.dir, joint.cells, grid);
        const id = `${tile.key}|${frame.axis}|${frame.plane}|${frame.uMin}`;
        if (seen.has(id) || joint.against.length === 0) continue;
        seen.add(id);
        const side = (key: string) => {
          const t = layout.tiles.get(key)!;
          const p = pieces.get(t.piece)!;
          return {
            key,
            edid: p.editorId,
            model: p.model,
            pos: t.origin!.ref.pos,
            heading: t.origin!.ref.rot[2],
          };
        };
        const sign = joint.dir[0] === '+' ? 1 : -1;
        junctions.push({
          a: side(tile.key),
          b: joint.against.map(side),
          frame,
          normal: joint.dir[1] === 'X' ? [sign, 0] : [0, sign],
        });
      }
    }
  }
  listJunctions();
  $<HTMLButtonElement>('check').disabled = junctions.length === 0;
  $<HTMLButtonElement>('check-all').disabled = junctions.length === 0;
  $('result').textContent = `${grid.tiles.length} tiles, ${junctions.length} junctions.`;
});

/** The junction list, narrowed to labels containing every word of the search box. */
function listJunctions(): void {
  const words = $<HTMLInputElement>('search').value.toLowerCase().split(/\s+/).filter(Boolean);
  const label = (j: Junction) =>
    `${j.a.edid} | ${j.b.map((t) => t.edid).join(' + ')} (${j.frame.axis ? 'y' : 'x'} = ${j.frame.plane.toFixed(0)}, ` +
    `${j.frame.axis ? 'x' : 'y'} ${((j.frame.uMin + j.frame.uMax) / 2).toFixed(0)})`;
  const shown = junctions
    .map((j, i) => ({ i, text: label(j) }))
    .filter(({ text }) => words.every((w) => text.toLowerCase().includes(w)));
  $('junctions').innerHTML = shown
    .map(({ i, text }) => `<option value="${i}">${escape(text)}</option>`)
    .join('');
  $('search-count').textContent = `${shown.length} / ${junctions.length}`;
}
$('search').addEventListener('input', listJunctions);

// ---- meshes -------------------------------------------------------------------------------

const welded = new Map<string, Promise<WeldedGeometry>>();
function meshOf(model: string): Promise<WeldedGeometry> {
  let entry = welded.get(model);
  if (!entry) {
    entry = (async () => {
      const read = await index!.read(modelArchivePath(model));
      if (!read) throw new Error(`${model} not found`);
      return weldMesh(mergeShapes(NifFile.parse(read.bytes), { skipAlpha: true }));
    })();
    welded.set(model, entry);
  }
  return entry;
}

// ---- visibility -----------------------------------------------------------------------------

const W = 320;
const H = 240;
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setSize(W, H);
const front = new THREE.MeshBasicMaterial({ color: 0x808080, side: THREE.FrontSide });
const back = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.BackSide });

function sceneOf(meshes: readonly WorldMesh[]): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  for (const m of meshes) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m.positions), 3));
    g.setIndex(new THREE.BufferAttribute(m.triangles, 1));
    scene.add(new THREE.Mesh(g, front), new THREE.Mesh(g, back));
  }
  return scene;
}

interface View {
  eye: Vec3;
  leak: boolean;
  image: string;
}

/**
 * Look at a gap from a few standing positions on both sides of the junction, on the axis of
 * the passage, at eye height above the junction's floor level. A view whose centre shows a back face is inside a wall and
 * is dropped.
 */
function lookAt(scene: THREE.Scene, j: Junction, gap: Gap): View[] {
  const views: View[] = [];
  const camera = new THREE.PerspectiveCamera(75, W / H, 1, 20000);
  camera.up.set(0, 0, 1);
  const eyeZ = j.frame.zMin + Number($<HTMLInputElement>('eye').value);
  const pixels = new Uint8Array(W * H * 4);
  const samples = [gap.centre, gap.points[0]!, gap.points[gap.points.length - 1]!];
  for (const side of [-1, 1])
    for (const distance of [96, 192, 320]) {
      const c = gap.centre;
      // The player stands in the middle of the passage, not in front of the gap: a gap at the
      // edge of a wide door frame would put the camera inside the narrower hall's walls.
      const f = j.frame;
      const along = f.plane + side * distance;
      const across = (f.uMin + f.uMax) / 2;
      const eye: Vec3 = f.axis === 0 ? [along, across, eyeZ] : [across, along, eyeZ];
      camera.position.set(...eye);
      camera.lookAt(c[0], c[1], c[2]);
      camera.updateMatrixWorld();
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const at = (x: number, y: number) => {
        const k = (y * W + x) * 4;
        return pixels[k]! > 200 && pixels[k + 1]! < 50
          ? 'back'
          : pixels[k]! < 20
            ? 'void'
            : 'front';
      };
      if (at(W >> 1, H >> 1) === 'back' && at(W >> 1, H >> 2) === 'back') continue; // inside a wall
      let leak = false;
      for (const s of samples) {
        const p = new THREE.Vector3(...s).project(camera);
        if (p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) continue;
        const px = Math.round(((p.x + 1) / 2) * (W - 1));
        const py = Math.round(((p.y + 1) / 2) * (H - 1));
        for (let dy = -2; dy <= 2 && !leak; dy++)
          for (let dx = -2; dx <= 2 && !leak; dx++) {
            const x = px + dx;
            const y = py + dy;
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            if (at(x, y) !== 'front') leak = true;
          }
      }
      views.push({ eye, leak, image: renderer.domElement.toDataURL() });
    }
  return views;
}

async function check(j: Junction): Promise<string> {
  const t0 = performance.now();
  const a = placeMesh(await meshOf(j.a.model), j.a.pos, j.a.heading);
  const b = mergeWorldMeshes(
    await Promise.all(j.b.map(async (t) => placeMesh(await meshOf(t.model), t.pos, t.heading))),
  );
  const t1 = performance.now();
  const { gaps, samples } = junctionGaps(a, b, j.frame, {
    threshold: Number($<HTMLInputElement>('threshold').value),
  });
  const t2 = performance.now();
  const f = j.frame;
  const mid = (f.uMin + f.uMax) / 2;
  const cx = f.axis === 0 ? f.plane : mid;
  const cy = f.axis === 0 ? mid : f.plane;
  const around = allTiles.filter((t) => Math.hypot(t.pos[0] - cx, t.pos[1] - cy) <= VIEW_RADIUS);
  const scene = sceneOf(
    await Promise.all(around.map(async (t) => placeMesh(await meshOf(t.model), t.pos, t.heading))),
  );
  const lines: string[] = [];
  let leaks = 0;
  const gallery: string[] = [];
  for (const gap of gaps.slice(0, 12)) {
    const views = lookAt(scene, j, gap);
    const seen = views.filter((v) => v.leak).length;
    if (seen > 0) leaks++;
    lines.push(
      `  ${gap.side} gap ${gap.width.toFixed(1)} wide, ${gap.points.length} samples at ${gap.centre.map((v) => v.toFixed(0)).join(', ')}: ` +
        `${seen}/${views.length} views see it${seen > 0 ? '  LEAK' : ''}`,
    );
    for (const v of views.filter((w) => w.leak).slice(0, 2)) gallery.push(v.image);
  }
  const t3 = performance.now();
  $('gallery').innerHTML = gallery
    .map((src) => `<img src="${src}" width="${W}" height="${H}" />`)
    .join('');
  return (
    `${j.a.edid} | ${j.b.map((t) => t.edid).join(' + ')}: ${gaps.length} candidate gaps (${samples} border samples), ${leaks} visible` +
    ` [meshes ${(t1 - t0).toFixed(0)} ms, exact ${(t2 - t1).toFixed(0)} ms, views ${(t3 - t2).toFixed(0)} ms]\n` +
    lines.join('\n')
  );
}

$('check').addEventListener('click', async () => {
  const j = junctions[Number($<HTMLSelectElement>('junctions').value)];
  if (!j) return;
  $('result').textContent = 'Checking...';
  try {
    $('result').textContent = await check(j);
  } catch (error) {
    $('result').textContent = (error as Error).message;
  }
});

$('check-all').addEventListener('click', async () => {
  const out: string[] = [];
  for (const [i, j] of junctions.entries()) {
    $('result').textContent = `Checking ${i + 1}/${junctions.length}...`;
    try {
      const text = await check(j);
      if (!/: 0 candidate gaps/.test(text.split('\n')[0]!)) out.push(text);
    } catch (error) {
      out.push(`${j.a.edid} | ${j.b.map((t) => t.edid).join(' + ')}: ${(error as Error).message}`);
    }
  }
  $('gallery').innerHTML = '';
  $('result').textContent =
    `${junctions.length} junctions; those with candidate gaps:\n` + out.join('\n');
});

openDataView()
  .then(useView)
  .catch((error: Error) => {
    $('status').textContent = error.message;
    $('status').className = 'err';
  });
