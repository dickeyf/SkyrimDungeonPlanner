/**
 * R14b proof of concept: find a mesh through the virtual Data view (loose file, else the
 * last archive in load order that has it), read it with ranged reads + LZ4, parse the NIF
 * and draw it in three.js with a 128-unit grid, top-down orthographic camera (D44).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { readAll } from '$lib/fs';
import { BsaArchive, FileRangeSource } from '$lib/format/bsa';
import { NifFile, mergeShapes, type MergedMesh } from '$lib/format/nif';
import { archiveLoadOrder, type ArchiveEntry, type Overlay } from '$lib/vfs';
import { bindProfileSelect, describeView, openDataView, type DataView } from './shared/dataView';

const GRID_MODULE = 128; // PoC only; the app takes it from the kit (D53)

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $<HTMLPreElement>('log');
const log = (m: string, cls = '') => {
  const line = document.createElement('div');
  line.textContent = m;
  if (cls) line.className = cls;
  logEl.prepend(line);
};

// -- data access ----------------------------------------------------------------------------

let overlay: Overlay | null = null;
let archives: ArchiveEntry[] = [];
const openArchives = new Map<string, Promise<BsaArchive>>();

async function useView(view: DataView): Promise<void> {
  overlay = view.overlay;
  openArchives.clear();
  const started = performance.now();
  archives = await archiveLoadOrder(overlay, view.plugins);
  $('status').textContent =
    `${describeView(view)} ${archives.length} archives (${(performance.now() - started).toFixed(0)} ms).`;
  $('status').className = 'ok';
  $<HTMLButtonElement>('load').disabled = false;
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

function archive(entry: ArchiveEntry): Promise<BsaArchive> {
  let p = openArchives.get(entry.name);
  if (!p) {
    p = (async () => {
      const started = performance.now();
      const bsa = await BsaArchive.open(await FileRangeSource.open(entry.file));
      log(
        `opened ${entry.name}: ${bsa.header.fileCount} files, tables read in ${(performance.now() - started).toFixed(0)} ms`,
      );
      return bsa;
    })();
    openArchives.set(entry.name, p);
  }
  return p;
}

async function fetchMesh(path: string): Promise<{ bytes: Uint8Array; from: string }> {
  const loose = await overlay!.resolveFile(path);
  if (loose) return { bytes: await readAll(loose.file), from: `loose file in ${loose.layer.name}` };
  // Later archives override earlier ones: search from the end. Skip texture archives.
  for (let i = archives.length - 1; i >= 0; i--) {
    const entry = archives[i]!;
    if (/textures|sounds|voices|interface|animations|shaders/i.test(entry.name)) continue;
    const bsa = await archive(entry);
    const found = bsa.get(path);
    if (found) {
      const started = performance.now();
      const bytes = await bsa.read(found);
      return {
        bytes,
        from: `${entry.name} (${found.compressed ? 'LZ4' : 'stored'}, ${found.size} -> ${bytes.length} bytes in ${(performance.now() - started).toFixed(1)} ms)`,
      };
    }
  }
  throw new Error(`${path} not found in any layer or archive`);
}

// -- rendering -------------------------------------------------------------------------------

const canvas = $<HTMLCanvasElement>('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1e1d24);
const camera = new THREE.OrthographicCamera(-512, 512, 512, -512, -5000, 5000);
camera.up.set(0, 1, 0); // Skyrim: Z up; top view looks down -Z with north (+Y) up on screen
const controls = new OrbitControls(camera, canvas);
controls.enableRotate = true;
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(300, -500, 900);
scene.add(sun);

const grid = new THREE.GridHelper(2048, 2048 / GRID_MODULE, 0xd9c27a, 0x3d3b47);
grid.rotation.x = Math.PI / 2; // GridHelper lies in XZ; put it in XY (floor plane)
scene.add(grid);
scene.add(new THREE.AxesHelper(192));

let meshObject: THREE.Object3D | null = null;
let boxHelper: THREE.Box3Helper | null = null;

function topView(): void {
  camera.position.set(0, 0, 2000);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  controls.target.set(0, 0, 0);
  controls.update();
}

function resize(): void {
  const { clientWidth: w, clientHeight: h } = $('view');
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(window.devicePixelRatio);
  const halfW = 512 * (w / h);
  camera.left = -halfW;
  camera.right = halfW;
  camera.top = 512;
  camera.bottom = -512;
  camera.updateProjectionMatrix();
}

function draw(mesh: MergedMesh): void {
  if (meshObject) scene.remove(meshObject);
  if (boxHelper) scene.remove(boxHelper);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  const flat = geometry.toNonIndexed();
  flat.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: 0xb9b3a8,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  meshObject = new THREE.Mesh(flat, material);
  scene.add(meshObject);
  boxHelper = new THREE.Box3Helper(
    new THREE.Box3(new THREE.Vector3(...mesh.min), new THREE.Vector3(...mesh.max)),
    0x8fd18f,
  );
  scene.add(boxHelper);
}

function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// -- wiring ----------------------------------------------------------------------------------

let lastNif: NifFile | null = null;

function redraw(): void {
  if (!lastNif) return;
  draw(mergeShapes(lastNif, { skipAlpha: $<HTMLInputElement>('alpha').checked }));
}

$('load').addEventListener('click', async () => {
  const path = $<HTMLInputElement>('path').value.trim();
  try {
    const t0 = performance.now();
    const { bytes, from } = await fetchMesh(path);
    const t1 = performance.now();
    lastNif = NifFile.parse(bytes);
    const merged = mergeShapes(lastNif);
    const t2 = performance.now();
    redraw();
    const size = merged.max.map((v, i) => v - merged.min[i]!);
    const stats: [string, string][] = [
      ['source', from],
      ['blocks', `${lastNif.blocks.length} (${lastNif.blockTypes.join(', ')})`],
      ['shapes', `${lastNif.shapes().length}`],
      ['vertices', `${merged.positions.length / 3}`],
      ['triangles', `${merged.indices.length / 3}`],
      ['bbox min', merged.min.map((v) => v.toFixed(1)).join(', ')],
      ['bbox max', merged.max.map((v) => v.toFixed(1)).join(', ')],
      ['size', size.map((v) => v.toFixed(0)).join(' x ')],
      ['fetch / parse', `${(t1 - t0).toFixed(1)} ms / ${(t2 - t1).toFixed(1)} ms`],
    ];
    $('stats').innerHTML = stats.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    log(
      `${path}: ${merged.positions.length / 3} vertices, ${size.map((v) => v.toFixed(0)).join('x')}`,
      'ok',
    );
  } catch (error) {
    log(`failed: ${(error as Error).message}`, 'err');
  }
});
$('presets').addEventListener('change', () => {
  $<HTMLInputElement>('path').value = $<HTMLSelectElement>('presets').value;
});
$('top').addEventListener('click', topView);
$('alpha').addEventListener('change', redraw);
window.addEventListener('resize', resize);

resize();
topView();
animate();
void setup();
