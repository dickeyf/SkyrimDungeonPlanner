/**
 * Collision mesh of a Skyrim SE NIF (V2 step 4, R4): the chain
 * node.collision -> bhkCollisionObject -> bhkRigidBody[T] -> bhkMoppBvTreeShape
 * -> bhkCompressedMeshShape -> bhkCompressedMeshShapeData, decoded into triangles in piece space
 * (Skyrim units). Other shape types are not read (the Imperial tiles only use this one).
 *
 * bhkCompressedMeshShapeData stores chunks of quantized vertices (u16 steps of `error`, offset
 * by the chunk translation, then moved by one of the shared transforms), triangle strips
 * followed by plain triangles, plus "big" triangles with full-precision vertices.
 * Havok units are converted with HAVOK_SCALE.
 *
 * Reference: nif.xml (niftools).
 */
import { BinaryReader } from '../../binary/BinaryReader';
import { applyTransform, identityTransform, type NifFile, type Transform } from './NifFile';

/** Skyrim SE: game units per Havok unit. */
export const HAVOK_SCALE = 69.99125;

export interface CollisionMesh {
  /** 3 floats per vertex, piece space. */
  positions: Float32Array;
  /** 3 indices per triangle. */
  indices: Uint32Array;
  /** Havok material of each triangle (SkyrimHavokMaterial id). */
  materials: Uint32Array;
}

type Quat = [number, number, number, number]; // x, y, z, w

function rotate(q: Quat, v: [number, number, number]): [number, number, number] {
  const [x, y, z, w] = q;
  // v' = v + 2 w (q x v) + 2 q x (q x v)
  const cx = y * v[2] - z * v[1];
  const cy = z * v[0] - x * v[2];
  const cz = x * v[1] - y * v[0];
  const dx = y * cz - z * cy;
  const dy = z * cx - x * cz;
  const dz = x * cy - y * cx;
  return [v[0] + 2 * (w * cx + dx), v[1] + 2 * (w * cy + dy), v[2] + 2 * (w * cz + dz)];
}

function vec4(r: BinaryReader): [number, number, number] {
  const v: [number, number, number] = [r.f32(), r.f32(), r.f32()];
  r.f32();
  return v;
}

function reader(nif: NifFile, index: number): BinaryReader {
  const d = nif.blockData(index);
  return new BinaryReader(d.buffer, d.byteOffset, d.byteLength);
}

interface RawMesh {
  vertices: [number, number, number][];
  triangles: [number, number, number][];
  materials: number[];
}

/** Decode a bhkCompressedMeshShapeData block, in Havok units. */
export function decodeCompressedMeshData(r: BinaryReader): RawMesh {
  r.u32(); // bits per index
  r.u32(); // bits per W index
  r.u32(); // mask W index
  r.u32(); // mask index
  const error = r.f32();
  vec4(r); // bounds min
  vec4(r); // bounds max
  r.u8(); // welding type
  r.u8(); // material type
  r.skip(4 * r.u32()); // materials 32
  r.skip(4 * r.u32()); // materials 16
  r.skip(4 * r.u32()); // materials 8
  const chunkMaterials: number[] = [];
  for (let n = r.u32(); n > 0; n--) {
    chunkMaterials.push(r.u32());
    r.u32(); // havok filter
  }
  r.u32(); // named materials (none in Skyrim)
  const transforms: { t: [number, number, number]; q: Quat }[] = [];
  for (let n = r.u32(); n > 0; n--) {
    const t = vec4(r);
    const q: Quat = [r.f32(), r.f32(), r.f32(), r.f32()];
    transforms.push({ t, q });
  }
  const bigVerts: [number, number, number][] = [];
  for (let n = r.u32(); n > 0; n--) bigVerts.push(vec4(r));
  const bigTris: { v: [number, number, number]; material: number }[] = [];
  for (let n = r.u32(); n > 0; n--) {
    const v: [number, number, number] = [r.u16(), r.u16(), r.u16()];
    const material = r.u32();
    r.u16(); // welding info
    bigTris.push({ v, material });
  }

  const out: RawMesh = { vertices: [], triangles: [], materials: [] };
  for (let n = r.u32(); n > 0; n--) {
    const translation = vec4(r);
    const materialIndex = r.u32();
    r.u16(); // reference
    const transformIndex = r.u16();
    const coords: number[] = [];
    for (let k = r.u32(); k > 0; k--) coords.push(r.u16());
    const indices: number[] = [];
    for (let k = r.u32(); k > 0; k--) indices.push(r.u16());
    const strips: number[] = [];
    for (let k = r.u32(); k > 0; k--) strips.push(r.u16());
    r.skip(2 * r.u32()); // welding info

    const transform = transforms[transformIndex] ?? { t: [0, 0, 0], q: [0, 0, 0, 1] as Quat };
    const base = out.vertices.length;
    for (let k = 0; k + 2 < coords.length; k += 3) {
      const local = rotate(transform.q, [
        translation[0] + coords[k]! * error,
        translation[1] + coords[k + 1]! * error,
        translation[2] + coords[k + 2]! * error,
      ]);
      out.vertices.push([
        local[0] + transform.t[0],
        local[1] + transform.t[1],
        local[2] + transform.t[2],
      ]);
    }
    const material = chunkMaterials[materialIndex] ?? 0;
    const push = (a: number, b: number, c: number) => {
      if (a === b || b === c || a === c) return; // degenerate strip joints
      out.triangles.push([base + a, base + b, base + c]);
      out.materials.push(material);
    };
    let at = 0;
    for (const length of strips) {
      for (let k = 0; k + 2 < length; k++) {
        const a = indices[at + k]!;
        const b = indices[at + k + 1]!;
        const c = indices[at + k + 2]!;
        if (k % 2 === 0) push(a, b, c);
        else push(a, c, b);
      }
      at += length;
    }
    for (; at + 2 < indices.length; at += 3) push(indices[at]!, indices[at + 1]!, indices[at + 2]!);
  }

  const bigBase = out.vertices.length;
  out.vertices.push(...bigVerts);
  for (const t of bigTris) {
    out.triangles.push([bigBase + t.v[0], bigBase + t.v[1], bigBase + t.v[2]]);
    out.materials.push(t.material);
  }
  return out;
}

