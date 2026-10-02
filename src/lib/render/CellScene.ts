/**
 * Imperative three.js view of a cell (D44), outside Svelte: top-down orthographic camera,
 * kit grid, one mesh per placed object sharing cached geometries, pan/zoom, click picking.
 * Renders on demand only (after a change or camera move).
 */
import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Raycaster,
  Scene,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import type { Vec3 } from '../catalogue/types';
import type { ArchiveIndex } from '../vfs/archiveIndex';
import type { MeshCache } from './meshCache';
import { TextureCache } from './textureCache';
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
/** A NavMesh layer drawn over the tiles. */
export interface NavLayer {
  vertices?: readonly Vec3[];
  triangles?: readonly (readonly number[])[];
  /** Loose edges (a selection), drawn in `line`. */
  lines?: readonly (readonly [Vec3, Vec3])[];
  /** Vertex points (a selection), drawn in `line`. */
  points?: readonly Vec3[];
  fill: string;
  line: string;
  opacity?: number;
  /** Draw the triangles' edges (default true). */
  edges?: boolean;
}

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
  /** The inset camera was moved, turned or raised from the top-down view. */
  eye?(eye: Eye): void;
}

/** How objects that are not tiles (clutter, markers, custom pieces) are drawn. */
export type OpaqueDisplay = 'visible' | 'faded' | 'hidden';

export interface GridSpec {
  origin: Vec3;
  module: number;
  /** Cell range to draw, [i0, i1) x [j0, j1). */
  range: [number, number, number, number];
}

/**
 * The inset viewport's camera (V3, D67): where it stands and where it looks, as a heading
 * around Z (radians, clockwise from north, +Y).
 */
export interface Eye {
  pos: Vec3;
  heading: number;
}

/** Eye level above the floor, in game units (a standing character's eyes). */
export const EYE_HEIGHT = 120;

