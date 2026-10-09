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
  /**
   * Occupied cells at rotation 0: x and y indexed from the min corner; z is the level relative
   * to the NIF origin's slice and spans every opening level, so a ramp or a stair occupies
   * both levels it joins.
   */
  cells: CellIndex[];
  /** NIF origin relative to the min corner of the cells; z = 0 by convention. */
  pivot: Vec3;
  /** Cells covered by each opening along its side, in piece indices, z = opening level. */
  openingCells: CellIndex[][];
  /** Z level of each opening (round(zMin / zModule)). */
  openingLevels: number[];
  /**
   * How far each opening's plane lies inside the piece's cell boundary (units; negative when
   * it sticks out). Two facing openings leave a gap of the sum of their insets.
   */
  openingInsets: number[];
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

/** Nearest multiple of `step`. */
const toStep = (v: number, step: number) => Math.round(v / step) * step + 0;

export function computeFootprint(
  g: WeldedGeometry,
  openings: Opening[],
  module: number,
  zModule: number,
  /**
   * The kit's fine step (D70), V5 step 3b: an opening off the module but on the fine step (a
   * hall rising half a level, a spacer half a module long, `ImpHall1Way64U01`,
   * `ImpHall1Way64Short01`) gets a fractional level or position instead of leaving the piece
   * out; the piece that follows sits shifted by that fraction, as the fine grid allows.
   */
  fine?: { xy: number; z: number },
): Footprint {
  const notes: string[] = [];
  /** Per axis, opening planes off the module but on the fine step: their cell, fractional. */
  const fineAxis: [boolean, boolean] = [false, false];
  const phase: [number, number] = [0, 0];
  const raw: [number[], number[]] = [[], []];
  // the grid is set by the openings at the piece's floor: a doorway higher up (a gallery on a
  // big room's wall) may sit inside the wall, off the grid (V4, NorRmBgWallSide01 by 17.5)
  const floorLevel = openings.length
    ? Math.min(...openings.map((o) => Math.round(o.zMin / zModule)))
    : 0;
  for (const axis of [0, 1] as const) {
    const onAxis = openings.filter((o) => o.axis === axis);
    const low = onAxis.filter((o) => Math.round(o.zMin / zModule) === floorLevel);
    const edgeOnGrid = [g.min[axis], g.max[axis]].some(
      (e) => Math.abs(e - Math.round(e / module) * module) <= GRID_TOL,
    );
    // only higher openings on this axis: the box edge on the grid, if any, wins over them
    const planes = (low.length || !edgeOnGrid ? onAxis : [])
      .map((o) => (low.length ? (low.includes(o) ? o.plane : NaN) : o.plane))
      .filter((p) => !Number.isNaN(p));
    const { phase: ph, ok } = gridPhase(planes, [g.min[axis], g.max[axis]], module);
    const onFine =
      !ok && !!fine && planes.every((p) => Math.abs(p - ph - toStep(p - ph, fine.xy)) <= GRID_TOL);
    if (onFine) fineAxis[axis] = true;
    else if (!ok)
      notes.push(
        `${axis === 0 ? 'X' : 'Y'} openings at ${[...new Set(planes)].join(', ')} are not on a ${module} grid`,
      );
    phase[axis] = ph;
    raw[axis] = overlappedCells(g.min[axis] - ph, g.max[axis] - ph, module);
  }
  const min: [number, number] = [raw[0][0]!, raw[1][0]!];

  const openingLevels: number[] = [];
  const openingInsets: number[] = [];
  const openingCells: CellIndex[][] = [];
  const floorZ = openings.length ? Math.min(...openings.map((o) => o.zMin)) : 0;
  // an opening between two levels is placed from the opening nearest a whole level (the one on
  // the grid: a hall going down 64 has its upper end on the grid, its lower end half a level down)
  const offset = (o: Opening) => Math.abs(o.zMin / zModule - Math.round(o.zMin / zModule));
  const ref = openings.length
    ? openings.reduce((a, b) => (offset(b) < offset(a) ? b : a))
    : undefined;
  const between = (o: Opening) => {
    const rise = (o.zMin - floorZ) / zModule;
    return Math.abs(rise - Math.round(rise)) > 1 / 3;
  };
  const onFineLevels =
    !!fine &&
    !!ref &&
    openings.some(between) &&
    openings.every((o) => {
      const r = (o.zMin - ref.zMin) / zModule;
      return Math.abs(r - toStep(r, fine.z / zModule)) * zModule <= GRID_TOL;
    });
  for (const o of openings) {
    const rise = (o.zMin - floorZ) / zModule;
    if (onFineLevels)
      openingLevels.push(
        Math.round(ref!.zMin / zModule) + toStep((o.zMin - ref!.zMin) / zModule, fine!.z / zModule),
      );
    else if (Math.abs(rise - Math.round(rise)) <= 1 / 3)
      openingLevels.push(Math.round(o.zMin / zModule));
    else {
      notes.push(
        `${o.dir} opening rise ${(o.zMin - floorZ).toFixed(0)} is an ambiguous level for z-module ${zModule}`,
      );
      openingLevels.push(Math.round(o.zMin / zModule));
    }
    const cellsOnAxis = raw[o.axis];
    // on a fine axis the opening's cell is where its plane is, a fraction of a module
    const fineCell = fineAxis[o.axis]
      ? toStep((o.plane - phase[o.axis]) / module, fine!.xy / module) - (o.sign > 0 ? 1 : 0)
      : undefined;
    const boundary =
      phase[o.axis] +
      (fineCell !== undefined
        ? fineCell + (o.sign > 0 ? 1 : 0)
        : o.sign > 0
          ? cellsOnAxis[cellsOnAxis.length - 1]! + 1
          : cellsOnAxis[0]!) *
        module;
    openingInsets.push(o.sign > 0 ? boundary - o.plane : o.plane - boundary);
    const along = overlappedCells(
      o.spanMin - phase[o.other],
      o.spanMax - phase[o.other],
      module,
    ).map((c) => c - min[o.other]);
    const across =
      fineCell !== undefined ? fineCell - min[o.axis] : o.sign > 0 ? raw[o.axis].length - 1 : 0;
    const level = openingLevels[openingLevels.length - 1]!;
    openingCells.push(
      along.map((c) => (o.axis === 0 ? [across, c, level] : [c, across, level]) as CellIndex),
    );
  }
  if (openings.length === 0) notes.push('no opening detected');

  const levels = openingLevels.length ? openingLevels : [0];
  const cells: CellIndex[] = [];
  // the whole levels between the openings (a hall rising half a level stays on its level)
  const lo = Math.ceil(Math.min(...levels) - 1e-9);
  const hi = Math.max(lo, Math.floor(Math.max(...levels) + 1e-9));
  const slices = new Set<number>();
  for (let k = lo; k <= hi; k++) slices.add(k);
  // and the half levels of its openings: placed by its other end, a hall going down 64 sits half
  // a level up, and the cell in front of each opening must still be its own (V5 step 3b)
  for (const l of levels) if (!Number.isInteger(l)) slices.add(l);
  for (const k of [...slices].sort((a, b) => a - b)) {
    for (const i of raw[0]) for (const j of raw[1]) cells.push([i - min[0], j - min[1], k]);
  }

  return {
    phase,
    cells,
    pivot: [-(phase[0] + min[0] * module), -(phase[1] + min[1] * module), 0],
    openingCells,
    openingLevels,
    openingInsets,
    fits: notes.length === 0,
    notes,
  };
}
