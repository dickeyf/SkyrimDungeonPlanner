/**
 * Targeted NIF reader for Skyrim SE (Gamebryo 20.2.0.7, user version 12, BS version 100).
 * Port of tools/nif.py.
 *
 * Reads the node tree (any NiNode-derived block) with transforms and BSTriShape geometry
 * (positions, triangles). Every other block is skipped with the per-block size from the
 * header. Reference: nif.xml (niftools).
 */
import { BinaryReader } from '../../binary/BinaryReader';
import { decodeVertexDesc } from './vertexDesc';

export const NIF_VERSION = 0x14020007;
export const NIF_USER_VERSION = 12;
export const NIF_BS_VERSION = 100;

/** Column-major 3x3 rotation, translation and uniform scale: p' = R p s + t. */
export interface Transform {
  rotation: Float64Array; // 9 values, row-major (m[row*3+col])
  translation: Float64Array; // 3
  scale: number;
}

export interface NifBlock {
  index: number;
  type: string;
  name: string;
  transform: Transform;
  children: number[];
  collision: number;
  shaderProperty: number;
  alphaProperty: number;
  /** BSTriShape only: local positions, 3 floats per vertex. */
  vertices?: Float32Array;
  /** BSTriShape only: 3 indices per triangle. */
  triangles?: Uint16Array;
  vertexFlags?: number;
}

export interface ShapeInstance {
  block: NifBlock;
  world: Transform;
  path: string;
}

export function identityTransform(): Transform {
  return {
    rotation: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    translation: new Float64Array(3),
    scale: 1,
  };
}

export function applyTransform(
  t: Transform,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const r = t.rotation;
  return [
    (r[0]! * x + r[1]! * y + r[2]! * z) * t.scale + t.translation[0]!,
    (r[3]! * x + r[4]! * y + r[5]! * z) * t.scale + t.translation[1]!,
    (r[6]! * x + r[7]! * y + r[8]! * z) * t.scale + t.translation[2]!,
  ];
}

/** Transform mapping child-local coordinates into the parent's parent space. */
export function composeTransforms(parent: Transform, child: Transform): Transform {
  const a = parent.rotation;
  const b = child.rotation;
  const rotation = new Float64Array(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      rotation[row * 3 + col] =
        a[row * 3]! * b[col]! + a[row * 3 + 1]! * b[3 + col]! + a[row * 3 + 2]! * b[6 + col]!;
    }
  }
  const t = applyTransform(
    parent,
    child.translation[0]!,
    child.translation[1]!,
    child.translation[2]!,
  );
  return { rotation, translation: new Float64Array(t), scale: parent.scale * child.scale };
}

export class NifFile {
  readonly blockTypes: string[] = [];
  readonly strings: string[] = [];
  readonly blocks: NifBlock[] = [];
  readonly roots: number[] = [];

  private constructor(private readonly data: Uint8Array) {
    this.parse();
  }

  static parse(data: Uint8Array): NifFile {
    return new NifFile(data);
  }

