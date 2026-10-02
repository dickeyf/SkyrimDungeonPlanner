/**
 * V3 step 3 (R17): diffuse textures in the browser. Lists the Imperial kit's models, draws one
 * with its DDS textures (perspective, orbit), and loads every texture of the kit to measure the
 * time and the GPU memory a textured cell would take.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { NifFile, mergeShapes } from '$lib/format/nif';
import { TextureCache, textureArchivePath } from '$lib/render';
import { ArchiveIndex } from '$lib/vfs';
import { bindProfileSelect, describeView, openDataView, type DataView } from './shared/dataView';

const KIT_PREFIX = 'meshes/dungeons/imperial/';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $<HTMLPreElement>('log');
const log = (m: string, cls = '') => {
  const line = document.createElement('div');
  line.textContent = m;
  if (cls) line.className = cls;
  logEl.prepend(line);
};

const canvas = $<HTMLCanvasElement>('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x16151b);
scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(0.4, -0.7, 1);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(60, 1, 1, 100000);
camera.up.set(0, 0, 1);
camera.position.set(400, -400, 400);
const controls = new OrbitControls(camera, canvas);
controls.addEventListener('change', render);
let current: THREE.Mesh | null = null;

function render(): void {
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}
new ResizeObserver(render).observe(canvas);

let meshes: ArchiveIndex | null = null;
let textures: TextureCache | null = null;
let models: string[] = [];

async function useView(view: DataView): Promise<void> {
  const started = performance.now();
  meshes = await ArchiveIndex.build(view.overlay, view.plugins, 'meshes');
  const texIndex = await ArchiveIndex.build(view.overlay, view.plugins, 'textures');
  textures?.dispose();
  textures = new TextureCache(texIndex, renderer);
  const ext = (n: string) => (renderer.extensions.has(n) ? 'yes' : 'no');
  $('status').textContent =
    `${describeView(view)} ${meshes.archives.length} mesh and ${texIndex.archives.length} texture ` +
    `archives (${(performance.now() - started).toFixed(0)} ms). GPU: S3TC ${ext('WEBGL_compressed_texture_s3tc')}, ` +
    `BPTC (BC7) ${ext('EXT_texture_compression_bptc')}, RGTC (BC5) ${ext('EXT_texture_compression_rgtc')}.`;
  $('status').className = 'ok';
  $<HTMLButtonElement>('kit').disabled = false;
  bindProfileSelect($<HTMLSelectElement>('profile'), view, (next) => void useView(next));
}

$('kit').addEventListener('click', async () => {
  if (!meshes) return;
  const found = new Set<string>();
  for (const archive of meshes.archives) {
    const bsa = await meshes.open(archive);
    for (const e of bsa.find(KIT_PREFIX, '.nif')) found.add(e.path);
  }
  models = [...found].sort();
  $<HTMLSelectElement>('model').innerHTML = models
    .map((m, i) => `<option value="${i}">${m.slice(KIT_PREFIX.length)}</option>`)
    .join('');
  log(`${models.length} models under ${KIT_PREFIX}`, 'ok');
  $<HTMLButtonElement>('draw').disabled = $<HTMLButtonElement>('measure').disabled = !models.length;
});

/** A model's merged mesh as a geometry with one group (and material) per texture range. */
async function texturedMesh(path: string): Promise<{ mesh: THREE.Mesh; textures: string[] }> {
  const read = await meshes!.read(path);
  if (!read) throw new Error(`${path} not found`);
  const merged = mergeShapes(NifFile.parse(read.bytes));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(merged.positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(merged.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(merged.indices, 1));
  geometry.computeVertexNormals();
  const materials: THREE.Material[] = [];
  const names: string[] = [];
  for (const [i, r] of merged.ranges.entries()) {
    geometry.addGroup(r.start, r.count, i);
    const material = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      alphaTest: r.alpha ? 0.5 : 0,
      side: THREE.DoubleSide,
    });
    names.push(r.texture);
    if (r.texture) {
      const t = await textures!.get(r.texture);
      if (t) material.map = t;
      else material.color.set(0xff00ff);
    }
    materials.push(material);
  }
  return { mesh: new THREE.Mesh(geometry, materials), textures: names };
}

$('draw').addEventListener('click', async () => {
  const path = models[Number($<HTMLSelectElement>('model').value)];
  if (!path || !textures) return;
  try {
    const started = performance.now();
    const { mesh, textures: names } = await texturedMesh(path);
    if (current) scene.remove(current);
    current = mesh;
    scene.add(mesh);
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    controls.target.copy(centre);
    camera.position.set(centre.x + size * 0.6, centre.y - size * 0.6, centre.z + size * 0.5);
    controls.update();
    render();
    log(
      `${path.slice(KIT_PREFIX.length)}: ${names.length} ranges, ` +
        `${(performance.now() - started).toFixed(0)} ms; ${[...new Set(names)].join(', ')}`,
    );
  } catch (error) {
    log((error as Error).message, 'err');
  }
});

$('measure').addEventListener('click', async () => {
  if (!meshes || !textures) return;
  $('result').textContent = 'Working...';
  const t0 = performance.now();
  const paths = new Set<string>();
  for (const m of models) {
    const read = await meshes.read(m);
    if (!read) continue;
    try {
      for (const r of mergeShapes(NifFile.parse(read.bytes)).ranges)
        if (r.texture) paths.add(textureArchivePath(r.texture));
    } catch {
      /* unreadable model */
    }
  }
  const t1 = performance.now();
  const loaded = await Promise.all([...paths].map((p) => textures!.get(p)));
  // upload them all to the GPU (a texture is uploaded when first drawn)
  for (const t of loaded) if (t) renderer.initTexture(t);
  const t2 = performance.now();
  const s = textures.stats;
  $('result').textContent =
    `${models.length} models, ${paths.size} distinct diffuse textures (read in ${(t1 - t0).toFixed(0)} ms)\n` +
    `loaded ${s.loaded}, missing or unsupported ${s.missing}, decoded in software ${s.decoded}\n` +
    `formats: ${Object.entries(s.byFormat)
      .map(([f, n]) => `${f} x${n}`)
      .join(', ')}\n` +
    `GPU memory: ${(s.gpuBytes / 1048576).toFixed(1)} MB\n` +
    `textures read, decoded and uploaded in ${(t2 - t1).toFixed(0)} ms
` +
    `missing or unsupported: ${s.missingPaths.join(', ') || 'none'}`;
  log(`kit measured: ${paths.size} textures in ${((t2 - t0) / 1000).toFixed(1)} s`, 'ok');
});

openDataView()
  .then(useView)
  .catch((error: Error) => {
    $('status').textContent = error.message;
    $('status').className = 'err';
  });
