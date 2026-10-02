/**
 * Diffuse textures for the textured view (V3 step 3, R17): one three.js texture per DDS path,
 * read once from the Data view (loose file, else the winning texture archive) and shared by
 * every mesh using it. Block-compressed data goes to the GPU as is when it supports the format
 * (S3TC for BC1 to BC3, BPTC for BC7); BC1 to BC3 are decoded in software otherwise. A missing
 * or unsupported texture resolves to null (the mesh keeps its plain colour).
 */
import {
  CompressedTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  RGBA_BPTC_Format,
  RGBA_S3TC_DXT1_Format,
  RGBA_S3TC_DXT3_Format,
  RGBA_S3TC_DXT5_Format,
  RepeatWrapping,
  SRGBColorSpace,
  type CompressedPixelFormat,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { decodeBc, parseDds, type DdsFormat, type DdsTexture } from '../format/dds/dds';
import type { ArchiveIndex } from '../vfs/archiveIndex';

/** Where a texture path of a NIF points, as an archive path (`textures/...`). */
export function textureArchivePath(path: string): string {
  const p = path
    .replace(/\\/g, '/')
    .toLowerCase()
    .replace(/^\/+/, '')
    .replace(/^data\//, '');
  return p.startsWith('textures/') ? p : `textures/${p}`;
}

export interface TextureStats {
  loaded: number;
  missing: number;
  /** Paths of the textures not found or not supported. */
  missingPaths: string[];
  /** Bytes sent to the GPU (all mip levels). */
  gpuBytes: number;
  byFormat: Record<string, number>;
  decoded: number;
}

const GPU_FORMAT: Partial<Record<DdsFormat, { format: CompressedPixelFormat; ext: string }>> = {
  BC1: { format: RGBA_S3TC_DXT1_Format, ext: 'WEBGL_compressed_texture_s3tc' },
  BC2: { format: RGBA_S3TC_DXT3_Format, ext: 'WEBGL_compressed_texture_s3tc' },
  BC3: { format: RGBA_S3TC_DXT5_Format, ext: 'WEBGL_compressed_texture_s3tc' },
  BC7: { format: RGBA_BPTC_Format, ext: 'EXT_texture_compression_bptc' },
};

export class TextureCache {
  private readonly textures = new Map<string, Promise<Texture | null>>();
  readonly stats: TextureStats = {
    loaded: 0,
    missing: 0,
    missingPaths: [],
    gpuBytes: 0,
    byFormat: {},
    decoded: 0,
  };

  constructor(
    private readonly index: ArchiveIndex,
    private readonly renderer: WebGLRenderer,
  ) {}

  get(path: string): Promise<Texture | null> {
    const key = textureArchivePath(path);
    let entry = this.textures.get(key);
    if (!entry) {
      entry = this.load(key);
      this.textures.set(key, entry);
    }
    return entry;
  }

  private async load(path: string): Promise<Texture | null> {
    try {
      const read = await this.index.read(path);
      if (!read) {
        this.stats.missing++;
        this.stats.missingPaths.push(path);
        return null;
      }
      const dds = parseDds(read.bytes);
      const texture = this.toTexture(dds);
      if (!texture) {
        this.stats.missing++;
        this.stats.missingPaths.push(path);
        return null;
      }
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
      texture.needsUpdate = true;
      this.stats.loaded++;
      this.stats.byFormat[dds.format] = (this.stats.byFormat[dds.format] ?? 0) + 1;
      return texture;
    } catch {
      this.stats.missing++;
      this.stats.missingPaths.push(path);
      return null;
    }
  }

  private toTexture(dds: DdsTexture): Texture | null {
    const gpu = GPU_FORMAT[dds.format];
    if (gpu && this.renderer.extensions.has(gpu.ext)) {
      // a compressed level must be a whole number of blocks: keep the levels down to 4 x 4
      const levels = dds.levels.filter((l) => l.width >= 4 && l.height >= 4);
      const texture = new CompressedTexture(
        levels.map((l) => ({ data: l.data, width: l.width, height: l.height })) as never,
        dds.width,
        dds.height,
        gpu.format,
      );
      texture.minFilter = levels.length > 1 ? LinearMipmapLinearFilter : LinearFilter;
      texture.magFilter = LinearFilter;
      this.stats.gpuBytes += levels.reduce((n, l) => n + l.data.byteLength, 0);
      return texture;
    }
    if (dds.format === 'BC1' || dds.format === 'BC2' || dds.format === 'BC3') {
      const top = dds.levels[0]!;
      const rgba = decodeBc(dds.format, top);
      const texture = new DataTexture(rgba, top.width, top.height, RGBAFormat);
      texture.generateMipmaps = true;
      texture.minFilter = LinearMipmapLinearFilter;
      texture.magFilter = LinearFilter;
      this.stats.decoded++;
      this.stats.gpuBytes += Math.round(rgba.byteLength * 1.33);
      return texture;
    }
    if (dds.format === 'RGBA8' || dds.format === 'BGRA8') {
      const top = dds.levels[0]!;
      const rgba = new Uint8Array(top.data);
      if (dds.format === 'BGRA8')
        for (let i = 0; i < rgba.length; i += 4) [rgba[i], rgba[i + 2]] = [rgba[i + 2]!, rgba[i]!];
      const texture = new DataTexture(rgba, top.width, top.height, RGBAFormat);
      texture.generateMipmaps = true;
      texture.minFilter = LinearMipmapLinearFilter;
      this.stats.gpuBytes += Math.round(rgba.byteLength * 1.33);
      return texture;
    }
    return null;
  }

  dispose(): void {
    for (const p of this.textures.values()) void p.then((t) => t?.dispose());
    this.textures.clear();
  }
}
