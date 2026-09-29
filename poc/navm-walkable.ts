/**
 * V2 step 4 (R4): walkable polygons of a tile from its collision mesh, drawn from above over
 * the collision (floors light, walls dark), with the sampled walkable area and the outlines.
 */
import { kvGet } from '$lib/fs';
import type { Catalogue, Piece } from '$lib/catalogue/types';
import { modelArchivePath } from '$lib/format/esp/stat';
import { NifFile, collisionMesh, type CollisionMesh } from '$lib/format/nif';
import {
  DEFAULT_WALKABLE_OPTIONS,
  tileFrame,
  walkablePolygons,
  type TileFrame,
  type WalkableOptions,
  type WalkableResult,
} from '$lib/navmesh/walkable';
import { ArchiveIndex } from '$lib/vfs';
import { bindProfileSelect, describeView, openDataView, type DataView } from './shared/dataView';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const DEFAULT_PIECES = ['ImpHall1Way01', 'ImpLRoomCorner01', 'ImpRoomDoor01'];

let index: ArchiveIndex | null = null;
let pieces: Piece[] = [];
let module: { xy: number; z: number } | null = null;

async function useView(view: DataView): Promise<void> {
  const catalogue = await kvGet<Catalogue>('catalogue:Imperial');
  if (!catalogue) {
    $('status').textContent =
      "No analysed catalogue: open the app's Catalogue page once, then reload.";
    $('status').className = 'err';
    return;
  }
  const kit = catalogue.kits[0];
  module = kit?.module.xy && kit.module.z ? { xy: kit.module.xy, z: kit.module.z } : null;
  index = await ArchiveIndex.build(view.overlay, view.plugins);
  pieces = catalogue.pieces
    .filter((p) => p.class === 'tile')
    .sort((a, b) => a.editorId.localeCompare(b.editorId));
  $<HTMLSelectElement>('piece').innerHTML = pieces
    .map((p, i) => `<option value="${i}">${escape(p.editorId)} (${p.category})</option>`)
    .join('');
  const first = pieces.findIndex((p) => p.editorId === DEFAULT_PIECES[0]);
  if (first >= 0) $<HTMLSelectElement>('piece').value = String(first);
  $('status').textContent = `${describeView(view)} ${pieces.length} tiles in the catalogue.`;
  $('status').className = 'ok';
  $('quick').innerHTML = DEFAULT_PIECES.map(
    (id) => `<button data-piece="${escape(id)}">${escape(id)}</button>`,
  ).join('');
  bindProfileSelect($<HTMLSelectElement>('profile'), view, (next) => void useView(next));
  void show();
}

function options(): WalkableOptions {
  const num = (id: string, fallback: number) => {
    const v = Number($<HTMLInputElement>(id).value);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  const d = DEFAULT_WALKABLE_OPTIONS;
  return {
    step: num('step', d.step),
    actorRadius: num('radius', d.actorRadius),
    actorHeight: num('height', d.actorHeight),
    stepHeight: num('stepHeight', d.stepHeight),
    maxSlope: (num('slope', (d.maxSlope * 180) / Math.PI) * Math.PI) / 180,
    tolerance: num('tolerance', d.tolerance),
  };
}

async function show(): Promise<void> {
  const piece = pieces[Number($<HTMLSelectElement>('piece').value)];
  if (!piece || !index) return;
  try {
    const read = await index.read(modelArchivePath(piece.model));
    if (!read) throw new Error(`${piece.model} not found`);
    const mesh = collisionMesh(NifFile.parse(read.bytes));
    if (!mesh) throw new Error('no bhkCompressedMeshShape collision');
    const t0 = performance.now();
    const frame = module ? tileFrame(piece, module) : undefined;
    const result = walkablePolygons(mesh.positions, mesh.indices, options(), frame);
    const ms = performance.now() - t0;
    draw(mesh, result, frame);
    const verts = result.rings.reduce((n, r) => n + r.length, 0);
    const kinds = result.rings.map((r) => (signedArea(r) > 0 ? 'outer' : 'hole'));
    $('summary').textContent =
      `${piece.editorId}: ${mesh.indices.length / 3} collision triangles, ${result.rings.length} rings ` +
      `(${kinds.join(', ')}), ${verts} vertices, ${ms.toFixed(0)} ms.`;
    $('rings').textContent = result.rings
      .map(
        (r, i) =>
          `ring ${i} (${kinds[i]}), ${r.length} vertices:\n` +
          r.map((v) => `  ${v.map((c) => c.toFixed(1)).join(', ')}`).join('\n'),
      )
      .join('\n');
  } catch (error) {
    $('summary').textContent = (error as Error).message;
  }
}

function signedArea(ring: readonly (readonly number[])[]): number {
  let a = 0;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    a += p[0]! * q[1]! - q[0]! * p[1]!;
  });
  return a / 2;
}

