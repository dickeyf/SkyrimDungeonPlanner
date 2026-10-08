/**
 * The 3D view of the Walkable tab: one piece's collision, each triangle coloured by what the
 * walkable analysis takes it for (`faceKind`), with the walkable floor laid at its height and
 * the piece's visual mesh as a faint reference. Imperative three.js, outside Svelte; the camera
 * orbits the piece (Z up), and a frame is drawn only when something changes.
 */
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  ShapeUtils,
  Vector2,
  WebGLRenderer,
  WireframeGeometry,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Vec3 } from '../catalogue/types';
import { faceKind, type FaceKind } from '../navmesh/walkable';

/** The colour of each kind of collision face, also used by the legend. */
export const FACE_COLORS: Record<FaceKind, string> = {
  floor: '#5b9bd5',
  ceiling: '#8a8f98',
  wall: '#c8a165',
  lowWall: '#6cc070',
  soffit: '#b07cd8',
  obstacle: '#e05a5a',
};

export interface WalkablePiece {
  /** The collision in piece space, or null when the piece has none. */
  collision: { positions: Float32Array; indices: Uint32Array } | null;
  /** The visual mesh in piece space, or null; the scene owns it from then on. */
  visual: BufferGeometry | null;
  /** The walkable rings (outer rings counter-clockwise, holes clockwise). */
  rings: readonly (readonly Vec3[])[];
}

export interface WalkableLayers {
  kinds: Record<FaceKind, boolean>;
  visual: boolean;
  walkable: boolean;
  wireframe: boolean;
}

const WALKABLE_FILL = '#2f7de1';
const WALKABLE_LINE = '#7fb8ff';
const HOLE_LINE = '#ff7a7a';
/** The walkable floor is drawn this far above its height, so it shows over the collision. */
const LIFT = 1.5;

export class WalkableScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(50, 1, 1, 20000);
  private readonly controls: OrbitControls;
  private readonly resize: ResizeObserver;
  private readonly content = new Group();
  private readonly byKind = new Map<FaceKind, Group>();
  private visual: Group | null = null;
  private walkable: Group | null = null;
  private frame = 0;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    host.appendChild(this.renderer.domElement);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener('change', () => this.redraw());
    this.scene.add(new AmbientLight(0xffffff, 1.6));
    const sun = new DirectionalLight(0xffffff, 1.4);
    sun.position.set(0.4, -0.6, 1);
    this.scene.add(sun);
    this.scene.add(this.content);
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host);
    this.fit();
  }

  setBackground(color: string): void {
    this.scene.background = new Color(color);
    this.redraw();
  }

  /** Shows a piece; the camera is reset to look at it from the south-west, above. */
  setPiece(piece: WalkablePiece): void {
    this.clear();
    const { collision } = piece;
    if (collision) {
      // one non-indexed geometry per kind, so each kind can be hidden on its own
      const sorted = new Map<FaceKind, number[]>();
      const at = (k: number): Vec3 => [
        collision.positions[k * 3]!,
        collision.positions[k * 3 + 1]!,
        collision.positions[k * 3 + 2]!,
      ];
      for (let t = 0; t < collision.indices.length; t += 3) {
        const a = at(collision.indices[t]!);
        const b = at(collision.indices[t + 1]!);
        const c = at(collision.indices[t + 2]!);
        const kind = faceKind(a, b, c);
        if (!kind) continue;
        let list = sorted.get(kind);
        if (!list) sorted.set(kind, (list = []));
        list.push(...a, ...b, ...c);
      }
      const wires = new Group();
      for (const [kind, points] of sorted) {
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
        geometry.computeVertexNormals();
        const group = new Group();
        group.add(
          new Mesh(
            geometry,
            new MeshLambertMaterial({
              color: FACE_COLORS[kind],
              side: DoubleSide,
              transparent: true,
              opacity: 0.55,
              depthWrite: false,
            }),
          ),
        );
        const wire = new LineSegments(
          new WireframeGeometry(geometry),
          new LineBasicMaterial({ color: FACE_COLORS[kind], transparent: true, opacity: 0.5 }),
        );
        group.add(wire);
        wires.add(group);
        this.byKind.set(kind, group);
      }
      this.content.add(wires);
    }
    if (piece.visual) {
      const group = new Group();
      group.add(
        new Mesh(
          piece.visual,
          new MeshLambertMaterial({
            color: '#d8d2c4',
            side: DoubleSide,
            transparent: true,
            opacity: 0.25,
            depthWrite: false,
          }),
        ),
      );
      this.visual = group;
      this.content.add(group);
    }
    this.walkable = walkableGroup(piece.rings);
    this.content.add(this.walkable);
    this.frameAll();
  }

  setLayers(layers: WalkableLayers): void {
    for (const [kind, group] of this.byKind) {
      group.visible = layers.kinds[kind];
      const wire = group.children[1];
      if (wire) wire.visible = layers.wireframe;
    }
    if (this.visual) this.visual.visible = layers.visual;
    if (this.walkable) this.walkable.visible = layers.walkable;
    this.redraw();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.controls.dispose();
    this.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private clear(): void {
    for (const child of [...this.content.children]) {
      child.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose();
        const material = (m as { material?: { dispose(): void } }).material;
        material?.dispose();
      });
      this.content.remove(child);
    }
    this.byKind.clear();
    this.visual = null;
    this.walkable = null;
  }

  private frameAll(): void {
    const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    this.content.traverse((o) => {
      const g = (o as Mesh).geometry as BufferGeometry | undefined;
      if (!g || !o.visible) return;
      g.computeBoundingBox();
      const b = g.boundingBox!;
      for (let i = 0; i < 3; i++) {
        box.min[i] = Math.min(box.min[i]!, b.min.getComponent(i));
        box.max[i] = Math.max(box.max[i]!, b.max.getComponent(i));
      }
    });
    if (!Number.isFinite(box.min[0])) return;
    const centre = [0, 1, 2].map((i) => (box.min[i]! + box.max[i]!) / 2);
    const size = Math.max(...[0, 1, 2].map((i) => box.max[i]! - box.min[i]!));
    this.controls.target.set(centre[0]!, centre[1]!, centre[2]!);
    this.camera.position.set(
      centre[0]! - size * 0.9,
      centre[1]! - size * 1.1,
      centre[2]! + size * 0.9,
    );
    this.controls.update();
    this.redraw();
  }

  private fit(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.redraw();
  }

  private redraw(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.renderer.render(this.scene, this.camera));
  }
}