/** The inset camera's vertical field of view, in degrees. */
const EYE_FOV = 75;
/** Size of the camera's shapes in the top-down view, in pixels. */
const EYE_DISC = 9;
const EYE_WEDGE = 46;
const EYE_HANDLE = 6;
/** Height step of the wheel over the camera, in game units. */
const EYE_STEP = 16;

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
  private readonly selected = new Set<Mesh>();
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
  /** The inset viewport (V3 step 1): a perspective camera, drawn in `insetBox`. */
  private readonly eyeCamera = new PerspectiveCamera(75, 1, 4, 60000);
  private eye: Eye | null = null;
  /** The element the inset is drawn under (its box, relative to the canvas). */
  private insetBox: HTMLElement | null = null;
  /** The camera drawn in the top-down view (V3 step 2): disc, field-of-view wedge, handle. */
  private readonly eyeShape = new Group();
  private eyeDrag: 'move' | 'turn' | null = null;
  /** The textured view (V3 step 4, D66): on when a texture cache is set. */
  private textures: TextureCache | null = null;
  private textureIndex: ArchiveIndex | null = null;
  private meshCache: MeshCache | null = null;
  private readonly texMaterials = new Map<string, MeshLambertMaterial>();

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
    this.eyeCamera.up.set(0, 0, 1);
    this.buildEyeShape();
    this.scene.add(this.eyeShape);
    this.controls = new MapControls(this.camera, canvas);
    this.controls.enableRotate = false;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('change', () => this.requestRender());

    // capture phase: runs before the controls, so a drag can be claimed before panning starts
    canvas.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
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

  private navmesh: Group | null = null;

  /**
   * Draw NavMesh layers over the tiles (not pickable): each its triangles (translucent fill and
   * edges), loose edges and vertex points, in its own colours; null removes them.
   */
  setNavMesh(layers: readonly NavLayer[] | null): void {
    if (this.navmesh) {
      for (const child of this.navmesh.children) {
        const m = child as Mesh | LineSegments | Points;
        m.geometry.dispose();
        (m.material as MeshBasicMaterial | LineBasicMaterial | PointsMaterial).dispose();
      }
      this.scene.remove(this.navmesh);
      this.navmesh = null;
    }
    if (layers?.length) {
      const group = new Group();
      layers.forEach((layer, n) => {
        const order = 15 + n * 3;
        const lift = 2 + n * 0.01;
        if (layer.triangles?.length && layer.vertices) {
          const positions = new Float32Array(
            layer.vertices.flatMap((v) => [v[0], v[1], v[2] + lift]),
          );
          const fill = new BufferGeometry();
          fill.setAttribute('position', new Float32BufferAttribute(positions, 3));
          fill.setIndex(layer.triangles.flatMap((t) => [...t]));
          const surface = new Mesh(
            fill,
            new MeshBasicMaterial({
              color: layer.fill,
              transparent: true,
              opacity: layer.opacity ?? 0.35,
              depthTest: false,
              side: DoubleSide,
            }),
          );
          surface.renderOrder = order;
          group.add(surface);
          if (layer.edges !== false) {
            const edges = new BufferGeometry();
            edges.setAttribute('position', new Float32BufferAttribute(positions, 3));
            edges.setIndex(
              layer.triangles.flatMap((t) => [t[0]!, t[1]!, t[1]!, t[2]!, t[2]!, t[0]!]),
            );
            const lines = new LineSegments(
              edges,
              new LineBasicMaterial({
                color: layer.line,
                transparent: true,
                opacity: 0.9,
                depthTest: false,
              }),
            );
            lines.renderOrder = order + 1;
            group.add(lines);
          }
        }
        if (layer.lines?.length) {
          const g = new BufferGeometry();
          g.setAttribute(
            'position',
            new Float32BufferAttribute(
              layer.lines.flatMap(([p, q]) => [p[0], p[1], p[2] + lift, q[0], q[1], q[2] + lift]),
              3,
            ),
          );
          const lines = new LineSegments(
            g,
            new LineBasicMaterial({ color: layer.line, depthTest: false }),
          );
          lines.renderOrder = order + 1;
          group.add(lines);
        }
        if (layer.points?.length) {
          const g = new BufferGeometry();
          g.setAttribute(
            'position',
            new Float32BufferAttribute(
              layer.points.flatMap((p) => [p[0], p[1], p[2] + lift]),
              3,
            ),
          );
          const points = new Points(
            g,
            new PointsMaterial({
              color: layer.line,
              size: 7,
              sizeAttenuation: false,
              depthTest: false,
            }),
          );
          points.renderOrder = order + 2;
          group.add(points);
        }
      });
      this.navmesh = group;
      this.scene.add(group);
    }
    this.requestRender();
  }

  /**
   * Show the inset viewport under `box` (an element over the canvas), looking from `eye`; null
   * hides it.
   */
  setInset(box: HTMLElement | null, eye: Eye | null): void {
    this.insetBox = box;
    this.eye = eye;
    this.eyeShape.visible = !!eye && !!box;
    if (eye) {
      this.eyeShape.position.set(eye.pos[0], eye.pos[1], this.planeZ);
      this.eyeShape.rotation.set(0, 0, -eye.heading);
      const [x, y, z] = eye.pos;
      this.eyeCamera.position.set(x, y, z);
      this.eyeCamera.lookAt(new Vector3(x + Math.sin(eye.heading), y + Math.cos(eye.heading), z));
    }
    this.requestRender();
  }

  /**
   * The floor height under a point: the highest tile surface below `above`, seen straight
   * down; undefined when there is none.
   */
  floorAt(x: number, y: number, above: number): number | undefined {
    const ray = new Raycaster(new Vector3(x, y, above), new Vector3(0, 0, -1));
    const hit = ray
      .intersectObjects(this.objects.children, false)
      .find((h) => h.object.visible && (h.object as Object3D).userData.pickable);
    return hit?.point.z;
  }

  /** The camera's shapes, one unit = one pixel (scaled with the zoom when drawn). */
  private buildEyeShape(): void {
    const mat = (color: string, opacity = 1) =>
      new MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false });
    const half = ((EYE_FOV / 2) * Math.PI) / 180;
    const wedge = new Shape();
    wedge.moveTo(0, 0);
    wedge.lineTo(-Math.sin(half) * EYE_WEDGE, Math.cos(half) * EYE_WEDGE);
    wedge.lineTo(Math.sin(half) * EYE_WEDGE, Math.cos(half) * EYE_WEDGE);
    wedge.closePath();
    const parts: [Mesh, number][] = [
      [new Mesh(new ShapeGeometry(wedge), mat('#ffd166', 0.35)), 0],
      [new Mesh(new CircleGeometry(EYE_DISC, 24), mat('#ffd166')), 1],
      [new Mesh(new CircleGeometry(EYE_DISC * 0.45, 16), mat('#16151b')), 2],
      [new Mesh(new CircleGeometry(EYE_HANDLE, 16), mat('#ffd166')), 3],
    ];
    parts[3]![0].position.set(0, EYE_WEDGE, 0);
    for (const [mesh, order] of parts) {
      mesh.renderOrder = 40 + order;
      this.eyeShape.add(mesh);
    }
    this.eyeShape.visible = false;
  }

  /** Which part of the camera's shapes is under a screen point, if any. */
  private eyePart(e: { clientX: number; clientY: number }): 'move' | 'turn' | null {
    if (!this.eye || !this.eyeShape.visible) return null;
    const p = this.toScreen(this.eye.pos[0], this.eye.pos[1]);
    const tip = this.toScreen(
      this.eye.pos[0] + (Math.sin(this.eye.heading) * EYE_WEDGE) / this.camera.zoom,
      this.eye.pos[1] + (Math.cos(this.eye.heading) * EYE_WEDGE) / this.camera.zoom,
    );
    if (Math.hypot(e.clientX - tip.x, e.clientY - tip.y) <= EYE_HANDLE + 4) return 'turn';
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) <= EYE_DISC + 4) return 'move';
    return null;
  }

  /** Client coordinates of a world point of the grid plane. */
  private toScreen(x: number, y: number): { x: number; y: number } {
    const v = new Vector3(x, y, this.planeZ).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  /** Move, turn or raise the camera and tell the page. */
  private updateEye(eye: Eye): void {
    this.setInset(this.insetBox, eye);
    this.handlers.eye?.(eye);
  }

  /** The centre of the drawn objects (or of the grid), for a first camera position. */
  centre(): [number, number] | undefined {
    const box = this.objectBounds();
    return box ? [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2] : undefined;
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
    this.meshCache = cache;
    let done = 0;
    let markers = 0;
    await Promise.all(
      list.map(async (o) => {
        const geometry = o.modelPath ? await cache.get(o.modelPath) : null;
        const mesh = new Mesh(geometry ?? MARKER);
        if (!geometry) markers++;
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(placementMatrix(o.pos, o.rot, geometry ? o.scale : 1));
        mesh.userData = {
          key: o.key,
          pickable: o.pickable,
          color: o.color,
          modelPath: o.modelPath,
          plain: mesh.geometry,
        };
        this.styleMesh(mesh);
        if (this.textures) void this.applyTexture(mesh);
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
    this.meshCache = cache;
    const wanted = new Set(list.map((o) => o.key));
    for (const [key, mesh] of this.byKey) {
      if (!wanted.has(key)) {
        this.objects.remove(mesh);
        this.byKey.delete(key);
        this.selected.delete(mesh);
      }
    }
    list.forEach((o, i) => {
      const geometry = geometries[i] ?? null;
      const plain = geometry ?? MARKER;
      let mesh = this.byKey.get(o.key);
      let changed = false;
      if (!mesh) {
        mesh = new Mesh(plain);
        mesh.matrixAutoUpdate = false;
        this.objects.add(mesh);
        this.byKey.set(o.key, mesh);
        changed = true;
      } else if (mesh.userData.plain !== plain) {
        // another model: back to its plain geometry until its textured one is ready
        mesh.geometry = plain;
        changed = true;
      }
      mesh.matrix.copy(placementMatrix(o.pos, o.rot, geometry ? o.scale : 1));
      mesh.matrixWorldNeedsUpdate = true;
      const tex: unknown = changed ? undefined : mesh.userData.tex;
      mesh.userData = {
        key: o.key,
        pickable: o.pickable,
        color: o.color,
        modelPath: o.modelPath,
        plain,
        tex,
      };
      this.styleMesh(mesh);
      if (this.textures && changed) void this.applyTexture(mesh);
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
    const box = this.objectBounds();
    if (!box) return;
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

  /** Bounds of the placed objects' origins, else of the grid (an empty cell). */
  private objectBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const child of this.objects.children) {
      const m = (child as Mesh).matrix.elements;
      box.minX = Math.min(box.minX, m[12]!);
      box.maxX = Math.max(box.maxX, m[12]!);
      box.minY = Math.min(box.minY, m[13]!);
      box.maxY = Math.max(box.maxY, m[13]!);
    }
    if (Number.isFinite(box.minX)) return box;
    return this.gridBounds ? { ...this.gridBounds } : null;
  }

  setOpaqueDisplay(display: OpaqueDisplay): void {
    this.opaqueDisplay = display;
    for (const child of this.objects.children) this.styleMesh(child as Mesh);
    this.requestRender();
  }

  /** Material and visibility of a mesh from its colour, pickability and the display mode. */
  private styleMesh(mesh: Mesh): void {
    const { color, pickable } = mesh.userData as { color: string; pickable: boolean };
    if (this.selected.has(mesh)) {
      mesh.material = this.material(SELECTED_COLOR);
      mesh.visible = true;
      return;
    }
    const faded = !pickable && this.opaqueDisplay === 'faded';
    const tex = this.textures
      ? (mesh.userData.tex as { texture: string; alpha: boolean }[] | undefined)
      : undefined;
    mesh.material = tex
      ? tex.map((r) => this.texMaterial(r.texture, r.alpha, faded ? 0.12 : 1))
      : this.material(color, faded ? 0.12 : 1);
    mesh.visible = pickable || this.opaqueDisplay !== 'hidden';
  }

  /** Highlight the tiles of `keys` (the selection), and only them. */
  select(keys: readonly string[]): void {
    const previous = [...this.selected];
    this.selected.clear();
    for (const key of keys) {
      const mesh = this.byKey.get(key);
      if (mesh) this.selected.add(mesh);
    }
    for (const mesh of previous) this.styleMesh(mesh);
    for (const mesh of this.selected) this.styleMesh(mesh);
    this.requestRender();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel, { capture: true });
    this.controls.dispose();
    this.clearObjects();
    this.setHighlights([]);
    this.setNavMesh(null);
    this.setGrid(null);
    for (const m of this.materials.values()) m.dispose();
    for (const m of this.texMaterials.values()) m.dispose();
    this.textures?.dispose();
    this.renderer.dispose();
  }

  /**
   * Turn the textured view on (the texture archives to read from) or off (null). The pieces
   * switch to their textured geometry as it loads; the plain view comes back at once.
   */
  async setTextures(index: ArchiveIndex | null): Promise<void> {
    if (index === this.textureIndex) return;
    this.textureIndex = index;
    if (!index) {
      this.textures = null;
      for (const child of this.objects.children) {
        const mesh = child as Mesh;
        mesh.geometry = (mesh.userData.plain as BufferGeometry | undefined) ?? mesh.geometry;
        this.styleMesh(mesh);
      }
      this.requestRender();
      return;
    }
    if (!this.textures || this.texMaterials.size === 0) {
      this.textures?.dispose();
      this.textures = new TextureCache(index, this.renderer);
      for (const m of this.texMaterials.values()) m.dispose();
      this.texMaterials.clear();
    }
    await Promise.all(this.objects.children.map((c) => this.applyTexture(c as Mesh)));
  }

  /** Give a mesh its textured geometry and materials, when the textured view is on. */
  private async applyTexture(mesh: Mesh): Promise<void> {
    const path = mesh.userData.modelPath as string | undefined;
    if (!this.textures || !this.meshCache || !path) return;
    const textured = await this.meshCache.textured(path);
    // the view was turned off, or the mesh got another model, while loading
    if (!this.textures || mesh.userData.modelPath !== path) return;
    if (textured) {
      mesh.geometry = textured.geometry;
      mesh.userData.tex = textured.ranges;
    }
    this.styleMesh(mesh);
    this.requestRender();
  }

  /** A textured material, shared by every part with the same texture and opacity. */
  private texMaterial(texture: string, alpha: boolean, opacity: number): MeshLambertMaterial {
    const key = `${texture}/${alpha ? 'a' : ''}/${opacity}`;
    let m = this.texMaterials.get(key);
    if (!m) {
      const material = new MeshLambertMaterial({
        color: '#ffffff',
        alphaTest: alpha ? 0.5 : 0,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity === 1,
      });
      m = material;
      this.texMaterials.set(key, material);
      if (texture && this.textures)
        void this.textures.get(texture).then((t) => {
          if (t) material.map = t;
          else material.color.set('#8a8a8a'); // missing: a neutral grey
          material.needsUpdate = true;
          this.requestRender();
        });
      else material.color.set('#8a8a8a');
    }
    return m;
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
    this.selected.clear();
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
      // the camera's shapes keep their size on screen
      this.eyeShape.scale.setScalar(1 / this.camera.zoom);
      this.eyeShape.updateMatrixWorld();
      this.renderer.render(this.scene, this.camera);
      this.renderInset();
    });
  }

  /**
   * The inset, drawn into its box over the top-down view (one renderer, two cameras, R18): the
   * tiles and other objects, and the ghost of a piece being placed or moved; without the grid,
   * marks or NavMesh.
   */
  private renderInset(): void {
    if (!this.eye || !this.insetBox) return;
    const c = this.canvas.getBoundingClientRect();
    const b = this.insetBox.getBoundingClientRect();
    const w = Math.round(b.width);
    const h = Math.round(b.height);
    if (w < 8 || h < 8) return;
    const x = Math.round(b.left - c.left);
    const y = Math.round(c.bottom - b.bottom); // WebGL counts from the bottom
    this.eyeCamera.aspect = w / h;
    this.eyeCamera.updateProjectionMatrix();
    const hidden = [this.grid, this.highlights, this.navmesh, this.eyeShape].filter(
      (o): o is NonNullable<typeof o> => !!o && o.visible,
    );
    for (const o of hidden) o.visible = false;
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(x, y, w, h);
    this.renderer.setViewport(x, y, w, h);
    this.renderer.render(this.scene, this.eyeCamera);
    this.renderer.setScissorTest(false);
    const size = this.renderer.getSize(new Vector2());
    this.renderer.setViewport(0, 0, size.x, size.y);
    for (const o of hidden) o.visible = true;
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
    // the inset camera's shapes come before anything else
    const part = this.eyePart(e);
    if (part) {
      this.eyeDrag = part;
      this.controls.enabled = false;
      this.canvas.setPointerCapture(e.pointerId);
      e.stopImmediatePropagation();
      return;
    }
    this.downAt = { x: e.clientX, y: e.clientY };
    if (this.handlers.down?.(this.info(e))) {
      this.dragging = true;
      this.controls.enabled = false;
      this.canvas.setPointerCapture(e.pointerId);
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.eyeDrag && this.eye) {
      const [x, y] = this.info(e).world;
      const [ex, ey, ez] = this.eye.pos;
      if (this.eyeDrag === 'turn') {
        this.updateEye({ ...this.eye, heading: Math.atan2(x - ex, y - ey) });
      } else {
        // the camera follows the floor under it: up a ramp, down a step (not through a ceiling)
        const floor = this.floorAt(x, y, ez + EYE_STEP * 4);
        this.updateEye({ ...this.eye, pos: [x, y, floor === undefined ? ez : floor + EYE_HEIGHT] });
      }
      return;
    }
    this.canvas.style.cursor = this.eyePart(e) ? 'grab' : '';
    this.handlers.move?.(this.info(e));
  };

  /** A press and release without movement is a click; a claimed drag ends; else it was a pan. */
  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (this.eyeDrag) {
      this.eyeDrag = null;
      this.controls.enabled = true;
      if (this.canvas.hasPointerCapture(e.pointerId))
        this.canvas.releasePointerCapture(e.pointerId);
      this.downAt = null;
      return;
    }
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

  /** The wheel over the camera raises or lowers it, instead of zooming. */
  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.eye || this.eyePart(e) !== 'move') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const [x, y, z] = this.eye.pos;
    this.updateEye({ ...this.eye, pos: [x, y, z + (e.deltaY < 0 ? EYE_STEP : -EYE_STEP)] });
  };
}