/**
 * The collision mesh attached to the NIF's root node, in piece space; undefined when the root
 * has no collision or uses a shape type this reader does not decode.
 */
export function collisionMesh(nif: NifFile): CollisionMesh | undefined {
  const root = nif.blocks[nif.roots[0] ?? -1];
  if (!root || root.collision < 0) return undefined;
  const object = reader(nif, root.collision);
  object.i32(); // target
  object.u16(); // flags
  const bodyIndex = object.i32();
  const body = nif.blocks[bodyIndex];
  if (!body?.type.startsWith('bhkRigidBody')) return undefined;

  const b = reader(nif, bodyIndex);
  let shapeIndex = b.i32();
  // bhkRigidBodyT: translation (vector4) at byte 52, rotation (quaternion x y z w) at byte 68.
  b.seek(52);
  const bodyT = vec4(b);
  const bodyQ: Quat = [b.f32(), b.f32(), b.f32(), b.f32()];
  const moved = body.type === 'bhkRigidBodyT';

  let scale: [number, number, number] = [1, 1, 1];
  let dataIndex = -1;
  for (let guard = 0; guard < 4 && dataIndex < 0; guard++) {
    const shape = nif.blocks[shapeIndex];
    if (!shape) return undefined;
    const s = reader(nif, shapeIndex);
    if (shape.type === 'bhkMoppBvTreeShape') shapeIndex = s.i32();
    else if (shape.type === 'bhkCompressedMeshShape') {
      s.seek(16);
      scale = vec4(s);
      s.seek(52);
      dataIndex = s.i32();
    } else return undefined;
  }
  if (nif.blocks[dataIndex]?.type !== 'bhkCompressedMeshShapeData') return undefined;

  const raw = decodeCompressedMeshData(reader(nif, dataIndex));
  const world: Transform = root.transform ?? identityTransform();
  const positions = new Float32Array(raw.vertices.length * 3);
  raw.vertices.forEach((v, i) => {
    let p: [number, number, number] = [v[0] * scale[0], v[1] * scale[1], v[2] * scale[2]];
    if (moved) {
      const q = rotate(bodyQ, p);
      p = [q[0] + bodyT[0], q[1] + bodyT[1], q[2] + bodyT[2]];
    }
    const [x, y, z] = applyTransform(
      world,
      p[0] * HAVOK_SCALE,
      p[1] * HAVOK_SCALE,
      p[2] * HAVOK_SCALE,
    );
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  });
  return {
    positions,
    indices: new Uint32Array(raw.triangles.flat()),
    materials: new Uint32Array(raw.materials),
  };
}
