/**
 * Pure editing operations on annotations (step 10, part 3). Each returns a new object so
 * the UI can compare against the committed version; nothing here depends on Svelte.
 */
import type { AnalysisResult } from './analyze';
import type { Annotations, PieceAnnotation } from './annotations';

/** `EditorID:dir` of a face of the analysis. */
export function analysisFaceKey(analysis: AnalysisResult, faceIndex: number): string {
  const f = analysis.faces[faceIndex]!;
  return `${f.piece}:${f.opening.dir}`;
}

const samePair = (x: [string, string], y: [string, string]) =>
  (x[0] === y[0] && x[1] === y[1]) || (x[0] === y[1] && x[1] === y[0]);

/** Record (or clear, with `undefined`) the decision on a near-match pair. */
export function setMergeDecision(
  a: Annotations,
  faces: [string, string],
  decision: 'same-type' | 'distinct' | undefined,
): Annotations {
  const merges = a.merges.filter((m) => !samePair(m.faces, faces));
  if (decision) merges.push({ faces, decision });
  return { ...a, merges };
}

export function mergeDecision(
  a: Annotations,
  faces: [string, string],
): 'same-type' | 'distinct' | undefined {
  return a.merges.find((m) => samePair(m.faces, faces))?.decision;
}

/** Composite profile: the type of `face` also accepts the type of `accepts`, or no longer. */
export function setComposite(
  a: Annotations,
  face: string,
  accepts: string,
  on: boolean,
): Annotations {
  const composites = a.composites.filter((c) => !(c.face === face && c.accepts === accepts));
  if (on) composites.push({ face, accepts });
  return { ...a, composites };
}

export function isComposite(a: Annotations, face: string, accepts: string): boolean {
  return a.composites.some((c) => c.face === face && c.accepts === accepts);
}

export function setPiece(
  a: Annotations,
  editorId: string,
  patch: Partial<PieceAnnotation>,
): Annotations {
  const merged: PieceAnnotation = { ...a.pieces[editorId], ...patch };
  const clean = Object.fromEntries(
    Object.entries(merged).filter(([, v]) => v !== undefined && v !== false && v !== ''),
  ) as PieceAnnotation;
  const pieces = { ...a.pieces };
  if (Object.keys(clean).length) pieces[editorId] = clean;
  else delete pieces[editorId];
  return { ...a, pieces };
}
