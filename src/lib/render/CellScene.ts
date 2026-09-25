/**
 * Imperative three.js view of a cell (D44), outside Svelte: top-down orthographic camera,
 * kit grid, one mesh per placed object sharing cached geometries, pan/zoom, click picking.
 * Renders on demand only (after a change or camera move).
 */
import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OrthographicCamera,
  Raycaster,
  Scene,
  Vector2,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import type { Vec3 } from '../catalogue/types';
import type { MeshCache } from './meshCache';
import { gridLines, placementMatrix } from './transform';

export interface SceneObject {
  key: string;
  /** Archive-style model path, or undefined when unknown (drawn as a marker). */
  modelPath?: string;
  pos: Vec3;
  rot: Vec3;
  scale: number;
  color: string;
  /** Tiles are pickable; other objects are shown as-is. */
  pickable: boolean;
}

/** Pointer event in the scene: the point on the grid plane and the pickable object under it. */
export interface PointerInfo {
  world: Vec3;
  key: string | null;
  shift: boolean;
}

export interface SceneHandlers {
  /** A press and release without movement. */
  click(info: PointerInfo): void;
  /** Return true to start a drag: panning is disabled until the button is released. */
  down?(info: PointerInfo): boolean;
  /** Any pointer movement, hovering or dragging. */
  move?(info: PointerInfo): void;
  /** End of a drag started by `down`. */
  up?(info: PointerInfo): void;
}

/** How objects that are not tiles (clutter, markers, custom pieces) are drawn. */
export type OpaqueDisplay = 'visible' | 'faded' | 'hidden';

export interface GridSpec {
  origin: Vec3;
  module: number;
  /** Cell range to draw, [i0, i1) x [j0, j1). */
  range: [number, number, number, number];
}

/** A flat rectangle drawn over everything, e.g. an open face of the assistant. */
export interface Highlight {
  min: [number, number];
  max: [number, number];
  color: string;
  opacity: number;
}

const MARKER = new BoxGeometry(24, 24, 24);
const SELECTED_COLOR = '#ffffff';

