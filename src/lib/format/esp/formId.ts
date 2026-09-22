/**
 * FormIDs: the top byte is the index of the plugin in the file's load order (masters first,
 * the plugin itself last), the low 24 bits the object id. A FormKey names the same object
 * independently of load order: `0x00123456:Skyrim.esm`.
 */
import type { FormKey } from '../../catalogue/types';

export function formIdIndex(formId: number): number {
  return formId >>> 24;
}

export function formIdObject(formId: number): number {
  return formId & 0x00ffffff;
}

export function makeFormId(index: number, objectId: number): number {
  return ((index << 24) | (objectId & 0x00ffffff)) >>> 0;
}

export function formIdHex(formId: number): string {
  return `0x${formId.toString(16).padStart(8, '0').toUpperCase()}`;
}

/** `masters` = the plugin's MAST list; `self` = the plugin's own file name. */
export function toFormKey(formId: number, masters: readonly string[], self: string): FormKey {
  const index = formIdIndex(formId);
  const owner = index < masters.length ? masters[index]! : self;
  return `${formIdHex(formIdObject(formId))}:${owner}`;
}

export function fromFormKey(key: FormKey, masters: readonly string[], self: string): number {
  const sep = key.indexOf(':');
  if (sep === -1) throw new Error(`bad FormKey "${key}"`);
  const objectId = Number.parseInt(key.slice(0, sep), 16);
  const owner = key.slice(sep + 1);
  const index =
    owner.toLowerCase() === self.toLowerCase()
      ? masters.length
      : masters.findIndex((m) => m.toLowerCase() === owner.toLowerCase());
  if (index === -1) throw new Error(`"${owner}" is not a master of ${self}`);
  return makeFormId(index, objectId);
}
