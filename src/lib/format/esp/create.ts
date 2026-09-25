/**
 * New plugins and new interior cells (step 16).
 *
 * A new plugin is a bare TES4 header: HEDR (version 1.71, the SE Creation Kit's, and the
 * first object id the CK uses, 0x800), author, masters. A new interior cell is a minimal CELL
 * record: EditorID, the interior flag and default lighting (XCLL); everything else is left to
 * the Creation Kit.
 */
import { BinaryWriter } from '../../binary/BinaryWriter';
import { CellFlags } from './cellRefr';
import { GroupType, typeToLabel, writeNodes, type EspGroup, type EspRecord } from './records';
import { writeSubrecords, zStringBytes, type Subrecord } from './subrecords';

/** HEDR version written by the Skyrim SE Creation Kit. */
export const PLUGIN_VERSION = 1.71;
/** First object id the Creation Kit hands out in a new plugin. */
export const FIRST_OBJECT_ID = 0x800;
/** Form version of Skyrim SE records. */
export const FORM_VERSION = 44;

export function newRecord(type: string, formId: number, data: Uint8Array): EspRecord {
  return {
    kind: 'record',
    type,
    flags: 0,
    formId,
    timestamp: 0,
    vcsInfo: 0,
    formVersion: FORM_VERSION,
    vcsInfo2: 0,
    data,
  };
}

export function newGroup(label: number, groupType: number): EspGroup {
  return { kind: 'group', label, groupType, timestamp: 0, vcsInfo: 0, unknown: 0, children: [] };
}

/** Bytes of an empty plugin: the TES4 header alone. */
export function newPluginBytes(options: {
  masters: readonly string[];
  author?: string;
}): Uint8Array {
  const subs: Subrecord[] = [
    {
      type: 'HEDR',
      data: new BinaryWriter(12).f32(PLUGIN_VERSION).u32(0).u32(FIRST_OBJECT_ID).toUint8Array(),
    },
    { type: 'CNAM', data: zStringBytes(options.author || 'Dungeon Maker') },
  ];
  for (const m of options.masters) {
    subs.push({ type: 'MAST', data: zStringBytes(m) });
    subs.push({ type: 'DATA', data: new Uint8Array(8) });
  }
  const w = new BinaryWriter(1024);
  writeNodes(w, [newRecord('TES4', 0, writeSubrecords(subs))]);
  return w.toUint8Array();
}

/**
 * Default interior lighting (XCLL, 92 bytes in SE): a dim neutral ambient, no directional
 * light, no fog. The author sets the real lighting (or a lighting template) in the CK.
 */
function defaultLighting(): Uint8Array {
  const grey = [60, 60, 60, 0];
  const w = new BinaryWriter(92);
  for (const v of grey) w.u8(v); // ambient
  for (let i = 0; i < 4; i++) w.u8(0); // directional
  for (let i = 0; i < 4; i++) w.u8(0); // fog near colour
  w.f32(0).f32(10000); // fog near, fog far
  w.u32(0).u32(0); // directional rotation XY, Z
  w.f32(1).f32(0).f32(1); // directional fade, fog clip distance, fog power
  for (let i = 0; i < 6; i++) for (const v of grey) w.u8(v); // directional ambient, 6 axes
  for (let i = 0; i < 4; i++) w.u8(0); // specular
  w.f32(1); // fresnel power
  for (let i = 0; i < 4; i++) w.u8(0); // fog far colour
  w.f32(1); // fog max
  w.f32(0).f32(0); // light fade begin, end
  w.u32(0); // inheritance flags: nothing inherited
  return w.toUint8Array();
}

/** CELL data of a new interior cell. */
export function newInteriorCellData(editorId: string): Uint8Array {
  return writeSubrecords([
    { type: 'EDID', data: zStringBytes(editorId) },
    { type: 'DATA', data: new BinaryWriter(2).u16(CellFlags.interior).toUint8Array() },
    { type: 'XCLL', data: defaultLighting() },
  ]);
}

/** Interior cell block and sub-block numbers: last and second-to-last decimal digits. */
export function interiorBlockOf(formId: number): { block: number; subBlock: number } {
  const objectId = formId & 0xffffff;
  return { block: objectId % 10, subBlock: Math.floor(objectId / 10) % 10 };
}

/** Top groups that come after CELL in a Skyrim SE plugin; a new CELL group goes before them. */
export const TOP_GROUPS_AFTER_CELL = new Set(
  (
    'WRLD DIAL QUST IDLE PACK CSTY LSCR LVSP ANIO WATR EFSH EXPL DEBR IMGS IMAD FLST PERK ' +
    'BPTD ADDN AVIF CAMS CPTH VTYP MATT IPCT IPDS ARMA ECZN LCTN MESG RGDL DOBJ LGTM MUSC ' +
    'FSTP FSTS SMBN SMQN SMEN DLBR MUST DLVW WOOP SHOU EQUP RELA SCEN ASTP OTFT ARTO MATO ' +
    'MOVT SNDR DUAL SNCT SOPM COLL CLFM REVB'
  )
    .split(' ')
    .map(typeToLabel),
);

export { GroupType };
