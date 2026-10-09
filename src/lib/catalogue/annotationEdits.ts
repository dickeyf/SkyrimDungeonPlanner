/**
 * Pure editing operations on annotations (step 10, part 3). Each returns a new object so
 * the UI can compare against the committed version; nothing here depends on Svelte.
 */
import type { AnalysisResult } from './analyze';
import type { Annotations, OverlapAnnotation, PieceAnnotation } from './annotations';

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

/**
 * The piece a snow or ice variant is made from (`DweFacadeHallSm1way01snow` ->
 * `DweFacadeHallSm1way01`, `NorRmBgWallFront01_HeavySN` -> `NorRmBgWallFront01`), or the id
 * itself when it is no such variant.
 */
export function variantBase(editorId: string): string {
  return editorId.replace(/(_?(heavy|light|lt)?(snow|ice|sn)(light|heavy)?)+$/i, '');
}

/**
 * Validate a kit's pieces from what the game builds (V5 step 3): a piece the game places at
 * least `min` times (`used`, from the Vanilla check) is validated, and so is a snow or ice
 * variant of such a piece (`variantBase`); any other is excluded with the reason. Why: a
 * designer new to a kit cannot judge each piece; what the game uses is right, and a piece it
 * never uses (a set piece, an outside piece) would only clutter the palette. The variants are
 * the same mesh with other textures, which a snowy dungeon needs and which fit as their base
 * does (the user's choice, 8 Oct 2026: the Nordic kit, validated by hand, kept them).
 * The other annotations (merges, composites, overlaps, walkable reviews) are kept.
 */
export function validateUsed(
  a: Annotations,
  editorIds: readonly string[],
  used: Readonly<Record<string, number>>,
  min: number,
  master: string,
): Annotations {
  let out = a;
  for (const id of editorIds) {
    const n = used[id] ?? 0;
    const base = variantBase(id);
    out =
      n >= min || (base !== id && (used[base] ?? 0) >= min)
        ? setPiece(out, id, { validated: true, exclude: undefined })
        : setPiece(out, id, {
            validated: undefined,
            exclude: `not used by the game (${n} in ${master}'s CELLs)`,
          });
  }
  return out;
}

const sameOverlap = (x: OverlapAnnotation, y: OverlapAnnotation) =>
  x.pieces[0] === y.pieces[0] &&
  x.pieces[1] === y.pieces[1] &&
  x.rotation === y.rotation &&
  x.offset.every((v, i) => v === y.offset[i]);

/** Record (or remove) an accepted overlap between two pieces in one relative placement. */
export function setOverlap(a: Annotations, overlap: OverlapAnnotation, on: boolean): Annotations {
  const rest = a.overlaps.filter((o) => !sameOverlap(o, overlap));
  return { ...a, overlaps: on ? [...rest, overlap] : rest };
}
