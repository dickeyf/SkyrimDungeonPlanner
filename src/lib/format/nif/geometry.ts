/** Merge a NIF's shapes into one indexed mesh in piece space (Z up, Skyrim units). */
import { applyTransform, type NifFile, type ShapeInstance } from './NifFile';

export interface MergedMesh {
  positions: Float32Array; // 3 per vertex
  indices: Uint32Array; // 3 per triangle
  /** Shape name per triangle range, for debugging. */
  ranges: { name: string; start: number; count: number; alpha: boolean }[];
  min: [number, number, number];
  max: [number, number, number];
}

export function mergeShapes(nif: NifFile, options: { skipAlpha?: boolean } = {}): MergedMesh {
  const shapes = nif.shapes().filter((s) => !(options.skipAlpha && s.block.alphaProperty !== -1));
  let vertexCount = 0;
  let indexCount = 0;
  for (const s of shapes) {
    vertexCount += s.block.vertices!.length / 3;
    indexCount += s.block.triangles!.length;
  }
  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  const ranges: MergedMesh['ranges'] = [];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let vBase = 0;
  let iBase = 0;
  for (const s of shapes) {
    const n = writeShape(s, positions, vBase, min, max);
    const tris = s.block.triangles!;
    for (let i = 0; i < tris.length; i++) indices[iBase + i] = tris[i]! + vBase;
    ranges.push({
      name: s.path,
      start: iBase,
      count: tris.length,
      alpha: s.block.alphaProperty !== -1,
    });
    vBase += n;
    iBase += tris.length;
  }
  return { positions, indices, ranges, min, max };
}

function writeShape(
  s: ShapeInstance,
  out: Float32Array,
  base: number,
  min: [number, number, number],
  max: [number, number, number],
): number {
  const v = s.block.vertices!;
  const n = v.length / 3;
  for (let i = 0; i < n; i++) {
    const [x, y, z] = applyTransform(s.world, v[i * 3]!, v[i * 3 + 1]!, v[i * 3 + 2]!);
    out[(base + i) * 3] = x;
    out[(base + i) * 3 + 1] = y;
    out[(base + i) * 3 + 2] = z;
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  }
  return n;
}
