/**
 * Human annotations over the automatic catalogue (step 10, D12, D46, D56, V9).
 *
 * Only human decisions are stored, never game data: everything geometric is recomputed from
 * the user's installation. Types are never named by hand: they are designated by one of their
 * faces, `EditorID:dir`, which stays valid across analysis runs (the G numbers do not).
 */
import type { Catalogue, ConnectionType, FaceDir, Piece, PieceCategory } from './types';

export interface MergeAnnotation {
  /** Two faces from two automatic groups. */
  faces: [string, string];
  /** `same-type` joins the groups; `distinct` records that a near match was refused. */
  decision: 'same-type' | 'distinct';
}

export interface CompositeAnnotation {
  /** A face of the composite type: every face of that type also accepts... */
  face: string;
  /** ...the type of this face (D56). */
  accepts: string;
}

export interface PieceAnnotation {
  validated?: boolean;
  category?: PieceCategory;
  /** Reason for leaving the piece out of the catalogue. */
  exclude?: string;
}

export interface Annotations {
  version: 1;
  kit: string;
  merges: MergeAnnotation[];
  composites: CompositeAnnotation[];
  pieces: Record<string, PieceAnnotation>;
}

export function emptyAnnotations(kit: string): Annotations {
  return { version: 1, kit, merges: [], composites: [], pieces: {} };
}

export type AnnotationIssue =
  { kind: 'unknown-face'; face: string; where: string } | { kind: 'unknown-piece'; piece: string };

export interface AnnotatedCatalogue {
  catalogue: Catalogue;
  issues: AnnotationIssue[];
  /** Automatic type id -> final (stable) type id. */
  renamed: Map<string, string>;
  excludedPieces: string[];
}

export function faceKey(editorId: string, dir: FaceDir): string {
  return `${editorId}:${dir}`;
}

/** `EditorID:dir` -> automatic connection type id, from the catalogue's pieces. */
export function faceIndex(catalogue: Catalogue): Map<string, string> {
  const out = new Map<string, string>();
  for (const piece of catalogue.pieces) {
    for (const face of piece.faces) {
      const key = faceKey(piece.editorId, face.dir);
      if (!out.has(key)) out.set(key, face.conn);
    }
  }
  return out;
}

export function parseAnnotations(json: unknown): Annotations {
  if (typeof json !== 'object' || json === null) throw new Error('annotations: not an object');
  const a = json as Partial<Annotations>;
  if (a.version !== 1) throw new Error(`annotations: unsupported version ${String(a.version)}`);
  if (typeof a.kit !== 'string') throw new Error('annotations: missing kit');
  return {
    version: 1,
    kit: a.kit,
    merges: a.merges ?? [],
    composites: a.composites ?? [],
    pieces: a.pieces ?? {},
  };
}

/** Apply annotations to an automatic catalogue. The input is not modified. */
export function applyAnnotations(auto: Catalogue, annotations: Annotations): AnnotatedCatalogue {
  const issues: AnnotationIssue[] = [];
  const faces = faceIndex(auto);
  const typeIds = auto.connectionTypes.map((t) => t.id);
  const kit = auto.kits[0]?.kit ?? annotations.kit;
  const resolve = (face: string, where: string): string | undefined => {
    const id = faces.get(face);
    if (!id) issues.push({ kind: 'unknown-face', face, where });
    return id;
  };

  // 1. merges: union-find over automatic type ids
  const parent = new Map(typeIds.map((id) => [id, id]));
  const find = (id: string): string => {
    let x = id;
    while (parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  for (const merge of annotations.merges) {
    const a = resolve(merge.faces[0], 'merge');
    const b = resolve(merge.faces[1], 'merge');
    if (merge.decision === 'same-type' && a && b) {
      const [ra, rb] = [find(a), find(b)].sort() as [string, string];
      if (ra !== rb) parent.set(rb, ra);
    }
  }

  // 2. stable id per final type: the smallest face key among its faces
  const smallestFace = new Map<string, string>();
  for (const [key, id] of faces) {
    const root = find(id);
    const current = smallestFace.get(root);
    if (current === undefined || key < current) smallestFace.set(root, key);
  }
  const renamed = new Map<string, string>();
  for (const id of typeIds) {
    const root = find(id);
    const face = smallestFace.get(root);
    renamed.set(id, face ? `${kit}/${face}` : root);
  }
  const finalId = (id: string) => renamed.get(id) ?? id;

  // 3. connection types: one per final id, mate renamed
  const byId = new Map(auto.connectionTypes.map((t) => [t.id, t]));
  const connectionTypes: ConnectionType[] = [];
  const emitted = new Set<string>();
  for (const id of typeIds) {
    const root = find(id);
    const out = finalId(root);
    if (emitted.has(out)) continue;
    emitted.add(out);
    const source = byId.get(root)!;
    connectionTypes.push({ ...source, id: out, mate: finalId(source.mate) });
  }

  // 4. composites: every face of the outer type also accepts the inner type
  const alsoAccepts = new Map<string, Set<string>>();
  for (const c of annotations.composites) {
    const outer = resolve(c.face, 'composite');
    const inner = resolve(c.accepts, 'composite');
    if (!outer || !inner) continue;
    const set = alsoAccepts.get(finalId(outer)) ?? new Set<string>();
    set.add(finalId(inner));
    alsoAccepts.set(finalId(outer), set);
  }

  // 5. pieces: exclusions, categories, validation, final and extra connections
  const knownPieces = new Set(auto.pieces.map((p) => p.editorId));
  for (const editorId of Object.keys(annotations.pieces)) {
    if (!knownPieces.has(editorId)) issues.push({ kind: 'unknown-piece', piece: editorId });
  }
  const excludedPieces: string[] = [];
  const pieces: Piece[] = [];
  for (const piece of auto.pieces) {
    const ann = annotations.pieces[piece.editorId];
    if (ann?.exclude) {
      excludedPieces.push(piece.editorId);
      continue;
    }
    pieces.push({
      ...piece,
      category: ann?.category ?? piece.category,
      review: { ...piece.review, validated: ann?.validated ?? piece.review.validated },
      faces: piece.faces.map((face) => {
        const conn = finalId(face.conn);
        const extra = [...(alsoAccepts.get(conn) ?? [])].filter((x) => x !== conn).sort();
        return { ...face, conn, ...(extra.length ? { extraConn: extra } : {}) };
      }),
    });
  }

  return {
    catalogue: { ...auto, connectionTypes, pieces },
    issues: dedupeIssues(issues),
    renamed,
    excludedPieces,
  };
}

function dedupeIssues(issues: AnnotationIssue[]): AnnotationIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = JSON.stringify(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Stable serialization: sorted entries so the committed file diffs cleanly. */
export function serializeAnnotations(a: Annotations): string {
  const pairKey = (x: { faces: [string, string] }) => [...x.faces].sort().join('|');
  const clean = {
    version: a.version,
    kit: a.kit,
    merges: [...a.merges].sort((x, y) => pairKey(x).localeCompare(pairKey(y))),
    composites: [...a.composites].sort(
      (x, y) => x.face.localeCompare(y.face) || x.accepts.localeCompare(y.accepts),
    ),
    pieces: Object.fromEntries(Object.entries(a.pieces).sort(([x], [y]) => x.localeCompare(y))),
  };
  return `${JSON.stringify(clean, null, 2)}\n`;
}
