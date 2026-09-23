import { describe, expect, it } from 'vitest';
import { FakeDir, FakeFile } from './fakeFs';
import { resolveFile } from './paths';
import { isProjectFolder, writeProjectAnnotations } from './projectFolder';

const checkout = () =>
  new FakeDir('skyrim-se-dungeon-maker', {
    'package.json': JSON.stringify({ name: 'skyrim-se-dungeon-maker' }),
    data: new FakeDir('data', {
      annotations: new FakeDir('annotations', { 'imperial.json': '{}' }),
    }),
  });

describe('project folder', () => {
  it('recognizes a checkout of this project only', async () => {
    expect(await isProjectFolder(checkout())).toBe(true);
    expect(await isProjectFolder(new FakeDir('other', { 'package.json': '{"name":"x"}' }))).toBe(
      false,
    );
    expect(await isProjectFolder(new FakeDir('other', { 'package.json': 'not json' }))).toBe(false);
    expect(await isProjectFolder(new FakeDir('empty'))).toBe(false);
  });

  it('writes the annotations file in place, creating folders when missing', async () => {
    const dir = checkout();
    expect(await writeProjectAnnotations(dir, 'Imperial', '{"version":1}\n')).toBe(
      'data/annotations/imperial.json',
    );
    const file = (await resolveFile(dir, 'data/annotations/imperial.json')) as FakeFile;
    expect(new TextDecoder().decode(file.content)).toBe('{"version":1}\n');

    const bare = new FakeDir('bare');
    await writeProjectAnnotations(bare, 'Nordic', 'x');
    expect((await resolveFile(bare, 'data/annotations/nordic.json')).name).toBe('nordic.json');
  });
});
