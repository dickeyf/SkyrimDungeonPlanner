/**
 * Skyrim placements to three.js matrices. The scene keeps Skyrim's frame (Z up, X east,
 * Y north, units = game units), so only rotations need care: Skyrim angles turn clockwise
 * when seen from the positive axis (heading 90° takes north to east), the opposite of the
 * right-handed convention, and are applied X, then Y, then Z.
 */
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { Vec3 } from '../catalogue/types';

export function placementMatrix(pos: Vec3, rot: Vec3, scale = 1): Matrix4 {
  const q = new Quaternion().setFromEuler(new Euler(-rot[0], -rot[1], -rot[2], 'ZYX'));
  return new Matrix4().compose(new Vector3(...pos), q, new Vector3(scale, scale, scale));
}

/** Grid lines (pairs of points, XY plane at `z`) covering cells [i0, i1) x [j0, j1). */
export function gridLines(
  origin: Vec3,
  module: number,
  i0: number,
  i1: number,
  j0: number,
  j1: number,
): number[] {
  const out: number[] = [];
  const z = origin[2];
  for (let i = i0; i <= i1; i++) {
    const x = origin[0] + i * module;
    out.push(x, origin[1] + j0 * module, z, x, origin[1] + j1 * module, z);
  }
  for (let j = j0; j <= j1; j++) {
    const y = origin[1] + j * module;
    out.push(origin[0] + i0 * module, y, z, origin[0] + i1 * module, y, z);
  }
  return out;
}
