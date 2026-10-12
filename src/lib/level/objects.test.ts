import { describe, expect, it } from 'vitest';
import { BinaryWriter } from '../binary/BinaryWriter';
import { BufferRangeSource } from '../format/bsa';
import { GroupType, typeToLabel, writeNodes } from '../format/esp/records';
import { writeSubrecords, zStringBytes, type Subrecord } from '../format/esp/subrecords';
import { group, record, tes4Record } from '../format/esp/testPlugin';
import { indexPluginBases, objectCategory } from './objects';

/** A plugin (master Skyrim.esm) with one top group per record type of `bases`. */
function buildPluginBytes(bases: [string, number, string, string | undefined][]): Uint8Array {
  const groups = [...new Set(bases.map((b) => b[0]))].map((type) =>
    group(
      typeToLabel(type),
      GroupType.top,
      bases
        .filter((b) => b[0] === type)
        .map(([, formId, editorId, model]) => {
          const subs: Subrecord[] = [{ type: 'EDID', data: zStringBytes(editorId) }];
          if (model) subs.push({ type: 'MODL', data: zStringBytes(model) });
          return record(type, formId, writeSubrecords(subs));
        }),
    ),
  );
  const w = new BinaryWriter(4096);
  writeNodes(w, [
    tes4Record({ masters: ['Skyrim.esm'], nextObjectId: 0x900, numRecords: 10 }),
    ...groups,
  ]);
  return w.toUint8Array();
}

describe('objectCategory', () => {
  it('sorts the bases a cell places by what they are', () => {
    const c = (type: string, editorId: string, model?: string) =>
      objectCategory({ type, editorId, ...(model ? { model } : {}) });
    expect(c('FURN', 'CommonChair01F', 'Furniture/Chair.nif')).toBe('furniture');
    expect(c('CONT', 'BarrelFood01', 'Clutter/Barrel.nif')).toBe('container');
    expect(c('LIGH', 'DwarvenOmniLight')).toBe('light');
    expect(c('DOOR', 'DweDoorSmall01', 'Door.nif')).toBe('door');
    expect(c('SOUN', 'AMBRumbleCLP')).toBe('sound');
    expect(c('TXST', 'DecalBlood')).toBe('decal');
    expect(c('NPC_', 'Bandit')).toBe('actor');
    expect(c('ACTI', 'DweLever01', 'Lever.nif')).toBe('activator');
    expect(c('MISC', 'BasicPlate01', 'Plate.nif')).toBe('clutter');
    expect(c('STAT', 'CommonTableRound01', 'Table.nif')).toBe('clutter');
    // markers: STATs by name or model, idle markers, furniture markers, triggers
    expect(c('STAT', 'XMarkerHeading', 'Marker_Heading.nif')).toBe('marker');
    expect(c('STAT', 'BlackPlane01', 'Markers/BlackPlane.nif')).toBe('marker');
    expect(c('IDLM', 'PatrolIdleMarker')).toBe('marker');
    expect(c('FURN', 'LeanTableMarker', 'Furniture/Lean.nif')).toBe('marker');
    expect(c('ACTI', 'TriggerBox')).toBe('marker');
    expect(objectCategory(undefined)).toBe('other');
  });
});

describe('indexPluginBases', () => {
  it('reads the bases of a plugin by FormKey, with type, EditorID and model', async () => {
    const bytes = buildPluginBytes([
      ['FURN', 0x01000800, 'MyChair', 'Furniture/Chair.nif'],
      ['LIGH', 0x00012345, 'OverriddenLight', undefined],
    ]);
    const index = await indexPluginBases(new BufferRangeSource(bytes), 'My.esp');
    expect(index.get('0x00000800:My.esp')).toEqual({
      type: 'FURN',
      editorId: 'MyChair',
      model: 'Furniture/Chair.nif',
    });
    expect(index.get('0x00012345:Skyrim.esm')).toEqual({
      type: 'LIGH',
      editorId: 'OverriddenLight',
    });
  });
});