function draw(mesh: CollisionMesh, result: WalkableResult, frame?: TileFrame): void {
  const canvas = $<HTMLCanvasElement>('view');
  const ctx = canvas.getContext('2d')!;
  const { grid } = result;
  const pos = mesh.positions;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    minX = Math.min(minX, pos[i]!);
    maxX = Math.max(maxX, pos[i]!);
    minY = Math.min(minY, pos[i + 1]!);
    maxY = Math.max(maxY, pos[i + 1]!);
    minZ = Math.min(minZ, pos[i + 2]!);
    maxZ = Math.max(maxZ, pos[i + 2]!);
  }
  const margin = 20;
  const scale = Math.min(
    (canvas.width - 2 * margin) / (maxX - minX),
    (canvas.height - 2 * margin) / (maxY - minY),
  );
  const X = (x: number) => margin + (x - minX) * scale;
  const Y = (y: number) => canvas.height - margin - (y - minY) * scale;
  ctx.fillStyle = '#15141a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Collision triangles, lowest first so floors show under walls: floors light, walls dark.
  const tris: { z: number; up: number; pts: number[][] }[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const pts = [0, 1, 2].map((k) => {
      const v = mesh.indices[t + k]! * 3;
      return [pos[v]!, pos[v + 1]!, pos[v + 2]!];
    });
    const [a, b, c] = pts as [number[], number[], number[]];
    const nz = (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
    const n = Math.hypot(
      (b[1]! - a[1]!) * (c[2]! - a[2]!) - (b[2]! - a[2]!) * (c[1]! - a[1]!),
      (b[2]! - a[2]!) * (c[0]! - a[0]!) - (b[0]! - a[0]!) * (c[2]! - a[2]!),
      nz,
    );
    tris.push({ z: Math.max(a[2]!, b[2]!, c[2]!), up: n === 0 ? 0 : nz / n, pts });
  }
  tris.sort((p, q) => p.z - q.z);
  for (const t of tris) {
    if (t.up > 0.5 && t.z > minZ + 0.5 * (maxZ - minZ)) continue; // roofs hide the inside
    ctx.beginPath();
    t.pts.forEach((p, i) => (i ? ctx.lineTo(X(p[0]!), Y(p[1]!)) : ctx.moveTo(X(p[0]!), Y(p[1]!))));
    ctx.closePath();
    ctx.fillStyle = t.up > 0.5 ? '#4a4858' : t.up < -0.2 ? '#26252e' : '#6d6a80';
    ctx.strokeStyle = '#34323d';
    ctx.fill();
    ctx.stroke();
  }

  // Walkable samples, tinted by height.
  const gx0 = frame ? frame.min[0] : minX;
  const gy0 = frame ? frame.min[1] : minY;
  const gx1 = frame ? frame.max[0] : maxX;
  const gy1 = frame ? frame.max[1] : maxY;
  const w = ((gx1 - gx0) / grid.nx) * scale;
  const h = ((gy1 - gy0) / grid.ny) * scale;
  for (let j = 0; j < grid.ny; j++)
    for (let i = 0; i < grid.nx; i++) {
      const z = grid.floor[j * grid.nx + i]!;
      if (Number.isNaN(z)) continue;
      const k = Math.max(0, Math.min(1, (z - minZ) / Math.max(1, maxZ - minZ)));
      ctx.fillStyle = `rgba(${Math.round(80 + 170 * k)}, 200, ${Math.round(120 - 80 * k)}, 0.35)`;
      ctx.fillRect(X(gx0) + i * w, Y(gy0) - (j + 1) * h, w + 0.5, h + 0.5);
    }

  // Footprint (dashed) and openings (yellow).
  if (frame) {
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#8a879a';
    ctx.strokeRect(X(gx0), Y(gy1), (gx1 - gx0) * scale, (gy1 - gy0) * scale);
    ctx.setLineDash([]);
    ctx.strokeStyle = '#e6c84a';
    ctx.lineWidth = 4;
    for (const op of frame.openings) {
      ctx.beginPath();
      ctx.moveTo(X(op.a[0]), Y(op.a[1]));
      ctx.lineTo(X(op.b[0]), Y(op.b[1]));
      ctx.stroke();
    }
    ctx.lineWidth = 1;
  }

  // Outlines and their vertices.
  for (const ring of result.rings) {
    const outer = signedArea(ring) > 0;
    ctx.beginPath();
    ring.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
    ctx.closePath();
    ctx.strokeStyle = outer ? '#6fb7ff' : '#ff7a7a';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = outer ? '#cfe6ff' : '#ffc4c4';
    for (const p of ring) ctx.fillRect(X(p[0]) - 2.5, Y(p[1]) - 2.5, 5, 5);
  }
}