export class CellScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
  private readonly controls: MapControls;
  private readonly objects = new Group();
  private grid: LineSegments | null = null;
  private readonly materials = new Map<string, MeshLambertMaterial>();
  private readonly byKey = new Map<string, Mesh>();
  private selected: Mesh | null = null;
  private opaqueDisplay: OpaqueDisplay = 'visible';
  private frame = 0;
  private readonly observer: ResizeObserver;
  private downAt: { x: number; y: number } | null = null;
  private dragging = false;
  private planeZ = 0;
  private ghost: Mesh | null = null;
  /** Bumped by each syncObjects call; a call that is no longer the latest gives up. */
  private syncGeneration = 0;
  /** World bounds of the drawn grid, to frame an empty cell. */
  private gridBounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  private readonly highlights = new Group();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly handlers: SceneHandlers,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.scene.background = new Color(0x16151b);
    this.scene.add(new AmbientLight(0xffffff, 0.55));
    const sun = new DirectionalLight(0xffffff, 1.1);
    sun.position.set(0.4, -0.7, 1);
    this.scene.add(sun);
    this.scene.add(this.objects, this.highlights);

    // Skyrim frame: Z up; looking down -Z with north (+Y) up on screen
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(0, 0, 50000);
    this.camera.lookAt(0, 0, 0);
    this.controls = new MapControls(this.camera, canvas);
    this.controls.enableRotate = false;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('change', () => this.requestRender());

    // capture phase: runs before the controls, so a drag can be claimed before panning starts
    canvas.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }

  setGrid(spec: GridSpec | null): void {
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      (this.grid.material as LineBasicMaterial).dispose();
      this.grid = null;
      this.gridBounds = null;
    }
    if (spec) {
      this.planeZ = spec.origin[2];
      const [i0, i1, j0, j1] = spec.range;
      this.gridBounds = {
        minX: spec.origin[0] + i0 * spec.module,
        maxX: spec.origin[0] + i1 * spec.module,
        minY: spec.origin[1] + j0 * spec.module,
        maxY: spec.origin[1] + j1 * spec.module,
      };
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        'position',
        new Float32BufferAttribute(gridLines(spec.origin, spec.module, i0, i1, j0, j1), 3),
      );
      this.grid = new LineSegments(geometry, new LineBasicMaterial({ color: 0x3d3b47 }));
      this.grid.renderOrder = -1;
      this.scene.add(this.grid);
    }
    this.requestRender();
  }

  /** Replace the highlight rectangles (drawn on top of the tiles, not pickable). */
  setHighlights(list: readonly Highlight[]): void {
    for (const child of [...this.highlights.children]) {
      const mesh = child as Mesh;
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
      this.highlights.remove(mesh);
    }
    for (const h of list) {
      const w = h.max[0] - h.min[0];
      const d = h.max[1] - h.min[1];
      const mesh = new Mesh(
        new BoxGeometry(w, d, 1),
        new MeshBasicMaterial({
          color: h.color,
          transparent: true,
          opacity: h.opacity,
          depthTest: false,
        }),
      );
      mesh.position.set(h.min[0] + w / 2, h.min[1] + d / 2, this.planeZ);
      mesh.renderOrder = 20;
      this.highlights.add(mesh);
    }
    this.requestRender();
  }

  /** Replace the placed objects; meshes appear as their geometries load. */
  async setObjects(
    list: readonly SceneObject[],
    cache: MeshCache,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ drawn: number; markers: number }> {
    this.clearObjects();
    let done = 0;
    let markers = 0;
    await Promise.all(
      list.map(async (o) => {
        const geometry = o.modelPath ? await cache.get(o.modelPath) : null;
        const mesh = new Mesh(geometry ?? MARKER);
        if (!geometry) markers++;
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(placementMatrix(o.pos, o.rot, geometry ? o.scale : 1));
        mesh.userData = { key: o.key, pickable: o.pickable, color: o.color };
        this.styleMesh(mesh);
        this.objects.add(mesh);
        this.byKey.set(o.key, mesh);
        onProgress?.(++done, list.length);
        this.requestRender();
      }),
    );
    return { drawn: list.length - markers, markers };
  }

  /**
   * Update the placed objects in place: meshes of unchanged keys are kept (their matrix,
   * geometry and colour updated), new keys are added and missing ones removed.
   */
  async syncObjects(list: readonly SceneObject[], cache: MeshCache): Promise<void> {
    // load every geometry first, then apply the list in one go: a sync overtaken by a newer
    // one while loading is dropped, so two syncs never interleave (stale meshes left behind)
    const generation = ++this.syncGeneration;
    const geometries = await Promise.all(
      list.map((o) => (o.modelPath ? cache.get(o.modelPath) : Promise.resolve(null))),
    );
    if (generation !== this.syncGeneration) return;
    const wanted = new Set(list.map((o) => o.key));
    for (const [key, mesh] of this.byKey) {
      if (!wanted.has(key)) {
        this.objects.remove(mesh);
        this.byKey.delete(key);
        if (this.selected === mesh) this.selected = null;
      }
    }
    list.forEach((o, i) => {
      const geometry = geometries[i] ?? null;
      let mesh = this.byKey.get(o.key);
      if (!mesh) {
        mesh = new Mesh(geometry ?? MARKER);
        mesh.matrixAutoUpdate = false;
        this.objects.add(mesh);
        this.byKey.set(o.key, mesh);
      } else if (mesh.geometry !== (geometry ?? MARKER)) {
        mesh.geometry = geometry ?? MARKER;
      }
      mesh.matrix.copy(placementMatrix(o.pos, o.rot, geometry ? o.scale : 1));
      mesh.matrixWorldNeedsUpdate = true;
      mesh.userData = { key: o.key, pickable: o.pickable, color: o.color };
      this.styleMesh(mesh);
    });
    this.requestRender();
  }

  /** Preview of a piece being placed or moved; green when it fits, red on a conflict. */
  async setGhost(o: SceneObject | null, ok: boolean, cache: MeshCache): Promise<void> {
    if (!o) {
      if (this.ghost) this.scene.remove(this.ghost);
      this.ghost = null;
      this.requestRender();
      return;
    }
    const geometry = (o.modelPath ? await cache.get(o.modelPath) : null) ?? MARKER;
    if (!this.ghost) {
      this.ghost = new Mesh(geometry);
      this.ghost.matrixAutoUpdate = false;
      this.ghost.renderOrder = 10;
      this.scene.add(this.ghost);
    }
    this.ghost.geometry = geometry;
    this.ghost.material = this.material(ok ? '#7fdc7f' : '#e05050', 0.55);
    this.ghost.matrix.copy(placementMatrix(o.pos, o.rot, 1));
    this.ghost.matrixWorldNeedsUpdate = true;
    this.requestRender();
  }

  /** Frame the whole cell. */
  fit(): void {
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const child of this.objects.children) {
      const m = (child as Mesh).matrix.elements;
      box.minX = Math.min(box.minX, m[12]!);
      box.maxX = Math.max(box.maxX, m[12]!);
      box.minY = Math.min(box.minY, m[13]!);
      box.maxY = Math.max(box.maxY, m[13]!);
    }
    if (!Number.isFinite(box.minX)) {
      if (!this.gridBounds) return;
      Object.assign(box, this.gridBounds); // empty cell: frame its grid
    }
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    this.camera.position.set(cx, cy, 50000);
    this.controls.target.set(cx, cy, 0);
    const { clientWidth: w, clientHeight: h } = this.canvas;
    const span = Math.max(box.maxX - box.minX + 1024, (box.maxY - box.minY + 1024) * (w / h));
    this.camera.zoom = (2 * this.halfWidth()) / span;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.requestRender();
  }

  setOpaqueDisplay(display: OpaqueDisplay): void {
    this.opaqueDisplay = display;
    for (const child of this.objects.children) this.styleMesh(child as Mesh);
    this.requestRender();
  }

  /** Material and visibility of a mesh from its colour, pickability and the display mode. */
  private styleMesh(mesh: Mesh): void {
    const { color, pickable } = mesh.userData as { color: string; pickable: boolean };
    if (mesh === this.selected) {
      mesh.material = this.material(SELECTED_COLOR);
      mesh.visible = true;
      return;
    }
    const faded = !pickable && this.opaqueDisplay === 'faded';
    mesh.material = this.material(color, faded ? 0.12 : 1);
    mesh.visible = pickable || this.opaqueDisplay !== 'hidden';
  }

  select(key: string | null): void {
    const previous = this.selected;
    this.selected = key ? (this.byKey.get(key) ?? null) : null;
    if (previous) this.styleMesh(previous);
    if (this.selected) this.styleMesh(this.selected);
    this.requestRender();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.controls.dispose();
    this.clearObjects();
    this.setHighlights([]);
    this.setGrid(null);
    for (const m of this.materials.values()) m.dispose();
    this.renderer.dispose();
  }

  private material(color: string, opacity = 1): MeshLambertMaterial {
    const key = `${color}/${opacity}`;
    let m = this.materials.get(key);
    if (!m) {
      m = new MeshLambertMaterial({
        color,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity === 1,
      });
      this.materials.set(key, m);
    }
    return m;
  }

  private clearObjects(): void {
    this.objects.clear();
    this.byKey.clear();
    this.selected = null;
  }

  private halfWidth(): number {
    return this.canvas.clientWidth / 2;
  }

  private resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    // one unit per pixel at zoom 1; zoom scales the view
    this.camera.left = -w / 2;
    this.camera.right = w / 2;
    this.camera.top = h / 2;
    this.camera.bottom = -h / 2;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** Grid-plane point and pickable object under the pointer. */
  private info(e: PointerEvent): PointerInfo {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new Raycaster();
    ray.setFromCamera(ndc, this.camera);
    // top-down orthographic view: the ray is vertical, so x and y are those of its origin
    const world: Vec3 = [ray.ray.origin.x, ray.ray.origin.y, this.planeZ];
    const hits = ray.intersectObjects(this.objects.children, false);
    const hit = hits.find((h) => (h.object as Object3D).userData.pickable && h.object.visible);
    return { world, key: hit ? (hit.object.userData.key as string) : null, shift: e.shiftKey };
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.downAt = { x: e.clientX, y: e.clientY };
    if (this.handlers.down?.(this.info(e))) {
      this.dragging = true;
      this.controls.enabled = false;
      this.canvas.setPointerCapture(e.pointerId);
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    this.handlers.move?.(this.info(e));
  };

  /** A press and release without movement is a click; a claimed drag ends; else it was a pan. */
  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const info = this.info(e);
    if (this.dragging) {
      this.dragging = false;
      this.controls.enabled = true;
      if (this.canvas.hasPointerCapture(e.pointerId))
        this.canvas.releasePointerCapture(e.pointerId);
      this.handlers.up?.(info);
      return;
    }
    if (this.downAt && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) <= 4) {
      this.handlers.click(info);
    }
    this.downAt = null;
  };
}
