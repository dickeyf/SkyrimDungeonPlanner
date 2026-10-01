/**
 * Hand edits of a NavMesh (V2 step 15): merge vertices, create a triangle, join two NAVMs of a
 * cell into one record (D36). Each returns a new NavMeshData with adjacency and the search grid
 * recomputed; triangles keep their flags, cover flags, door links, cover and links to other
 * NavMeshes. An edit that would leave a triangle clockwise or an edge shared by three triangles
 * throws, with a message for the user.
 */
import type { Vec3 } from '../catalogue/types';
import type { NavMeshData, NavTriangle } from '../format/esp/navm';
import { NAV_TRIANGLE_DEFAULT_FLAGS, searchGrid } from './build';
import { removeTriangles } from './stitch';

const edgeKey = (u: number, v: number) => (u < v ? `${u}:${v}` : `${v}:${u}`);

/** Signed doubled area in plan: positive when counter-clockwise seen from above. */
function orientation(a: Vec3, b: Vec3, c: Vec3): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/**
 * Recomputes the neighbours across every edge that is not an edge link, and the search grid.
 * Throws on a clockwise triangle or an edge shared by more than two triangles.
 */
export function relink(nav: NavMeshData): NavMeshData {
  const V = nav.vertices;
  nav.triangles.forEach((t, i) => {
    const [a, b, c] = t.vertices;
    if (orientation(V[a]!, V[b]!, V[c]!) <= 0)
      throw new Error(`triangle ${i} would be flipped or flat`);
  });
  const owners = new Map<string, { t: number; k: number }[]>();
  nav.triangles.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const id = edgeKey(t.vertices[k]!, t.vertices[(k + 1) % 3]!);
      owners.set(id, [...(owners.get(id) ?? []), { t: i, k }]);
    }
  });
  const edges = nav.triangles.map(() => [-1, -1, -1] as [number, number, number]);
  for (const [id, list] of owners) {
    if (list.length > 2) throw new Error(`edge ${id} would be shared by ${list.length} triangles`);
    if (list.length !== 2) continue;
    const [a, b] = list as [{ t: number; k: number }, { t: number; k: number }];
    edges[a.t]![a.k] = b.t;
    edges[b.t]![b.k] = a.t;
  }
  const triangles: NavTriangle[] = nav.triangles.map((t, i) => {
    // an edge welded to a neighbour is no longer a link to another NavMesh
    let flags = t.flags;
    const e = t.edges.map((link, k) => {
      if (!(t.flags & (1 << k))) return edges[i]![k]!;
      if (edges[i]![k]! >= 0) {
        flags &= ~(1 << k);
        return edges[i]![k]!;
      }
      return link;
    }) as [number, number, number];
    return { ...t, edges: e, flags };
  });
  return {
    ...nav,
    triangles,
    grid: searchGrid(
      V,
      triangles.map((t) => t.vertices),
    ),
  };
}

/**
 * Merges vertices into one, at their mean. Triangles that collapse (two corners merged) are
 * removed, unused vertices dropped.
 */
export function mergeVertices(nav: NavMeshData, merge: readonly number[]): NavMeshData {
  const set = [...new Set(merge)];
  if (set.length < 2) throw new Error('select at least two vertices to merge');
  const into = set[0]!;
  const mean = [0, 1, 2].map(
    (a) => set.reduce((s, v) => s + nav.vertices[v]![a]!, 0) / set.length,
  ) as unknown as Vec3;
  const vertices = nav.vertices.map((p, i) => (i === into ? mean : p));
  const gone = new Set(set.slice(1));
  const triangles = nav.triangles.map((t) => ({
    ...t,
    vertices: t.vertices.map((v) => (gone.has(v) ? into : v)) as [number, number, number],
  }));
  const collapsed = triangles.flatMap((t, i) => (new Set(t.vertices).size < 3 ? [i] : []));
  return relink(removeTriangles({ ...nav, vertices, triangles }, collapsed));
}

/** Adds a triangle on three vertices of the mesh (wound counter-clockwise whatever the order). */
export function addTriangle(nav: NavMeshData, corners: readonly number[]): NavMeshData {
  const set = [...new Set(corners)];
  if (set.length !== 3) throw new Error('select exactly three vertices');
  const a = set[0]!;
  let [b, c] = [set[1]!, set[2]!];
  const V = nav.vertices;
  const o = orientation(V[a]!, V[b]!, V[c]!);
  if (Math.abs(o) < 1e-6) throw new Error('the three vertices are aligned');
  if (o < 0) [b, c] = [c, b];
  const same = new Set([a, b, c]);
  if (nav.triangles.some((t) => t.vertices.every((v) => same.has(v))))
    throw new Error('this triangle already exists');
  return relink({
    ...nav,
    triangles: [
      ...nav.triangles,
      {
        vertices: [a, b, c],
        edges: [-1, -1, -1],
        flags: NAV_TRIANGLE_DEFAULT_FLAGS,
        coverFlags: 0,
      },
    ],
  });
}

/**
 * Joins `other` into `into` (one record, D36): its vertices and triangles are appended, its
 * door links, cover and links to third NavMeshes follow. Links between the two (FormIDs
 * `intoId` and `otherId`) are dropped: those edges become plain borders, or neighbours once
 * welded. Returns the joined mesh and the offset `other`'s triangles moved by.
 */
export function joinNavMeshes(
  into: NavMeshData,
  other: NavMeshData,
  intoId: number,
  otherId: number,
): { nav: NavMeshData; offset: number } {
  const vo = into.vertices.length;
  const to = into.triangles.length;
  const lo = into.edgeLinks.length;
  const edgeLinks = [...into.edgeLinks, ...other.edgeLinks];
  const between = (l: number) => {
    const link = edgeLinks[l]!;
    return link.navMesh === intoId || link.navMesh === otherId;
  };
  const triangles: NavTriangle[] = [
    ...into.triangles,
    ...other.triangles.map((t) => ({
      ...t,
      vertices: t.vertices.map((v) => v + vo) as [number, number, number],
      edges: t.edges.map((e, k) => (t.flags & (1 << k) ? e + lo : e < 0 ? e : e + to)) as [
        number,
        number,
        number,
      ],
    })),
  ].map((t) => {
    let flags = t.flags;
    const edges = t.edges.map((e, k) => {
      if (!(t.flags & (1 << k)) || !between(e)) return e;
      flags &= ~(1 << k);
      return -1;
    }) as [number, number, number];
    return { ...t, edges, flags };
  });
  return {
    nav: relink({
      ...into,
      vertices: [...into.vertices, ...other.vertices],
      triangles,
      edgeLinks,
      doorLinks: [
        ...into.doorLinks,
        ...other.doorLinks.map((d) => ({ ...d, triangle: d.triangle + to })),
      ],
      cover: [...into.cover, ...other.cover.map((c) => c + to)],
    }),
    offset: to,
  };
}

/**
 * Points the edge links of a third NavMesh that targeted `fromId` at `toId`, its triangles
 * moved by `offset` (after `joinNavMeshes`). Undefined when nothing changes.
 */
export function retargetLinks(
  nav: NavMeshData,
  fromId: number,
  toId: number,
  offset: number,
): NavMeshData | undefined {
  if (!nav.edgeLinks.some((l) => l.navMesh === fromId)) return undefined;
  return {
    ...nav,
    edgeLinks: nav.edgeLinks.map((l) =>
      l.navMesh === fromId ? { ...l, navMesh: toId, triangle: l.triangle + offset } : l,
    ),
  };
}
