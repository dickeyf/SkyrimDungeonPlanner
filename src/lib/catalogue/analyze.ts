/**
 * Step 9: build the kit catalogue from the meshes (D12, D46). For every structural STAT the
 * mesh is read through the virtual Data view, analysed (R5 footprint, R3 face profiles), and
 * the face profiles of the whole kit are grouped into proposed connection types.
 */
import { mergeShapes } from '../format/nif/geometry';
import { NifFile } from '../format/nif/NifFile';
import { computeFootprint, type Footprint } from '../mesh/footprint';
import { weldMesh } from '../mesh/geometry';
import { findOpenings, type Opening } from '../mesh/openings';
import { extractProfile, type Profile } from '../mesh/profiles';
import { groupProfiles, type GroupingResult } from '../mesh/signatures';
import type { ArchiveIndex } from '../vfs/archiveIndex';
import type { KitStat } from './extract';
import type { KitDefinition } from './kits';
import type { Catalogue, ConnectionType, Face, FaceDir, Piece } from './types';

export interface AnalysedFace {
  piece: string; // editorId
  opening: Opening;
  level: number;
  /** See Footprint.openingInsets. */
  inset: number;
  cells: Face['cell'][];
  profile: Profile;
  group: number;
}

export interface AnalysedPiece {
  stat: KitStat;
  source: string;
  vertices: number;
  bbox: { min: [number, number, number]; max: [number, number, number] };
  openings: Opening[];
  footprint: Footprint;
  faces: number[]; // indices into AnalysisResult.faces
  error?: string;
}

export interface AnalysisResult {
  kit: KitDefinition;
  pieces: AnalysedPiece[];
  faces: AnalysedFace[];
  grouping: GroupingResult;
  catalogue: Catalogue;
  elapsedMs: number;
}

export type Progress = (done: number, total: number, current: string) => void;

export async function analyseKit(
  stats: readonly KitStat[],
  kit: KitDefinition,
  index: ArchiveIndex,
  onProgress?: Progress,
): Promise<AnalysisResult> {
  const started = performance.now();
  const structural = stats.filter((s) => s.category !== 'other');
  const pieces: AnalysedPiece[] = [];
  const faces: AnalysedFace[] = [];
  const module = kit.module.xy!;
  const zModule = kit.module.z!;

  for (let i = 0; i < structural.length; i++) {
    const stat = structural[i]!;
    onProgress?.(i, structural.length, stat.editorId);
    try {
      const read = await index.read(stat.modelPath);
      if (!read) throw new Error('mesh not found in any layer or archive');
      const mesh = mergeShapes(NifFile.parse(read.bytes), { skipAlpha: true });
      const g = weldMesh(mesh);
      const openings = findOpenings(g);
      const footprint = computeFootprint(g, openings, module, zModule);
      const piece: AnalysedPiece = {
        stat,
        source: read.source,
        vertices: g.count,
        bbox: { min: g.min, max: g.max },
        openings,
        footprint,
        faces: [],
      };
      openings.forEach((o, k) => {
        const cells = footprint.openingCells[k]!;
        // Normalized cell c along the face spans piece-space [-pivot + c*module, +module);
        // the profile's u origin is the centre of the covered cells.
        const along = cells.map((c) => c[o.other]!);
        const u0 =
          -footprint.pivot[o.other] + ((Math.min(...along) + Math.max(...along) + 1) / 2) * module;
        const level = footprint.openingLevels[k]!;
        const inset = footprint.openingInsets[k]!;
        const profile = extractProfile(g, o, u0, level, zModule);
        piece.faces.push(faces.length);
        faces.push({ piece: stat.editorId, opening: o, level, inset, cells, profile, group: -1 });
      });
      pieces.push(piece);
    } catch (error) {
      pieces.push({
        stat,
        source: '',
        vertices: 0,
        bbox: { min: [0, 0, 0], max: [0, 0, 0] },
        openings: [],
        footprint: {
          phase: [0, 0],
          cells: [],
          pivot: [0, 0, 0],
          openingCells: [],
          openingLevels: [],
          openingInsets: [],
          fits: false,
          notes: [],
        },
        faces: [],
        error: (error as Error).message,
      });
    }
  }
  onProgress?.(structural.length, structural.length, 'grouping faces');

  const grouping = groupProfiles(faces.map((f) => f.profile));
  faces.forEach((f, i) => (f.group = grouping.groupOf[i]!));

  const connectionTypes: ConnectionType[] = grouping.groups.map((g) => ({
    id: `${kit.kit}:G${g.id}`,
    kit: kit.kit,
    signature: `w${Math.round(g.width)} h${Math.round(g.height)} v${Math.round(g.vMin)}`,
    mate: g.mate === undefined ? `${kit.kit}:G${g.id}` : `${kit.kit}:G${g.mate}`,
    navEdge: null,
  }));

  const catalogue: Catalogue = {
    version: 1,
    kits: [{ kit: kit.kit, module: kit.module, note: kit.note }],
    connectionTypes,
    pieces: pieces
      .filter((p) => !p.error && p.openings.length > 0)
      .map((p): Piece => ({
        editorId: p.stat.editorId,
        formKey: p.stat.formKey,
        model: p.stat.model,
        kit: kit.kit,
        class: 'tile',
        category: p.stat.category,
        pivot: p.footprint.pivot,
        cells: p.footprint.cells,
        faces: p.faces.flatMap((fi) => {
          const f = faces[fi]!;
          return f.cells.map((cell) => ({
            cell,
            dir: f.opening.dir as FaceDir,
            conn: `${kit.kit}:G${f.group}`,
            ...(f.inset ? { inset: Math.round(f.inset * 2) / 2 } : {}),
          }));
        }),
        walkable: null,
        obstacle: null,
        review: { auto: true, validated: false },
      })),
  };

  return { kit, pieces, faces, grouping, catalogue, elapsedMs: performance.now() - started };
}
