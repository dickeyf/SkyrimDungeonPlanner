/**
 * Mod Organizer 2 instance reading (D50, R15).
 *
 * The browser sees the real disk, not MO2's virtual file system, so the tool rebuilds the
 * overlay itself: `profiles/<profile>/modlist.txt` gives the enabled mods and their
 * priority, `mods/<name>/` holds each mod's Data-relative files, and the profile's
 * `plugins.txt` / `loadorder.txt` give the plugin load order (which also orders archives).
 *
 * modlist.txt is written with the HIGHEST priority mod first, i.e. the first listed mod
 * wins conflicts (verified against MO2's left pane with poc/r15-mo2.html).
 */
import { findEntry, readAll, type FsDir } from '../fs/paths';

export interface ModlistEntry {
  name: string;
  enabled: boolean;
  /** `*` entries are unmanaged (official DLC left in the game's Data folder). */
  managed: boolean;
  separator: boolean;
}

export interface PluginEntry {
  name: string;
  enabled: boolean;
}

export interface Mo2Mod {
  name: string;
  /** Missing when the mod folder was not found under `mods/`. */
  dir?: FsDir;
}

export interface Mo2Layout {
  instance: FsDir;
  modsDir: FsDir;
  profile: { name: string; dir: FsDir };
  /** Enabled, managed mods, highest priority first (the first one wins conflicts). */
  mods: Mo2Mod[];
  /** Enabled plugins in load order. */
  plugins: string[];
  warnings: string[];
}

const decoder = new TextDecoder('utf-8');

export function parseModlist(text: string): ModlistEntry[] {
  const out: ModlistEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const flag = line[0]!;
    const name = line.slice(1);
    if (flag !== '+' && flag !== '-' && flag !== '*') continue;
    out.push({
      name,
      enabled: flag !== '-',
      managed: flag !== '*',
      separator: name.endsWith('_separator'),
    });
  }
  return out;
}

/** `plugins.txt` (Skyrim SE: `*` prefix = enabled) or `loadorder.txt` (all enabled). */
export function parsePluginList(text: string, allEnabled = false): PluginEntry[] {
  const out: PluginEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('*')) out.push({ name: line.slice(1), enabled: true });
    else out.push({ name: line, enabled: allEnabled });
  }
  return out;
}

/** Minimal INI lookup; MO2 wraps some values as `@ByteArray(value)`. */
export function iniValue(text: string, section: string, key: string): string | undefined {
  let current = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      current = header[1]!.toLowerCase();
      continue;
    }
    if (current !== section.toLowerCase()) continue;
    const eq = line.indexOf('=');
    if (eq === -1 || line.slice(0, eq).trim().toLowerCase() !== key.toLowerCase()) continue;
    const value = line.slice(eq + 1).trim();
    const wrapped = /^@ByteArray\((.*)\)$/.exec(value);
    return wrapped ? wrapped[1]! : value;
  }
  return undefined;
}

export async function isMo2Instance(dir: FsDir): Promise<boolean> {
  const mods = await findEntry(dir, 'mods');
  const profiles = await findEntry(dir, 'profiles');
  return mods?.kind === 'directory' && profiles?.kind === 'directory';
}

export async function listProfiles(instance: FsDir): Promise<string[]> {
  const profiles = await findEntry(instance, 'profiles');
  if (profiles?.kind !== 'directory') return [];
  const names: string[] = [];
  for await (const entry of profiles.values())
    if (entry.kind === 'directory') names.push(entry.name);
  return names.sort((a, b) => a.localeCompare(b));
}

async function readText(dir: FsDir, name: string): Promise<string | undefined> {
  const entry = await findEntry(dir, name);
  return entry?.kind === 'file' ? decoder.decode(await readAll(entry)) : undefined;
}

export async function loadMo2Instance(instance: FsDir, profileName?: string): Promise<Mo2Layout> {
  const warnings: string[] = [];
  const modsDir = await findEntry(instance, 'mods');
  const profilesDir = await findEntry(instance, 'profiles');
  if (modsDir?.kind !== 'directory' || profilesDir?.kind !== 'directory') {
    throw new Error(`"${instance.name}" is not an MO2 instance (needs mods/ and profiles/)`);
  }

  let selected = profileName;
  if (!selected) {
    const ini = await readText(instance, 'ModOrganizer.ini');
    selected = ini ? iniValue(ini, 'General', 'selected_profile') : undefined;
  }
  const available = await listProfiles(instance);
  if (!selected || !available.some((p) => p.toLowerCase() === selected!.toLowerCase())) {
    if (selected) warnings.push(`profile "${selected}" not found; using "${available[0]}"`);
    selected = available[0];
  }
  if (!selected) throw new Error('no profile under profiles/');
  const profileDir = (await findEntry(profilesDir, selected)) as FsDir;

  const modlistText = await readText(profileDir, 'modlist.txt');
  if (modlistText === undefined) throw new Error(`profiles/${selected}/modlist.txt not found`);
  const mods: Mo2Mod[] = [];
  for (const entry of parseModlist(modlistText)) {
    if (!entry.enabled || !entry.managed || entry.separator) continue;
    const dir = await findEntry(modsDir, entry.name);
    if (dir?.kind === 'directory') mods.push({ name: entry.name, dir });
    else {
      mods.push({ name: entry.name });
      warnings.push(`mod folder missing: mods/${entry.name}`);
    }
  }

  let plugins: string[] = [];
  const pluginsText = await readText(profileDir, 'plugins.txt');
  const loadorderText = await readText(profileDir, 'loadorder.txt');
  if (loadorderText !== undefined) {
    const enabled = new Set(
      pluginsText === undefined
        ? undefined
        : parsePluginList(pluginsText)
            .filter((p) => p.enabled)
            .map((p) => p.name.toLowerCase()),
    );
    plugins = parsePluginList(loadorderText, true)
      .map((p) => p.name)
      .filter((name) => pluginsText === undefined || enabled.has(name.toLowerCase()));
  } else if (pluginsText !== undefined) {
    plugins = parsePluginList(pluginsText)
      .filter((p) => p.enabled)
      .map((p) => p.name);
  } else {
    warnings.push('no plugins.txt / loadorder.txt in the profile');
  }

  return {
    instance,
    modsDir,
    profile: { name: selected, dir: profileDir },
    mods,
    plugins,
    warnings,
  };
}
