/**
 * Human annotations over the automatic catalogue (step 10, D12, D46, D56, V9).
 *
 * Only human decisions are stored, never game data: everything geometric is recomputed from
 * the user's installation. Keys are EditorIDs and `EditorID:dir` face keys, never the G
 * numbers of an analysis run, which change whenever the piece list changes.
 */
import type { Catalogue, ConnectionType, FaceDir, Piece, PieceCategory } from './types';

export interface ConnectionTypeAnnotation {
  /** Stable, human-readable id, e.g. `ImpHallSm`. */
  name: string;
  /** A face of the type, `EditorID:dir`, used to find the type in a fresh analysis. */
  face: string;
  validated?: boolean;
  note?: string;
}

export interface MergeAnnotation {
  /** Two faces from two automatic groups. */
  faces: [string, string];
  /** `same-type` joins the groups; `distinct` records that a near match was refused. */
  decision: 'same-type' | 'distinct';
}

export interface FaceAnnotation {
  /** Composite profiles (D56): extra connection types this face also accepts, by name. */
  extraTypes?: string[];
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
  connectionTypes: ConnectionTypeAnnotation[];
  merges: MergeAnnotation[];
  faces: Record<string, FaceAnnotation>;
  pieces: Record<string, PieceAnnotation>;
}

export function emptyAnnotations(kit: string): Annotations {
  return { version: 1, kit, connectionTypes: [], merges: [], faces: {}, pieces: {} };
}

export type AnnotationIssue =
  | { kind: 'unknown-face'; face: string; where: string }
  | { kind: 'unknown-piece'; piece: string }
  | { kind: 'unknown-type-name'; name: string; where: string }
  | { kind: 'name-conflict'; type: string; names: string[] }
  | { kind: 'duplicate-name'; name: string };

export interface AnnotatedCatalogue {
  catalogue: Catalogue;
  issues: AnnotationIssue[];
  /** Automatic type id -> final type id, for display. */
  renamed: Map<string, string>;
  unnamedTypes: number;
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
    connectionTypes: a.connectionTypes ?? [],
    merges: a.merges ?? [],
    faces: a.faces ?? {},
    pieces: a.pieces ?? {},
  };
}

/** Apply annotations to an automatic catalogue. The input is not modified. */
export function applyAnnotations(auto: Catalogue, annotations: Annotations): AnnotatedCatalogue {
  const issues: AnnotationIssue[] = [];
  const faces = faceIndex(auto);
  const typeIds = auto.connectionTypes.map((t) => t.id);

  // 1. merges: union-find over automatic type ids
  const parent = new Map(typeIds.map((id) => [id, id]));
  const find = (id: string): string => {
    let x = id;
    while (parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  for (const merge of annotations.merges) {
    const ids = merge.faces.map((f) => {
      const id = faces.get(f);
      if (!id) issues.push({ kind: 'unknown-face', face: f, where: 'merge' });
      return id;
    });
    if (merge.decision === 'same-type' && ids[0] && ids[1]) {
      const [a, b] = [find(ids[0]), find(ids[1])].sort() as [string, string];
      if (a !== b) parent.set(b, a);
    }
  }

  // 2. names: resolved through their representative face
  const nameOf = new Map<string, string>(); // root id -> name
  const namesByRoot = new Map<string, string[]>();
  const seenNames = new Set<string>();
  for (const t of annotations.connectionTypes) {
    if (seenNames.has(t.name)) issues.push({ kind: 'duplicate-name', name: t.name });
    seenNames.add(t.name);
    const id = faces.get(t.face);
    if (!id) {
      issues.push({ kind: 'unknown-face', face: t.face, where: `type ${t.name}` });
      continue;
    }
    const root = find(id);
    const list = namesByRoot.get(root) ?? [];
    list.push(t.name);
    namesByRoot.set(root, list);
    if (!nameOf.has(root)) nameOf.set(root, t.name);
  }
  for (const [root, names] of namesByRoot) {
    if (names.length > 1) issues.push({ kind: 'name-conflict', type: root, names });
  }

  const renamed = new Map<string, string>();
  for (const id of typeIds) renamed.set(id, nameOf.get(find(id)) ?? find(id));
  const finalId = (id: string) => renamed.get(id) ?? id;

  // 3. connection types: one per root, mate renamed
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
  const validNames = new Set(connectionTypes.map((t) => t.id));

  // 4. pieces: exclusions, categories, validation, renamed and extra connections
  const knownPieces = new Set(auto.pieces.map((p) => p.editorId));
  for (const editorId of Object.keys(annotations.pieces)) {
    if (!knownPieces.has(editorId)) issues.push({ kind: 'unknown-piece', piece: editorId });
  }
  for (const key of Object.keys(annotations.faces)) {
    if (!faces.has(key)) issues.push({ kind: 'unknown-face', face: key, where: 'faces' });
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
        const extra = annotations.faces[faceKey(piece.editorId, face.dir)]?.extraTypes ?? [];
        for (const name of extra) {
          if (!validNames.has(name)) {
            issues.push({
              kind: 'unknown-type-name',
              name,
              where: faceKey(piece.editorId, face.dir),
            });
          }
        }
        const extraConn = extra.filter((n) => validNames.has(n));
        return { ...face, conn: finalId(face.conn), ...(extraConn.length ? { extraConn } : {}) };
      }),
    });
  }

  const unnamedTypes = connectionTypes.filter((t) => !seenNames.has(t.id)).length;
  return {
    catalogue: { ...auto, connectionTypes, pieces },
    issues: dedupeIssues(issues),
    renamed,
    unnamedTypes,
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

/** Stable serialization: sorted keys so the committed file diffs cleanly. */
export function serializeAnnotations(a: Annotations): string {
  const sortObject = <T>(o: Record<string, T>) =>
    Object.fromEntries(Object.entries(o).sort(([x], [y]) => x.localeCompare(y)));
  const clean = {
    version: a.version,
    kit: a.kit,
    connectionTypes: [...a.connectionTypes].sort((x, y) => x.name.localeCompare(y.name)),
    merges: a.merges,
    faces: sortObject(a.faces),
    pieces: sortObject(a.pieces),
  };
  return `${JSON.stringify(clean, null, 2)}\n`;
}
