/**
 * One three.js geometry per model path, read once from the Data view (loose file, else the
 * winning archive) and shared by every reference that uses it. Missing or unreadable
 * meshes resolve to null so the scene can draw a marker instead.
 */
import { BufferAttribute, BufferGeometry } from 'three';
import { mergeShapes } from '../format/nif/geometry';
import { NifFile } from '../format/nif/NifFile';
import type { ArchiveIndex } from '../vfs/archiveIndex';

export class MeshCache {
  private readonly geometries = new Map<string, Promise<BufferGeometry | null>>();

  constructor(private readonly index: ArchiveIndex) {}

  get(modelPath: string): Promise<BufferGeometry | null> {
    let entry = this.geometries.get(modelPath);
    if (!entry) {
      entry = this.load(modelPath);
      this.geometries.set(modelPath, entry);
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
  }
}
