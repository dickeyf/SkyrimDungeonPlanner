/**
 * Footprint of a piece on the kit grid: grid phase from its openings, occupied cells from
 * its bounding box, pivot from the min corner. Port of tools/r5_module_pivots.py `analyse`
 * and tools/kit_geometry.py `grid_phase` / `overlapped_cells`, with cells normalized to start
 * at 0 (D52) and pivot Z = 0 (the NIF origin defines the Z slice, D55).
 */
import type { CellIndex, Vec3 } from '../catalogue/types';
import type { WeldedGeometry } from './geometry';
import type { Opening } from './openings';

export const GRID_TOL = 4.0;

export interface Footprint {
  /** Grid offset per horizontal axis, relative to the NIF origin, in [0, module). */
  phase: [number, number];
  /** Occupied cells at rotation 0, indexed from the min corner. */
  cells: CellIndex[];
  /** NIF origin relative to the min corner of the cells; z = 0 by convention. */
  pivot: Vec3;
  /** Cells covered by each opening along its side, in normalized piece indices. */
  openingCells: CellIndex[][];
  /** Z level of each opening (round(zMin / zModule)). */
  openingLevels: number[];
  /** All openings sit on the module grid and on integer Z levels. */
  fits: boolean;
  notes: string[];
}

/** Grid offset in [0, module) agreed by all planes, or the first edge on the grid. */
export function gridPhase(
  planes: number[],
  edges: [number, number],
  module: number,
): { phase: number; ok: boolean } {
  if (planes.length === 0) {
    const onGrid = edges.find((e) => Math.abs(e - Math.round(e / module) * module) <= GRID_TOL);
    return { phase: onGrid === undefined ? 0 : 0, ok: true };
  }
  let phase = ((planes[0]! % module) + module) % module;
  const ok = planes.every(
    (p) =>
      Math.abs(((((p - phase + module / 2) % module) + module) % module) - module / 2) <= GRID_TOL,
  );
  if (Math.abs(phase) <= GRID_TOL || Math.abs(phase - module) <= GRID_TOL) phase = 0;
  return { phase, ok };
}

/** Cells [c*m, (c+1)*m) overlapped by [lo, hi] by more than a quarter module. */
export function overlappedCells(lo: number, hi: number, module: number): number[] {
  const first = Math.floor(lo / module);
  const last = Math.floor((hi - 1e-6) / module);
  const cells: number[] = [];
  for (let c = first; c <= last; c++) {
    const overlap = Math.min(hi, (c + 1) * module) - Math.max(lo, c * module);
    if (overlap > module / 4) cells.push(c);
  }
  return cells.length ? cells : [first];
}

export function computeFootprint(
  g: WeldedGeometry,
  openings: Opening[],
  module: number,
  zModule: number,
): Footprint {
  const notes: string[] = [];
  const phase: [number, number] = [0, 0];
  const raw: [number[], number[]] = [[], []];
  for (const axis of [0, 1] as const) {
    const planes = openings.filter((o) => o.axis === axis).map((o) => o.plane);
    const { phase: ph, ok } = gridPhase(planes, [g.min[axis], g.max[axis]], module);
    if (!ok)
      notes.push(
        `${axis === 0 ? 'X' : 'Y'} openings at ${[...new Set(planes)].join(', ')} are not on a ${module} grid`,
      );
    phase[axis] = ph;
    raw[axis] = overlappedCells(g.min[axis] - ph, g.max[axis] - ph, module);
  }
  const min: [number, number] = [raw[0][0]!, raw[1][0]!];
  const cells: CellIndex[] = [];
  for (const i of raw[0]) for (const j of raw[1]) cells.push([i - min[0], j - min[1], 0]);

  const openingLevels: number[] = [];
  const openingCells: CellIndex[][] = [];
  const floorZ = openings.length ? Math.min(...openings.map((o) => o.zMin)) : 0;
  for (const o of openings) {
    const rise = (o.zMin - floorZ) / zModule;
    if (Math.abs(rise - Math.round(rise)) > 1 / 3)
      notes.push(
        `${o.dir} opening rise ${(o.zMin - floorZ).toFixed(0)} is an ambiguous level for z-module ${zModule}`,
      );
    openingLevels.push(Math.round(o.zMin / zModule));
    const along = overlappedCells(
      o.spanMin - phase[o.other],
      o.spanMax - phase[o.other],
      module,
    ).map((c) => c - min[o.other]);
    const across = o.sign > 0 ? raw[o.axis].length - 1 : 0;
    openingCells.push(
      along.map((c) => (o.axis === 0 ? [across, c, 0] : [c, across, 0]) as CellIndex),
    );
  }
  if (openings.length === 0) notes.push('no opening detected');

  return {
    phase,
    cells,
    pivot: [-(phase[0] + min[0] * module), -(phase[1] + min[1] * module), 0],
    openingCells,
    openingLevels,
    fits: notes.length === 0,
    notes,
  };
}
