/**
 * Where a Data-relative file comes from: a loose file in the overlay wins, otherwise the
 * last archive in load order that contains it. Archive tables are read once and kept.
 */
import { readAll } from '../fs/paths';
import { BsaArchive, normalizeArchivePath, type BsaEntry } from '../format/bsa/BsaArchive';
import { FileRangeSource } from '../format/bsa/RangeSource';
import { archiveLoadOrder, type ArchiveEntry } from './archives';
import type { Overlay } from './overlay';

/** Archives that never hold meshes or plugins; skipped to save table reads. */
const SKIP = /textures|sounds|voices|interface|animations|shaders/i;

export interface ArchiveHit {
  archive: ArchiveEntry;
  bsa: BsaArchive;
  entry: BsaEntry;
}

export class ArchiveIndex {
  private readonly opened = new Map<string, Promise<BsaArchive>>();

  private constructor(
    readonly overlay: Overlay,
    readonly archives: ArchiveEntry[],
  ) {}

  static async build(overlay: Overlay, plugins: readonly string[]): Promise<ArchiveIndex> {
    const archives = (await archiveLoadOrder(overlay, plugins)).filter((a) => !SKIP.test(a.name));
    return new ArchiveIndex(overlay, archives);
  }

  open(archive: ArchiveEntry): Promise<BsaArchive> {
    let p = this.opened.get(archive.name);
    if (!p) {
      p = FileRangeSource.open(archive.file).then((source) => BsaArchive.open(source));
      this.opened.set(archive.name, p);
    }
    return p;
  }

  /** The winning archive entry for a path, searching from the last archive loaded. */
  async findInArchives(path: string): Promise<ArchiveHit | undefined> {
    const key = normalizeArchivePath(path);
    for (let i = this.archives.length - 1; i >= 0; i--) {
      const archive = this.archives[i]!;
      const bsa = await this.open(archive);
      const entry = bsa.get(key);
      if (entry) return { archive, bsa, entry };
    }
    return undefined;
  }

  /** File content: loose file first, then archives. */
  async read(path: string): Promise<{ bytes: Uint8Array; source: string } | undefined> {
    const loose = await this.overlay.resolveFile(path);
    if (loose) return { bytes: await readAll(loose.file), source: `loose: ${loose.layer.name}` };
    const hit = await this.findInArchives(path);
    if (!hit) return undefined;
    return { bytes: await hit.bsa.read(hit.entry), source: hit.archive.name };
  }
}
