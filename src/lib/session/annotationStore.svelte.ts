/**
 * Annotations being edited on the Validation page. Starts from the committed file; every
 * edit replaces the whole object (the edit helpers are pure), and `dirty` compares the
 * serialized form with the committed one.
 */
import committedJson from '../../../data/annotations/imperial.json';
import {
  parseAnnotations,
  serializeAnnotations,
  type Annotations,
} from '$lib/catalogue/annotations';

class AnnotationStore {
  committed = $state.raw<Annotations>(parseAnnotations(committedJson));
  current = $state.raw<Annotations>(parseAnnotations(committedJson));

  readonly dirty = $derived(
    serializeAnnotations(this.current) !== serializeAnnotations(this.committed),
  );

  update(fn: (a: Annotations) => Annotations): void {
    this.current = fn(this.current);
  }

  revert(): void {
    this.current = this.committed;
  }

  /** After the file is written (part 4). */
  markSaved(): void {
    this.committed = this.current;
  }
}

export const annotationStore = new AnnotationStore();
