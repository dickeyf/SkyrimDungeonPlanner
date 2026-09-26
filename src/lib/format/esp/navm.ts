/**
 * NAVM records: the NavMesh geometry stored in the `NVNM` field (Skyrim SE, version 12).
 * Other NAVM fields (ONAM, PNAM, NNAM...) stay opaque.
 *
 * NVNM layout (little-endian):
 *   version u32, magic u32,
 *   parent: worldspace u32, then cell u32 when the worldspace is 0 (interior),
 *           else grid y i16, grid x i16,
 *   vertices:     count u32, { x f32, y f32, z f32 }
 *   triangles:    count u32, { vertices i16[3], edges i16[3], flags u16, coverFlags u16 }
 *   edge links:   count u32, { type u32, navMesh u32, triangle i16 }
 *   door links:   count u32, { triangle i16, crc u32, door u32 }
 *   cover:        count u32, { triangle i16 }
 *   search grid:  divisor u32, maxDistanceX f32, maxDistanceY f32, min f32[3], max f32[3],
 *                 divisor * divisor cells of { count u32, triangle i16[count] }
 *
 * An edge that is not linked holds -1. Any bytes left after the grid are kept as `trailing`
 * so an unknown variant still writes back unchanged (and a round trip check can flag it).
 *
 * Reference: xEdit's TES5 definitions, https://en.uesp.net/wiki/Skyrim_Mod:Mod_File_Format/NAVM
 */
import { BinaryReader } from '../../binary/BinaryReader';
import { BinaryWriter } from '../../binary/BinaryWriter';
import type { Vec3 } from '../../catalogue/types';
import type { EspRecord } from './records';
import { findSubrecord, recordSubrecords } from './subrecords';

export const NAVM_VERSION = 12;
export const NAVM_MAGIC = 0xa5e9a03c;

export type NavParent =
  { kind: 'cell'; cell: number } | { kind: 'grid'; worldspace: number; x: number; y: number };

export interface NavTriangle {
  vertices: [number, number, number];
  /** Neighbour triangle across edges 0-1, 1-2 and 2-0, or -1; an edge link index when the edge is external. */
  edges: [number, number, number];
  flags: number;
  coverFlags: number;
}

export interface NavEdgeLink {
  type: number;
  navMesh: number;
  triangle: number;
}

export interface NavDoorLink {
  triangle: number;
  crc: number;
  door: number;
}

export interface NavSearchGrid {
  divisor: number;
  maxDistanceX: number;
  maxDistanceY: number;
  min: Vec3;
  max: Vec3;
  /** divisor * divisor cells, row-major, each the triangles it overlaps. */
  cells: number[][];
}

export interface NavMeshData {
  version: number;
  magic: number;
  parent: NavParent;
  vertices: Vec3[];
  triangles: NavTriangle[];
  edgeLinks: NavEdgeLink[];
  doorLinks: NavDoorLink[];
  cover: number[];
  grid: NavSearchGrid;
  trailing: Uint8Array;
}

function vec3(r: BinaryReader): Vec3 {
  return [r.f32(), r.f32(), r.f32()];
}

function count(r: BinaryReader, itemSize: number, what: string): number {
  const n = r.u32();
  if (n * itemSize > r.remaining) throw new Error(`NVNM: ${n} ${what} exceed the field`);
  return n;
}

export function decodeNvnm(data: Uint8Array): NavMeshData {
  const r = new BinaryReader(data.buffer, data.byteOffset, data.byteLength);
  const version = r.u32();
  const magic = r.u32();
  const worldspace = r.u32();
  let parent: NavParent;
  if (worldspace === 0) {
    parent = { kind: 'cell', cell: r.u32() };
  } else {
    const y = r.i16();
    const x = r.i16();
    parent = { kind: 'grid', worldspace, x, y };
  }

  const vertices: Vec3[] = [];
  for (let i = count(r, 12, 'vertices'); i > 0; i--) vertices.push(vec3(r));

  const triangles: NavTriangle[] = [];
  for (let i = count(r, 16, 'triangles'); i > 0; i--) {
    triangles.push({
      vertices: [r.i16(), r.i16(), r.i16()],
      edges: [r.i16(), r.i16(), r.i16()],
      flags: r.u16(),
      coverFlags: r.u16(),
    });
  }

  const edgeLinks: NavEdgeLink[] = [];
  for (let i = count(r, 10, 'edge links'); i > 0; i--)
    edgeLinks.push({ type: r.u32(), navMesh: r.u32(), triangle: r.i16() });

  const doorLinks: NavDoorLink[] = [];
  for (let i = count(r, 10, 'door links'); i > 0; i--)
    doorLinks.push({ triangle: r.i16(), crc: r.u32(), door: r.u32() });

  const cover: number[] = [];
  for (let i = count(r, 2, 'cover triangles'); i > 0; i--) cover.push(r.i16());

  const divisor = r.u32();
  const maxDistanceX = r.f32();
  const maxDistanceY = r.f32();
  const min = vec3(r);
  const max = vec3(r);
  const cells: number[][] = [];
  for (let c = divisor * divisor; c > 0; c--) {
    const cell: number[] = [];
    for (let i = count(r, 2, 'grid triangles'); i > 0; i--) cell.push(r.i16());
    cells.push(cell);
  }

  return {
    version,
    magic,
    parent,
    vertices,
    triangles,
    edgeLinks,
    doorLinks,
    cover,
    grid: { divisor, maxDistanceX, maxDistanceY, min, max, cells },
    trailing: r.bytesCopy(r.remaining),
  };
}

export function encodeNvnm(nav: NavMeshData): Uint8Array {
  const w = new BinaryWriter(1024);
  w.u32(nav.version).u32(nav.magic);
  if (nav.parent.kind === 'cell') w.u32(0).u32(nav.parent.cell);
  else w.u32(nav.parent.worldspace).i16(nav.parent.y).i16(nav.parent.x);

  w.u32(nav.vertices.length);
  for (const v of nav.vertices) w.f32(v[0]).f32(v[1]).f32(v[2]);

  w.u32(nav.triangles.length);
  for (const t of nav.triangles) {
    for (const v of t.vertices) w.i16(v);
    for (const e of t.edges) w.i16(e);
    w.u16(t.flags).u16(t.coverFlags);
  }

  w.u32(nav.edgeLinks.length);
  for (const l of nav.edgeLinks) w.u32(l.type).u32(l.navMesh).i16(l.triangle);

  w.u32(nav.doorLinks.length);
  for (const d of nav.doorLinks) w.i16(d.triangle).u32(d.crc).u32(d.door);

  w.u32(nav.cover.length);
  for (const c of nav.cover) w.i16(c);

  const g = nav.grid;
  if (g.cells.length !== g.divisor * g.divisor)
    throw new Error(`NVNM: grid has ${g.cells.length} cells, divisor ${g.divisor}`);
  w.u32(g.divisor).f32(g.maxDistanceX).f32(g.maxDistanceY);
  for (const v of [...g.min, ...g.max]) w.f32(v);
  for (const cell of g.cells) {
    w.u32(cell.length);
    for (const t of cell) w.i16(t);
  }

  w.raw(nav.trailing);
  return w.toUint8Array();
}

/** The NavMesh of a NAVM record, or undefined when it has no NVNM field. */
export async function decodeNavm(record: EspRecord): Promise<NavMeshData | undefined> {
  const nvnm = findSubrecord(await recordSubrecords(record), 'NVNM');
  return nvnm ? decodeNvnm(nvnm.data) : undefined;
}