$('piece').addEventListener('change', () => void show());
$('apply').addEventListener('click', () => void show());
$('scan').addEventListener('click', async () => {
  if (!index) return;
  const out = $('scan-result');
  out.hidden = false;
  const lines: string[] = [];
  let single = 0;
  let vertices = 0;
  for (const piece of pieces) {
    out.textContent = `scanning ${piece.editorId}...`;
    try {
      const read = await index.read(modelArchivePath(piece.model));
      const mesh = read ? collisionMesh(NifFile.parse(read.bytes)) : undefined;
      if (!mesh) {
        lines.push(`${piece.editorId}: no collision`);
        continue;
      }
      const frame = module ? tileFrame(piece, module) : undefined;
      const { rings } = walkablePolygons(mesh.positions, mesh.indices, options(), frame);
      const counts = rings.map((r) => `${r.length}${signedArea(r) > 0 ? '' : ' hole'}`);
      if (rings.length === 1) {
        single++;
        vertices += rings[0]!.length;
      } else lines.push(`${piece.editorId}: ${rings.length} rings [${counts.join(', ')}]`);
    } catch (error) {
      lines.push(`${piece.editorId}: ${(error as Error).message}`);
    }
  }
  out.textContent =
    `${pieces.length} tiles; ${single} with one outline (${(vertices / Math.max(1, single)).toFixed(1)} vertices on average); others:\n` +
    lines.join('\n');
});
$('quick').addEventListener('click', (event) => {
  const id = (event.target as HTMLElement).dataset.piece;
  const i = pieces.findIndex((p) => p.editorId === id);
  if (i < 0) return;
  $<HTMLSelectElement>('piece').value = String(i);
  void show();
});

const d = DEFAULT_WALKABLE_OPTIONS;
$<HTMLInputElement>('step').value = String(d.step);
$<HTMLInputElement>('radius').value = String(d.actorRadius);
$<HTMLInputElement>('height').value = String(d.actorHeight);
$<HTMLInputElement>('stepHeight').value = String(d.stepHeight);
$<HTMLInputElement>('slope').value = String(Math.round((d.maxSlope * 180) / Math.PI));
$<HTMLInputElement>('tolerance').value = String(d.tolerance);

openDataView()
  .then(useView)
  .catch((error: Error) => {
    $('status').textContent = error.message;
    $('status').className = 'err';
  });
