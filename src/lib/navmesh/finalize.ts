/**
 * Finalize, as the Creation Kit does it (V2 step 16, D65), for the NavMeshes of one interior
 * cell: door links and their NAVI entries; cover is left for later. Measured on Skyrim.esm and
 * on a plugin finalized by the CK:
 *
 * - a load door is linked to the triangle containing its arrival marker (where an actor lands
 *   when coming through it, stored in the XTEL of the door leading to it), seen from above; the
 *   triangle gets the door flag 0x400, the NavMesh a door link (triangle, PathingDoor CRC,
 *   door), the door an XNDP (NavMesh, triangle);
 * - each NavMesh has an NVMI entry: its vertices' mean as location, the NavMeshes it links to,
 *   its doors, and the cell; a NavMesh the cell's largest one cannot reach through edge links
 *   is an "island", with a copy of its geometry.
 */
import type { Vec3 } from '../catalogue/types';
import type { NavMeshData } from '../format/esp/navm';
import {
  NAVI_FLAG_ISLAND,
  PATHING_CELL_CRC,
  PATHING_DOOR_CRC,
  type NavInfo,
} from '../format/esp/navi';

export const NAV_TRIANGLE_DOOR = 0x400;

export interface FinalizeDoor {
  /** The door reference's FormID. */
  ref: number;
  pos: Vec3;
  /** Where an actor arrives through this door, when known (else the door's position). */
  arrival?: Vec3;
}

export interface FinalizeNavMesh {
  formId: number;
  nav: NavMeshData;
}

export interface FinalizeResult {
  /** The NavMeshes with their door links and door flags rebuilt, in the given order. */
  navms: NavMeshData[];
  /** Each door linked, for its XNDP. */
  links: { ref: number; navm: number; triangle: number }[];
  /** Doors no triangle was found for. */
  missed: number[];
  /** One NAVI entry per NavMesh. */
  infos: NavInfo[];
}

/** How far (plan) a door's point may be from the nearest triangle when none contains it. */
const DOOR_REACH = 128;
/** How far (height) a triangle containing the point may be from it. */
const DOOR_HEIGHT = 128;

function inside(p: Vec3, a: Vec3, b: Vec3, c: Vec3): boolean {
  const side = (u: Vec3, w: Vec3) => (w[0] - u[0]) * (p[1] - u[1]) - (w[1] - u[1]) * (p[0] - u[0]);
  const d = [side(a, b), side(b, c), side(c, a)];
  return d.every((x) => x >= 0) || d.every((x) => x <= 0);
}

function heightAt(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(det) < 1e-9) return (a[2] + b[2] + c[2]) / 3;
  const l1 = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / det;
  const l2 = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / det;
  return l1 * a[2] + l2 * b[2] + (1 - l1 - l2) * c[2];
}

/**
 * The triangle of a NavMesh for a door's point: the one containing it seen from above, the
 * nearest in height; else the one whose centre is nearest in plan, within reach. With its
 * distance (0 when contained), or undefined.
 */
export function doorTriangle(
  nav: NavMeshData,
  p: Vec3,
): { triangle: number; distance: number } | undefined {
  const V = nav.vertices;
  let best: { triangle: number; distance: number; dz: number } | undefined;
  nav.triangles.forEach((t, i) => {
    const [a, b, c] = t.vertices.map((v) => V[v]!) as [Vec3, Vec3, Vec3];
    if (inside(p, a, b, c)) {
      const dz = Math.abs(heightAt(p, a, b, c) - p[2]);
      if (dz <= DOOR_HEIGHT && (!best || best.distance > 0 || dz < best.dz))
        best = { triangle: i, distance: 0, dz };
      return;
    }
    if (best?.distance === 0) return;
    const cx = (a[0] + b[0] + c[0]) / 3;
    const cy = (a[1] + b[1] + c[1]) / 3;
    const cz = (a[2] + b[2] + c[2]) / 3;
    const d = Math.hypot(cx - p[0], cy - p[1]);
    if (d <= DOOR_REACH && Math.abs(cz - p[2]) <= DOOR_HEIGHT && (!best || d < best.distance))
      best = { triangle: i, distance: d, dz: Math.abs(cz - p[2]) };
  });
  return best && { triangle: best.triangle, distance: best.distance };
}