/** The walkable rings as filled floors at their height, outlined; holes outlined in red. */
function walkableGroup(rings: readonly (readonly Vec3[])[]): Group {
  const group = new Group();
  const area = (r: readonly Vec3[]) =>
    r.reduce((s, p, i) => {
      const q = r[(i + 1) % r.length]!;
      return s + p[0] * q[1] - q[0] * p[1];
    }, 0) / 2;
  const outers = rings.filter((r) => area(r) > 0);
  const holes = rings.filter((r) => area(r) <= 0);
  const inside = (p: Vec3, r: readonly Vec3[]) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i]!;
      const b = r[j]!;
      if (
        a[1] > p[1] !== b[1] > p[1] &&
        p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
      )
        c = !c;
    }
    return c;
  };
  const positions: number[] = [];
  for (const outer of outers) {
    const mine = holes.filter((h) => h.length && inside(h[0]!, outer));
    const contour = outer.map((p) => new Vector2(p[0], p[1]));
    const holePts = mine.map((h) => h.map((p) => new Vector2(p[0], p[1])));
    const all = [...outer, ...mine.flat()];
    for (const tri of ShapeUtils.triangulateShape(contour, holePts))
      for (const k of tri) {
        const p = all[k]!;
        positions.push(p[0], p[1], p[2] + LIFT);
      }
  }
  const fill = new BufferGeometry();
  fill.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  group.add(
    new Mesh(
      fill,
      new MeshBasicMaterial({
        color: WALKABLE_FILL,
        side: DoubleSide,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    ),
  );
  for (const ring of rings) {
    const line = new BufferGeometry();
    line.setAttribute(
      'position',
      new Float32BufferAttribute(
        ring.flatMap((p) => [p[0], p[1], p[2] + LIFT]),
        3,
      ),
    );
    group.add(
      new LineLoop(
        line,
        new LineBasicMaterial({ color: area(ring) > 0 ? WALKABLE_LINE : HOLE_LINE }),
      ),
    );
  }
  return group;
}
