/**
 * The NAVI record ("Navmesh Info Map", V2 step 16): one NVMI field per NavMesh, written by the
 * Creation Kit's Finalize. A plugin carries its own NAVI (an override of the master's), holding
 * the entries of the NAVMs it adds or changes. NVPP (precomputed paths) and NVSI (deleted
 * NavMeshes) stay opaque.
 *
 * NVMI layout (little-endian):
 *   navMesh u32 (FormID), flags u32 (0x20 island, 0x40 not edited), approx location f32[3],
 *   preferred % f32,
 *   edge links:           count u32, navMesh u32[count]
 *   preferred edge links: count u32, navMesh u32[count]
 *   door links:           count u32, { crc u32, door u32 }
 *   island: has u8; when 1: min f32[3], max f32[3],
 *           triangles count u32, u16[3] each; vertices count u32, f32[3] each
 *   pathing cell: crc u32, worldspace u32, then cell u32 when the worldspace is 0,
 *                 else grid y i16, grid x i16
 *
 * Reference: xEdit's TES5 definitions (wbDefinitionsTES5.pas, NAVI).
 */
import { BinaryReader } from '../../binary/BinaryReader';
import { BinaryWriter } from '../../binary/BinaryWriter';
import type { Vec3 } from '../../catalogue/types';
import type { NavParent } from './navm';

/** The CRC the CK stores before a door reference (NVNM and NVMI door links). */
export const PATHING_DOOR_CRC = 0xe48b73f3;
/** The CRC the CK stores before a pathing cell (it is NVNM's "magic"). */
export const PATHING_CELL_CRC = 0xa5e9a03c;

export const NAVI_FLAG_ISLAND = 0x20;
export const NAVI_FLAG_NOT_EDITED = 0x40;

export interface NavIsland {
  min: Vec3;
  max: Vec3;
  triangles: [number, number, number][];
  vertices: Vec3[];
}

export interface NavInfo {
  navMesh: number;
  flags: number;
  location: Vec3;
  preferred: number;
  edgeLinks: number[];
  preferredEdgeLinks: number[];
  doorLinks: { crc: number; door: number }[];
  island: NavIsland | null;
  crc: number;
  parent: NavParent;
  /** Bytes after the known layout, kept so an unknown variant writes back unchanged. */
  trailing: Uint8Array;
}

const vec3 = (r: BinaryReader): Vec3 => [r.f32(), r.f32(), r.f32()];

function count(r: BinaryReader, itemSize: number, what: string): number {
  const n = r.u32();
  if (n * itemSize > r.remaining) throw new Error(`NVMI: ${n} ${what} exceed the field`);
  return n;
}

export function decodeNvmi(data: Uint8Array): NavInfo {
  const r = new BinaryReader(data.buffer, data.byteOffset, data.byteLength);
  const navMesh = r.u32();
  const flags = r.u32();
  const location = vec3(r);
  const preferred = r.f32();
  const ids = (what: string) => {
    const out: number[] = [];
    for (let i = count(r, 4, what); i > 0; i--) out.push(r.u32());
    return out;
  };
  const edgeLinks = ids('edge links');
  const preferredEdgeLinks = ids('preferred edge links');
  const doorLinks: NavInfo['doorLinks'] = [];
  for (let i = count(r, 8, 'door links'); i > 0; i--)
    doorLinks.push({ crc: r.u32(), door: r.u32() });
  let island: NavIsland | null = null;
  if (r.u8()) {
    const min = vec3(r);
    const max = vec3(r);
    const triangles: NavIsland['triangles'] = [];
    for (let i = count(r, 6, 'island triangles'); i > 0; i--)
      triangles.push([r.u16(), r.u16(), r.u16()]);
    const vertices: Vec3[] = [];
    for (let i = count(r, 12, 'island vertices'); i > 0; i--) vertices.push(vec3(r));
    island = { min, max, triangles, vertices };
  }
  const crc = r.u32();
  const worldspace = r.u32();
  let parent: NavParent;
  if (worldspace === 0) parent = { kind: 'cell', cell: r.u32() };
  else {
    const y = r.i16();
    const x = r.i16();
    parent = { kind: 'grid', worldspace, x, y };
  }
  return {
    navMesh,
    flags,
    location,
    preferred,
    edgeLinks,
    preferredEdgeLinks,
    doorLinks,
    island,
    crc,
    parent,
    trailing: r.bytesCopy(r.remaining),
  };
}

export function encodeNvmi(info: NavInfo): Uint8Array {
  const w = new BinaryWriter(256);
  w.u32(info.navMesh).u32(info.flags);
  for (const v of info.location) w.f32(v);
  w.f32(info.preferred);
  for (const list of [info.edgeLinks, info.preferredEdgeLinks]) {
    w.u32(list.length);
    for (const id of list) w.u32(id);
  }
  w.u32(info.doorLinks.length);
  for (const d of info.doorLinks) w.u32(d.crc).u32(d.door);
  if (info.island) {
    const i = info.island;
    w.u8(1);
    for (const v of [...i.min, ...i.max]) w.f32(v);
    w.u32(i.triangles.length);
    for (const t of i.triangles) w.u16(t[0]).u16(t[1]).u16(t[2]);
    w.u32(i.vertices.length);
    for (const v of i.vertices) w.f32(v[0]).f32(v[1]).f32(v[2]);
  } else w.u8(0);
  w.u32(info.crc);
  if (info.parent.kind === 'cell') w.u32(0).u32(info.parent.cell);
  else w.u32(info.parent.worldspace).i16(info.parent.y).i16(info.parent.x);
  w.raw(info.trailing);
  return w.toUint8Array();
}
