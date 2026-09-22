/**
 * Archive (BSA) load order. The game loads the base archives listed in Skyrim.ini, then
 * each plugin's archives (`<plugin>.bsa`, `<plugin> - Textures.bsa`) in plugin load order;
 * later archives override earlier ones, and loose files override every archive.
 */
import type { Overlay, ResolvedFile } from './overlay';

/** Default `sResourceArchiveList` + `sResourceArchiveList2` of Skyrim SE, in load order. */
export const BASE_ARCHIVES = [
  'Skyrim - Misc.bsa',
  'Skyrim - Shaders.bsa',
  'Skyrim - Interface.bsa',
  'Skyrim - Animations.bsa',
  'Skyrim - Meshes0.bsa',
  'Skyrim - Meshes1.bsa',
  'Skyrim - Sounds.bsa',
  'Skyrim - Voices_en0.bsa',
  'Skyrim - Textures0.bsa',
  'Skyrim - Textures1.bsa',
  'Skyrim - Textures2.bsa',
  'Skyrim - Textures3.bsa',
  'Skyrim - Textures4.bsa',
  'Skyrim - Textures5.bsa',
  'Skyrim - Textures6.bsa',
  'Skyrim - Textures7.bsa',
  'Skyrim - Textures8.bsa',
  'Skyrim - Patch.bsa',
] as const;

export interface ArchiveEntry extends ResolvedFile {
  name: string;
  source: 'base' | 'plugin';
  plugin?: string;
}

export function archiveNamesFor(plugin: string): string[] {
  const stem = plugin.replace(/\.(esm|esp|esl)$/i, '');
  return [`${stem}.bsa`, `${stem} - Textures.bsa`];
}

/**
 * Archives present in the overlay, in load order (last one wins). Base archives whose
 * name matches a plugin's archive are not listed twice.
 */
export async function archiveLoadOrder(
  overlay: Overlay,
  plugins: readonly string[],
): Promise<ArchiveEntry[]> {
  const out: ArchiveEntry[] = [];
  const seen = new Set<string>();
  const add = async (name: string, source: 'base' | 'plugin', plugin?: string) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    const found = await overlay.resolveFile(name);
    if (!found) return;
    seen.add(key);
    out.push({ ...found, name, source, plugin });
  };
  for (const name of BASE_ARCHIVES) await add(name, 'base');
  for (const plugin of plugins) {
    for (const name of archiveNamesFor(plugin)) await add(name, 'plugin', plugin);
  }
  return out;
}