export function finalizeCell(
  cell: number,
  navms: readonly FinalizeNavMesh[],
  doors: readonly FinalizeDoor[],
): FinalizeResult {
  // 1. each door to the best triangle of any NavMesh of the cell
  const links: FinalizeResult['links'] = [];
  const missed: number[] = [];
  for (const door of [...doors].sort((a, b) => a.ref - b.ref)) {
    const p = door.arrival ?? door.pos;
    let best: { navm: number; triangle: number; distance: number } | undefined;
    for (const n of navms) {
      const hit = doorTriangle(n.nav, p);
      if (hit && (!best || hit.distance < best.distance)) best = { navm: n.formId, ...hit };
    }
    if (best) links.push({ ref: door.ref, navm: best.navm, triangle: best.triangle });
    else missed.push(door.ref);
  }

  // 2. door links and flags rebuilt from scratch
  const out = navms.map((n) => {
    const mine = links.filter((l) => l.navm === n.formId);
    const doorTriangles = new Set(mine.map((l) => l.triangle));
    return {
      ...n.nav,
      triangles: n.nav.triangles.map((t, i) => ({
        ...t,
        flags: doorTriangles.has(i) ? t.flags | NAV_TRIANGLE_DOOR : t.flags & ~NAV_TRIANGLE_DOOR,
      })),
      doorLinks: mine.map((l) => ({ triangle: l.triangle, crc: PATHING_DOOR_CRC, door: l.ref })),
    };
  });

  // 3. islands: what the largest NavMesh cannot reach through edge links within the cell
  const ids = navms.map((n) => n.formId);
  const reach = new Set<number>();
  if (navms.length) {
    const largest = navms.reduce((x, y) =>
      y.nav.triangles.length > x.nav.triangles.length ? y : x,
    );
    const todo = [largest.formId];
    while (todo.length) {
      const id = todo.pop()!;
      if (reach.has(id)) continue;
      reach.add(id);
      const nav = navms.find((n) => n.formId === id)!.nav;
      for (const l of nav.edgeLinks) if (ids.includes(l.navMesh)) todo.push(l.navMesh);
      // links pointing at this NavMesh count as well
      for (const n of navms) if (n.nav.edgeLinks.some((l) => l.navMesh === id)) todo.push(n.formId);
    }
  }

  const infos = out.map((nav, i): NavInfo => {
    const formId = navms[i]!.formId;
    const V = nav.vertices;
    const mean = (a: number) => (V.length ? V.reduce((s, v) => s + v[a]!, 0) / V.length : 0);
    const island = !reach.has(formId);
    const bound = (a: number, f: (...x: number[]) => number) => f(...V.map((v) => v[a]!));
    return {
      navMesh: formId,
      flags: island ? NAVI_FLAG_ISLAND : 0,
      location: [mean(0), mean(1), mean(2)],
      preferred: 0,
      edgeLinks: [...new Set(nav.edgeLinks.map((l) => l.navMesh))].sort((a, b) => a - b),
      preferredEdgeLinks: [],
      doorLinks: [...nav.doorLinks]
        .sort((a, b) => a.door - b.door)
        .map((d) => ({ crc: d.crc, door: d.door })),
      island:
        island && V.length
          ? {
              min: [bound(0, Math.min), bound(1, Math.min), bound(2, Math.min)],
              max: [bound(0, Math.max), bound(1, Math.max), bound(2, Math.max)],
              triangles: nav.triangles.map((t) => [...t.vertices]),
              vertices: V.map((v) => [v[0], v[1], v[2]]),
            }
          : null,
      crc: PATHING_CELL_CRC,
      parent: { kind: 'cell', cell },
      trailing: new Uint8Array(),
    };
  });
  return { navms: out, links, missed, infos };
}
