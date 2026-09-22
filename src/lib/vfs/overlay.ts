/**
 * Ordered overlay of Data-like folders: the first layer that has a file wins. Layers are
 * the enabled MO2 mods (highest priority first) followed by the game's own Data folder.
 * With Vortex or no manager, the overlay has a single layer.
 */
import { listFiles, tryResolveFile, type FileInfo, type FsDir, type FsFile } from '../fs/paths';
import type { Mo2Layout } from './mo2';

export interface Layer {
  name: string;
  dir: FsDir;
}

export interface ResolvedFile {
  file: FsFile;
  layer: Layer;
}

export interface OverlayFileInfo extends FileInfo {
  layer: Layer;
}

export class Overlay {
  constructor(readonly layers: readonly Layer[]) {
    if (layers.length === 0) throw new Error('overlay needs at least one layer');
  }

  /** The winning copy of a Data-relative file, or undefined when no layer has it. */
  async resolveFile(relPath: string): Promise<ResolvedFile | undefined> {
    for (const layer of this.layers) {
      const file = await tryResolveFile(layer.dir, relPath);
      if (file) return { file, layer };
    }
    return undefined;
  }

  /** Every copy of a file, winner first. Useful to show conflicts. */
  async resolveAll(relPath: string): Promise<ResolvedFile[]> {
    const out: ResolvedFile[] = [];
    for (const layer of this.layers) {
      const file = await tryResolveFile(layer.dir, relPath);
      if (file) out.push({ file, layer });
    }
    return out;
  }

  /** Files of a Data-relative directory across all layers, one entry per name (winner). */
  async listFiles(relDir = '', options: { suffix?: string } = {}): Promise<OverlayFileInfo[]> {
    const seen = new Map<string, OverlayFileInfo>();
    for (const layer of this.layers) {
      let dir: FsDir | undefined;
      try {
        dir = relDir === '' ? layer.dir : await resolveDirQuiet(layer.dir, relDir);
      } catch {
        dir = undefined;
      }
      if (!dir) continue;
      for (const info of await listFiles(dir, options)) {
        const key = info.name.toLowerCase();
        if (!seen.has(key)) seen.set(key, { ...info, layer });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}

async function resolveDirQuiet(root: FsDir, relDir: string): Promise<FsDir | undefined> {
  const { resolveDir } = await import('../fs/paths');
  try {
    return await resolveDir(root, relDir);
  } catch {
    return undefined;
  }
}

/** Layers for an MO2 layout on top of the game's Data folder. */
export function mo2Layers(layout: Mo2Layout, stockData: FsDir): Layer[] {
  const layers: Layer[] = [];
  for (const mod of layout.mods) if (mod.dir) layers.push({ name: mod.name, dir: mod.dir });
  layers.push({ name: 'Data (game)', dir: stockData });
  return layers;
}
