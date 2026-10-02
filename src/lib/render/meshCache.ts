/**
 * One three.js geometry per model path, read once from the Data view (loose file, else the
 * winning archive) and shared by every reference that uses it. Missing or unreadable
 * meshes resolve to null so the scene can draw a marker instead.
 */
import { BufferAttribute, BufferGeometry } from 'three';
import { mergeShapes, type MergedMesh } from '../format/nif/geometry';
import { NifFile } from '../format/nif/NifFile';
import { weldMesh, type WeldedGeometry } from '../mesh/geometry';
import type { ArchiveIndex } from '../vfs/archiveIndex';

/** A model for the textured view: smooth-shaded, with UVs, one group per texture range. */
export interface TexturedGeometry {
  geometry: BufferGeometry;
  /** Per group: the diffuse texture path and whether the part is alpha-tested. */
  ranges: { texture: string; alpha: boolean }[];
}

export class MeshCache {
  private readonly texturedGeometries = new Map<string, Promise<TexturedGeometry | null>>();
  private readonly geometries = new Map<string, Promise<BufferGeometry | null>>();
  private readonly weldedMeshes = new Map<string, Promise<WeldedGeometry | null>>();
  private readonly mergedMeshes = new Map<string, Promise<MergedMesh | null>>();

  constructor(private readonly index: ArchiveIndex) {}

  get(modelPath: string): Promise<BufferGeometry | null> {
    let entry = this.geometries.get(modelPath);
    if (!entry) {
      entry = this.load(modelPath);
      this.geometries.set(modelPath, entry);
    }
    return entry;
  }

  /** The merged mesh of a model with its texture coordinates, null when unreadable. */
  merged(modelPath: string): Promise<MergedMesh | null> {
    let entry = this.mergedMeshes.get(modelPath);
    if (!entry) {
      entry = this.index
        .read(modelPath)
        .then((read) => (read ? mergeShapes(NifFile.parse(read.bytes), { skipAlpha: true }) : null))
        .catch(() => null);
      this.mergedMeshes.set(modelPath, entry);
    }
    return entry;
  }

  /** The textured geometry of a model (every shape, alpha-tested ones included), or null. */
  textured(modelPath: string): Promise<TexturedGeometry | null> {
    let entry = this.texturedGeometries.get(modelPath);
    if (!entry) {
      entry = this.index
        .read(modelPath)
        .then((read) => {
          if (!read) return null;
          const mesh = mergeShapes(NifFile.parse(read.bytes));
          if (mesh.indices.length === 0) return null;
          const geometry = new BufferGeometry();
          geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
          geometry.setAttribute('uv', new BufferAttribute(mesh.uvs, 2));
          geometry.setIndex(new BufferAttribute(mesh.indices, 1));
          mesh.ranges.forEach((r, i) => geometry.addGroup(r.start, r.count, i));
          geometry.computeVertexNormals();
          geometry.computeBoundingBox();
          return {
            geometry,
            ranges: mesh.ranges.map((r) => ({ texture: r.texture, alpha: r.alpha })),
          };
        })
        .catch(() => null);
      this.texturedGeometries.set(modelPath, entry);
    }
    return entry;
  }

  /** The welded mesh of a model (for the deep junction check), null when unreadable. */
  welded(modelPath: string): Promise<WeldedGeometry | null> {
    let entry = this.weldedMeshes.get(modelPath);
    if (!entry) {
      entry = this.merged(modelPath).then((m) => (m ? weldMesh(m) : null));
      this.weldedMeshes.set(modelPath, entry);
    }
    return entry;
  }

  get size(): number {
    return this.geometries.size;
  }

  private async load(modelPath: string): Promise<BufferGeometry | null> {
    try {
      const read = await this.index.read(modelPath);
      if (!read) return null;
      const mesh = mergeShapes(NifFile.parse(read.bytes), { skipAlpha: true });
      if (mesh.indices.length === 0) return null;
      const indexed = new BufferGeometry();
      indexed.setAttribute('position', new BufferAttribute(mesh.positions, 3));
      indexed.setIndex(new BufferAttribute(mesh.indices, 1));
      // flat shading without textures: split vertices so every triangle has its own normal
      const geometry = indexed.toNonIndexed();
      indexed.dispose();
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      return geometry;
    } catch {
      return null;
    }
  }

  dispose(): void {
    for (const p of this.geometries.values()) void p.then((g) => g?.dispose());
    this.geometries.clear();
    for (const p of this.texturedGeometries.values()) void p.then((g) => g?.geometry.dispose());
    this.texturedGeometries.clear();
  }
}
