import { describe, expect, it } from 'vitest';
import { FakeDir, FakeFile } from './fakeFs';
import { identifyGameFolder, listArchives } from './gameRoot';
import { listFiles, readRange, resolveDir, resolveFile, splitPath, writeFileAtomic } from './paths';

const BSA_HEADER = new Uint8Array([0x42, 0x53, 0x41, 0x00, 0x69, 0x00, 0x00, 0x00, 0x24, 0, 0, 0]); // "BSA\0", v105, 36

function gameRoot(): FakeDir {
  return new FakeDir('Skyrim Special Edition', {
    'SkyrimSE.exe': new Uint8Array([0x4d, 0x5a]),
    Data: new FakeDir('Data', {
      'Skyrim.esm': 'TES4',
      'Skyrim - Meshes0.bsa': BSA_HEADER,
      'Skyrim - Textures0.bsa': BSA_HEADER,
      'MyDungeon.esp': 'TES4',
      meshes: new FakeDir('meshes', { readme: 'loose files win over archives' }),
    }),
  });
}

describe('splitPath', () => {
  it('accepts both separators and drops empty parts', () => {
    expect(splitPath('Data\\meshes/dungeons//imperial\\x.nif')).toEqual([
      'Data',
      'meshes',
      'dungeons',
      'imperial',
      'x.nif',
    ]);
    expect(splitPath('./Data/')).toEqual(['Data']);
  });

  it('refuses parent references', () => {
    expect(() => splitPath('Data/../secret')).toThrow('..');
  });
});

describe('resolve', () => {
  it('walks directories case-insensitively', async () => {
    const root = gameRoot();
    const file = await resolveFile(root, 'data\\SKYRIM - meshes0.BSA');
    expect(file.name).toBe('Skyrim - Meshes0.bsa');
    const dir = await resolveDir(root, 'Data/Meshes');
    expect(dir.name).toBe('meshes');
  });

  it('reports the missing part', async () => {
    await expect(resolveFile(gameRoot(), 'Data/textures/x.dds')).rejects.toThrow('at "textures"');
    await expect(resolveFile(gameRoot(), 'Data/missing.esp')).rejects.toThrow('file not found');
  });

  it('creates intermediate directories and the file on demand', async () => {
    const root = gameRoot();
    const file = await resolveFile(root, 'Data/meshes/custom/new.nif', { create: true });
    expect(file.name).toBe('new.nif');
    expect((await resolveDir(root, 'Data/meshes/custom')).name).toBe('custom');
  });
});

describe('listFiles and readRange', () => {
  it('lists files by suffix with sizes, sorted', async () => {
    const data = await resolveDir(gameRoot(), 'Data');
    const archives = await listArchives(data);
    expect(archives.map((a) => a.name)).toEqual(['Skyrim - Meshes0.bsa', 'Skyrim - Textures0.bsa']);
    expect(archives[0]!.size).toBe(BSA_HEADER.length);
    expect((await listFiles(data)).map((f) => f.name)).toContain('Skyrim.esm');
  });

  it('reads a byte range without the rest of the file', async () => {
    const file = await resolveFile(gameRoot(), 'Data/Skyrim - Meshes0.bsa');
    const head = await readRange(file, 4, 4);
    expect(new DataView(head.buffer).getUint32(0, true)).toBe(105);
    await expect(readRange(file, 8, 100)).rejects.toThrow(RangeError);
  });
});

describe('writeFileAtomic', () => {
  it('replaces the content on close', async () => {
    const dir = new FakeDir('d', { 'plugin.esp': 'old' });
    await writeFileAtomic(dir, 'plugin.esp', 'new content');
    const file = (await dir.getFileHandle('plugin.esp')) as FakeFile;
    expect(new TextDecoder().decode(file.content)).toBe('new content');
  });

  it('creates the file when missing and accepts bytes', async () => {
    const dir = new FakeDir('d');
    await writeFileAtomic(dir, 'backup.esp', new Uint8Array([1, 2, 3]));
    const file = (await dir.getFileHandle('backup.esp')) as FakeFile;
    expect([...file.content]).toEqual([1, 2, 3]);
  });

  it('leaves the original untouched when writing fails', async () => {
    const dir = new FakeDir('d', { 'plugin.esp': 'old' });
    const file = (await dir.getFileHandle('plugin.esp')) as FakeFile;
    const original = file.createWritable.bind(file);
    file.createWritable = async () => {
      const w = await original();
      return { ...w, write: async () => Promise.reject(new Error('disk full')) };
    };
    await expect(writeFileAtomic(dir, 'plugin.esp', 'new')).rejects.toThrow('disk full');
    expect(new TextDecoder().decode(file.content)).toBe('old');
  });
});

describe('identifyGameFolder', () => {
  it('accepts the game root', async () => {
    const found = await identifyGameFolder(gameRoot());
    expect(found?.pickedIs).toBe('root');
    expect(found?.data.name).toBe('Data');
  });

  it('accepts the Data folder itself', async () => {
    const data = await resolveDir(gameRoot(), 'Data');
    const found = await identifyGameFolder(data);
    expect(found?.pickedIs).toBe('data');
    expect(found?.data).toBe(data);
  });

  it('rejects anything else', async () => {
    expect(await identifyGameFolder(new FakeDir('Documents', { 'notes.txt': 'x' }))).toBeNull();
  });
});