  private parse(): void {
    const r = new BinaryReader(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    const headerLine = readLine(r);
    if (!headerLine.startsWith('Gamebryo File Format, Version 20.2.0.7')) {
      throw new Error(`unsupported NIF header: ${JSON.stringify(headerLine)}`);
    }
    const version = r.u32();
    const endian = r.u8();
    const userVersion = r.u32();
    const numBlocks = r.u32();
    const bsVersion = r.u32();
    if (
      version !== NIF_VERSION ||
      endian !== 1 ||
      userVersion !== NIF_USER_VERSION ||
      bsVersion !== NIF_BS_VERSION
    ) {
      throw new Error(
        `unsupported NIF variant: version=0x${version.toString(16)} endian=${endian} user=${userVersion} bs=${bsVersion}`,
      );
    }
    exportString(r); // author
    exportString(r); // process script
    exportString(r); // export script

    const numBlockTypes = r.u16();
    for (let i = 0; i < numBlockTypes; i++) this.blockTypes.push(r.sizedString());
    const typeIndex: number[] = [];
    for (let i = 0; i < numBlocks; i++) typeIndex.push(r.u16());
    const blockSizes: number[] = [];
    for (let i = 0; i < numBlocks; i++) blockSizes.push(r.u32());
    const numStrings = r.u32();
    r.u32(); // max string length
    for (let i = 0; i < numStrings; i++) this.strings.push(r.sizedString());
    const numGroups = r.u32();
    r.skip(4 * numGroups);

    for (let i = 0; i < numBlocks; i++) {
      const start = r.position;
      const type = this.blockTypes[typeIndex[i]!] ?? '';
      const block: NifBlock = {
        index: i,
        type,
        name: '',
        transform: identityTransform(),
        children: [],
        collision: -1,
        shaderProperty: -1,
        alphaProperty: -1,
      };
      if (type.endsWith('Node')) this.parseNode(r, block);
      else if (type === 'BSTriShape') this.parseTriShape(r, block);
      this.blocks.push(block);
      r.seek(start + blockSizes[i]!); // authoritative; skips unparsed tails
    }

    const numRoots = r.u32();
    for (let i = 0; i < numRoots; i++) this.roots.push(r.i32());
  }

  private string(index: number): string {
    return this.strings[index] ?? '';
  }

  private parseAvObject(r: BinaryReader, block: NifBlock): void {
    block.name = this.string(r.i32());
    const numExtra = r.u32();
    r.skip(4 * numExtra);
    r.i32(); // controller
    r.u32(); // flags (32-bit for BS version > 26)
    const translation = new Float64Array([r.f32(), r.f32(), r.f32()]);
    // Stored column by column: m11 m21 m31 m12 m22 m32 m13 m23 m33
    const m = [r.f32(), r.f32(), r.f32(), r.f32(), r.f32(), r.f32(), r.f32(), r.f32(), r.f32()];
    const rotation = new Float64Array([
      m[0]!,
      m[3]!,
      m[6]!,
      m[1]!,
      m[4]!,
      m[7]!,
      m[2]!,
      m[5]!,
      m[8]!,
    ]);
    const scale = r.f32();
    block.transform = { rotation, translation, scale };
    block.collision = r.i32();
  }

  private parseNode(r: BinaryReader, block: NifBlock): void {
    this.parseAvObject(r, block);
    const numChildren = r.u32();
    for (let i = 0; i < numChildren; i++) block.children.push(r.i32());
    // Effects follow; derived-type fields after that are skipped via the block size.
  }

  private parseTriShape(r: BinaryReader, block: NifBlock): void {
    this.parseAvObject(r, block);
    r.skip(16); // bounding sphere
    r.i32(); // skin
    block.shaderProperty = r.i32();
    block.alphaProperty = r.i32();
    const desc = r.u64();
    const { vertexSize, positionBytes, flags } = decodeVertexDesc(desc);
    const numTriangles = r.u16();
    const numVertices = r.u16();
    const dataSize = r.u32();
    block.vertexFlags = flags;
    block.vertices = new Float32Array(numVertices * 3);
    block.triangles = new Uint16Array(numTriangles * 3);
    if (dataSize === 0 || numVertices === 0) return;

    const base = r.position;
    const view = r.view;
    for (let v = 0; v < numVertices; v++) {
      const at = base + v * vertexSize;
      if (positionBytes === 16) {
        block.vertices[v * 3] = view.getFloat32(at, true);
        block.vertices[v * 3 + 1] = view.getFloat32(at + 4, true);
        block.vertices[v * 3 + 2] = view.getFloat32(at + 8, true);
      } else {
        block.vertices[v * 3] = halfToFloat(view.getUint16(at, true));
        block.vertices[v * 3 + 1] = halfToFloat(view.getUint16(at + 2, true));
        block.vertices[v * 3 + 2] = halfToFloat(view.getUint16(at + 4, true));
      }
    }
    r.skip(numVertices * vertexSize);
    for (let t = 0; t < numTriangles * 3; t++) block.triangles[t] = r.u16();
  }

  /** All BSTriShape blocks reachable from the roots, with their accumulated transforms. */
  shapes(): ShapeInstance[] {
    const out: ShapeInstance[] = [];
    const visit = (ref: number, parent: Transform, path: string): void => {
      const block = this.blocks[ref];
      if (!block) return;
      const world = composeTransforms(parent, block.transform);
      const here = path ? `${path}/${block.name}` : block.name;
      if (block.type === 'BSTriShape' && block.vertices) out.push({ block, world, path: here });
      for (const child of block.children) visit(child, world, here);
    };
    for (const root of this.roots) visit(root, identityTransform(), '');
    return out;
  }
}

function readLine(r: BinaryReader): string {
  const bytes: number[] = [];
  for (;;) {
    const b = r.u8();
    if (b === 0x0a) break;
    bytes.push(b);
  }
  return String.fromCharCode(...bytes);
}

function exportString(r: BinaryReader): string {
  const n = r.u8();
  return r.fixedString(n);
}

export function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exponent = (h >> 10) & 0x1f;
  const fraction = h & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}
