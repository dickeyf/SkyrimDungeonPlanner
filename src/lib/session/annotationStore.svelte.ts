/**
 * Annotations being edited on the Validation page, one set per kit (D69). Each starts from the
 * kit's committed file (`data/annotations/<kit>.json`); every edit replaces the whole object
 * (the edit helpers are pure), and `dirty` compares the serialized form with the committed one.
 * The getters without a kit work on the kit chosen on the catalogue pages.
 */
import {
  parseAnnotations,
  serializeAnnotations,
  type Annotations,
} from '$lib/catalogue/annotations';
import { catalogueStore } from './catalogueStore.svelte';

const files = import.meta.glob<unknown>('../../../data/annotations/*.json', {
  eager: true,
  import: 'default',
});

/** The committed annotations of every kit, by kit name. */
function committedFiles(): Record<string, Annotations> {
  const out: Record<string, Annotations> = {};
  for (const json of Object.values(files)) {
    const a = parseAnnotations(json);
    out[a.kit] = a;
  }
  return out;
}

const empty = (kit: string): Annotations => parseAnnotations({ version: 1, kit });

class AnnotationStore {
  private committedByKit = $state.raw<Record<string, Annotations>>(committedFiles());
  private currentByKit = $state.raw<Record<string, Annotations>>(committedFiles());

  committedOf(kit: string): Annotations {
    return this.committedByKit[kit] ?? empty(kit);
  }

  currentOf(kit: string): Annotations {
    return this.currentByKit[kit] ?? this.committedOf(kit);
  }

  dirtyOf(kit: string): boolean {
    return (
      serializeAnnotations(this.currentOf(kit)) !== serializeAnnotations(this.committedOf(kit))
    );
  }

  updateOf(kit: string, fn: (a: Annotations) => Annotations): void {
    this.currentByKit = { ...this.currentByKit, [kit]: fn(this.currentOf(kit)) };
  }

  /** The chosen kit's annotations. */
  get committed(): Annotations {
    return this.committedOf(catalogueStore.kit.kit);
  }

  get current(): Annotations {
    return this.currentOf(catalogueStore.kit.kit);
  }

  /** Whether any kit has unsaved annotations. */
  get dirty(): boolean {
    const kits = new Set([...Object.keys(this.currentByKit), ...Object.keys(this.committedByKit)]);
    return [...kits].some((k) => this.dirtyOf(k));
  }

  update(fn: (a: Annotations) => Annotations): void {
    this.updateOf(catalogueStore.kit.kit, fn);
  }

  revert(): void {
    const kit = catalogueStore.kit.kit;
    this.currentByKit = { ...this.currentByKit, [kit]: this.committedOf(kit) };
  }

  /** After the chosen kit's file is written. */
  markSaved(): void {
    const kit = catalogueStore.kit.kit;
    this.committedByKit = { ...this.committedByKit, [kit]: this.currentOf(kit) };
  }
}

export const annotationStore = new AnnotationStore();
