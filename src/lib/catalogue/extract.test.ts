import { describe, expect, it } from 'vitest';
import type { StatInfo } from '../format/esp/stat';
import { classifyStat, extractKitStats, summarize } from './extract';
import { IMPERIAL_KIT } from './kits';

const stat = (formId: number, editorId: string, model: string): StatInfo => ({
  formId,
  editorId,
  model,
});

const STATS: StatInfo[] = [
  stat(0x35b77, 'ImpHall1Way01', 'Dungeons\\Imperial\\SmallHall\\ImpHall1Way01.nif'),
  stat(0x35b80, 'ImpLHallDoor01', 'Dungeons\\Imperial\\LargeHall\\ImpLHallDoor01.nif'),
  stat(0x35c00, 'ImpRoomMid01', 'Dungeons\\Imperial\\SmallRoom\\ImpRoomMid01.nif'),
  stat(0x35c10, 'ImpLRoomDoorL03', 'Dungeons\\Imperial\\LargeRoom\\ImpLRoomDoorL03.nif'),
  stat(0x35c20, 'ImpLRoomPillar01', 'Dungeons\\Imperial\\LargeRoom\\ImpLRoomPillar01.nif'),
  stat(0x35d00, 'ImpPillar01', 'Dungeons\\Imperial\\ClutterKits\\ImpPillar01.nif'),
  stat(0x35e00, 'ImpJailWall01', 'Dungeons\\Imperial\\Jail\\ImpJailWall01.nif'),
  stat(0x40000, 'NorHall1Way01', 'Dungeons\\Nordic\\SmallHall\\NorHall1Way01.nif'),
  stat(0x40001, 'ImpWallSconce01', 'Clutter\\Imperial\\ImpWallSconce01.nif'),
];

describe('classifyStat', () => {
  it('classifies by sub-folder and name', () => {
    const c = (i: number) => classifyStat(STATS[i]!, IMPERIAL_KIT);
    expect(c(0)).toEqual({ subkit: 'smallhall', category: 'hall' });
    expect(c(1)).toEqual({ subkit: 'largehall', category: 'door' });
    expect(c(2)).toEqual({ subkit: 'smallroom', category: 'room' });
    expect(c(3)).toEqual({ subkit: 'largeroom', category: 'door' });
    expect(c(4)).toEqual({ subkit: 'largeroom', category: 'other' }); // pillar = prop
    expect(c(5)).toEqual({ subkit: 'clutterkits', category: 'other' });
    expect(c(6)).toEqual({ subkit: 'jail', category: 'other' });
    expect(c(7)).toBeNull(); // another kit
    expect(c(8)).toBeNull(); // clutter folder, not dungeons/imperial
  });
});

describe('extractKitStats', () => {
  it('keeps the kit stats with form keys and archive paths, sorted by subkit', () => {
    const out = extractKitStats(STATS, IMPERIAL_KIT, 'Skyrim.esm');
    expect(out.length).toBe(7);
    expect(out[0]).toMatchObject({
      editorId: 'ImpPillar01',
      subkit: 'clutterkits',
      formKey: '0x00035D00:Skyrim.esm',
      modelPath: 'meshes/dungeons/imperial/clutterkits/imppillar01.nif',
    });
    const summary = summarize(out);
    expect(summary.total).toBe(7);
    expect(summary.byCategory).toEqual({ hall: 1, room: 1, door: 2, other: 3 });
    // ties on structural count are broken by total: largeroom has a door tile and a pillar
    expect(summary.bySubkit[0]).toEqual({ subkit: 'largeroom', total: 2, structural: 1 });
  });
});
