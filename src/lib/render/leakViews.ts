/**
 * Visibility half of the deep junction check (R16): is a candidate gap visible from where the
 * player stands? The meshes around the junction are drawn front faces grey, back faces red,
 * void black; a gap showing red or black within two pixels is a visible leak. Off-screen WebGL,
 * one renderer reused for every view.
 */
import * as THREE from 'three';
import type { Vec3 } from '../catalogue/types';
import type { Gap, JunctionFrame, WorldMesh } from '../grid/leaks';

const W = 320;
const H = 240;
/** Standing points: distances from the junction plane, on each side, on the passage axis. */
const DISTANCES = [96, 192, 320];

export interface LeakViewOptions {
  /** Eye height above the junction's floor level. */
  eyeHeight: number;
}

export const DEFAULT_LEAK_VIEW_OPTIONS: LeakViewOptions = { eyeHeight: 120 };

export interface GapVisibility {
  /** Views that see the gap, over the views kept (not inside a wall). */
  seen: number;
  views: number;
}

export class LeakViewer {
  private readonly renderer = new THREE.WebGLRenderer({ antialias: false });
  private readonly front = new THREE.MeshBasicMaterial({ color: 0x808080, side: THREE.FrontSide });
  private readonly back = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.BackSide });
  private readonly pixels = new Uint8Array(W * H * 4);

  constructor() {
    this.renderer.setSize(W, H, false);
  }

  /** Visibility of each gap, the scene holding `meshes` (the junction and the tiles around it). */
  gaps(
    meshes: readonly WorldMesh[],
    frame: JunctionFrame,
    gaps: readonly Gap[],
    options: LeakViewOptions = DEFAULT_LEAK_VIEW_OPTIONS,
  ): GapVisibility[] {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    const geometries = meshes.map((m) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m.positions), 3));
      g.setIndex(new THREE.BufferAttribute(m.triangles, 1));
      scene.add(new THREE.Mesh(g, this.front), new THREE.Mesh(g, this.back));
      return g;
    });
    try {
      return gaps.map((gap) => this.look(scene, frame, gap, options));
    } finally {
      for (const g of geometries) g.dispose();
    }
  }

  private look(
    scene: THREE.Scene,
    f: JunctionFrame,
    gap: Gap,
    options: LeakViewOptions,
  ): GapVisibility {
    const camera = new THREE.PerspectiveCamera(75, W / H, 1, 20000);
    camera.up.set(0, 0, 1);
    const eyeZ = f.zMin + options.eyeHeight;
    const across = (f.uMin + f.uMax) / 2;
    const samples: Vec3[] = [gap.centre, gap.points[0]!, gap.points[gap.points.length - 1]!];
    const gl = this.renderer.getContext();
    let seen = 0;
    let views = 0;
    for (const side of [-1, 1])
      for (const distance of DISTANCES) {
        // The player stands in the middle of the passage, not in front of the gap: a gap at
        // the edge of a wide door frame would put the camera inside a narrower hall's walls.
        const along = f.plane + side * distance;
        camera.position.set(f.axis === 0 ? along : across, f.axis === 0 ? across : along, eyeZ);
        camera.lookAt(gap.centre[0], gap.centre[1], gap.centre[2]);
        camera.updateMatrixWorld();
        this.renderer.render(scene, camera);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
        if (this.kind(W >> 1, H >> 1) === 'back' && this.kind(W >> 1, H >> 2) === 'back') continue; // inside a wall
        views++;
        if (samples.some((s) => this.showsLeak(camera, s))) seen++;
      }
    return { seen, views };
  }

  private kind(x: number, y: number): 'front' | 'back' | 'void' {
    const k = (y * W + x) * 4;
    const r = this.pixels[k]!;
    if (r > 200 && this.pixels[k + 1]! < 50) return 'back';
    return r < 20 ? 'void' : 'front';
  }

  private showsLeak(camera: THREE.Camera, point: Vec3): boolean {
    const p = new THREE.Vector3(...point).project(camera);
    if (p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) return false;
    const px = Math.round(((p.x + 1) / 2) * (W - 1));
    const py = Math.round(((p.y + 1) / 2) * (H - 1));
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = px + dx;
        const y = py + dy;
        if (x >= 0 && y >= 0 && x < W && y < H && this.kind(x, y) !== 'front') return true;
      }
    return false;
  }

  dispose(): void {
    this.front.dispose();
    this.back.dispose();
    this.renderer.dispose();
  }
}
