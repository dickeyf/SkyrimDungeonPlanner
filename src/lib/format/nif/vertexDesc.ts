/**
 * BSVertexDesc: a u64 of 4-bit fields (offsets in 4-byte units) plus attribute flags at
 * bit 44. Nibble 0 = vertex size, 1 = dynamic size, 2 = uv1, 3 = uv2, 4 = normal,
 * 5 = tangent, 6 = color, 7 = skinning, 8 = landscape, 9 = eye data.
 */

export const VertexFlags = {
  vertex: 1 << 0,
  uvs: 1 << 1,
  uvs2: 1 << 2,
  normals: 1 << 3,
  tangents: 1 << 4,
  vertexColors: 1 << 5,
  skinned: 1 << 6,
  landData: 1 << 7,
  eyeData: 1 << 8,
  instance: 1 << 9,
  fullPrecision: 1 << 10,
} as const;

export interface VertexLayout {
  vertexSize: number;
  /** 16 (3 floats + bitangent X) or 8 (4 halfs). */
  positionBytes: 8 | 16;
  flags: number;
}

/**
 * Skyrim SE static meshes store 16-byte positions without setting FULL_PRECISION, so the
 * position size is derived from the offset of the first attribute after it.
 */
export function decodeVertexDesc(desc: bigint): VertexLayout {
  const nib = (i: number) => Number((desc >> BigInt(4 * i)) & 0xfn);
  const flags = Number((desc >> 44n) & 0x7ffn);
  const vertexSize = nib(0) * 4;
  const following: number[] = [];
  if (flags & VertexFlags.uvs && nib(2)) following.push(nib(2) * 4);
  if (flags & VertexFlags.normals && nib(4)) following.push(nib(4) * 4);
  if (flags & VertexFlags.tangents && nib(5)) following.push(nib(5) * 4);
  if (flags & VertexFlags.vertexColors && nib(6)) following.push(nib(6) * 4);
  if (flags & VertexFlags.skinned && nib(7)) following.push(nib(7) * 4);
  if (flags & VertexFlags.eyeData && nib(9)) following.push(nib(9) * 4);
  let positionBytes: number;
  if (following.length) positionBytes = Math.min(...following);
  else positionBytes = flags & VertexFlags.fullPrecision || vertexSize >= 16 ? 16 : 8;
  if (positionBytes !== 8 && positionBytes !== 16) {
    throw new Error(
      `unexpected position block size ${positionBytes} in vertex desc 0x${desc.toString(16)}`,
    );
  }
  return { vertexSize, positionBytes, flags };
}
