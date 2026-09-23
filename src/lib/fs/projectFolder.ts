/**
 * Development only: write files produced in the app (catalogue annotations) straight into
 * this repository's working copy, so they show up in `git status` without manual copying.
 * End users never see this; for them the annotations are bundled read-only at build time.
 */
import { resolveDir, readAll, tryResolveFile, writeFileAtomic, type FsDir } from './paths';

export const PROJECT_PACKAGE_NAME = 'skyrim-se-dungeon-maker';

/** True when `dir` is a checkout of this project (package.json with our name). */
export async function isProjectFolder(dir: FsDir): Promise<boolean> {
  const pkg = await tryResolveFile(dir, 'package.json');
  if (!pkg) return false;
  try {
    const json = JSON.parse(new TextDecoder().decode(await readAll(pkg))) as { name?: string };
    return json.name === PROJECT_PACKAGE_NAME;
  } catch {
    return false;
  }
}

/** Write `data/annotations/<kit>.json` in the project checkout. */
export async function writeProjectAnnotations(
  project: FsDir,
  kit: string,
  content: string,
): Promise<string> {
  const dir = await resolveDir(project, 'data/annotations', { create: true });
  const name = `${kit.toLowerCase()}.json`;
  await writeFileAtomic(dir, name, content);
  return `data/annotations/${name}`;
}
