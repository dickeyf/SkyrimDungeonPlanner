import { describe, expect, it } from 'vitest';
import { TINY_BSA_B64, TINY_BSA_README, TINY_NIF_B64, fromBase64 } from '../../testdata/fixtures';
import { NifFile } from '../nif/NifFile';
import { BsaArchive, normalizeArchivePath } from './BsaArchive';
import { BufferRangeSource } from './RangeSource';

async function openTiny(): Promise<BsaArchive> {
  return BsaArchive.open(new BufferRangeSource(fromBase64(TINY_BSA_B64)));
}

describe('BsaArchive', () => {
  it('reads the tables', async () => {
    const bsa = await openTiny();
    expect(bsa.header.version).toBe(105);
    expect(bsa.header.fileCount).toBe(2);
    expect([...bsa.entries.keys()]).toEqual([
      'meshes/readme.txt',
      'meshes/dungeons/imperial/smallhall/tiny.nif',
    ]);
    expect(bsa.get('MESHES\\Dungeons\\Imperial\\SmallHall\\Tiny.NIF')?.compressed).toBe(true);
    expect(bsa.get('meshes/readme.txt')?.compressed).toBe(false);
    expect(bsa.has('meshes/nothing.nif')).toBe(false);
  });

  it('finds entries by prefix and suffix', async () => {
    const bsa = await openTiny();
    expect(bsa.find('meshes/dungeons/imperial', '.nif').map((e) => e.path)).toEqual([
      'meshes/dungeons/imperial/smallhall/tiny.nif',
    ]);
    expect(bsa.find('', '.txt').length).toBe(1);
  });

  it('reads a stored file and a compressed file', async () => {
    const bsa = await openTiny();
    expect(new TextDecoder().decode(await bsa.read('meshes/readme.txt'))).toBe(TINY_BSA_README);
    const nif = await bsa.read('meshes/dungeons/imperial/smallhall/tiny.nif');
    expect(nif).toEqual(fromBase64(TINY_NIF_B64));
    expect(NifFile.parse(nif).shapes().length).toBe(2);
  });

  it('rejects unknown paths and non-archives', async () => {
    const bsa = await openTiny();
    await expect(bsa.read('meshes/nothing.nif')).rejects.toThrow('not in archive');
    await expect(BsaArchive.open(new BufferRangeSource(new Uint8Array(64)))).rejects.toThrow(
      'not a BSA',
    );
  });

  it('normalizes archive paths', () => {
    expect(normalizeArchivePath('\\Meshes\\Dungeons\\X.nif/')).toBe('meshes/dungeons/x.nif');
  });
});
