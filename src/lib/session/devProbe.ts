/**
 * Dev only: a console probe of the catalogue the browser built (V5 step 4, a face the browser
 * kept while the same code in Node dropped it). `__sdp.piece('DweFacadeHallSm1way01')` prints a
 * piece's faces as analysed, as annotated, and in the editor's catalogue.
 */
import { KITS } from '$lib/catalogue/kits';
import { editorStore } from '$lib/editor/editorStore.svelte';
import { annotationStore } from './annotationStore.svelte';
import { catalogueStore } from './catalogueStore.svelte';

const faces = (p: { faces: readonly { dir: string; confirm?: true }[] } | undefined) =>
  p ? p.faces.map((f) => f.dir + (f.confirm ? '?' : '')).join(' ') : '(none)';

export function installDevProbe(): void {
  (window as unknown as { __sdp: unknown }).__sdp = {
    piece(editorId: string) {
      for (const kit of KITS) {
        const analysis = catalogueStore.analysisOf(kit);
        const raw = analysis?.catalogue.pieces.find((p) => p.editorId === editorId);
        if (!raw) continue;
        const analysed = analysis!.pieces.find((p) => p.stat.editorId === editorId);
        return {
          kit: kit.kit,
          kitConfirmOpenVerts: kit.confirmOpenVerts,
          analysisKitConfirmOpenVerts: analysis!.kit.confirmOpenVerts,
          openingsRim: analysed?.openings.map((o) => `${o.dir}:${o.rim}`).join(' '),
          analysed: faces(raw),
          annotation: annotationStore.currentOf(kit.kit).pieces[editorId],
          editor: faces(editorStore.catalogue?.pieces.find((p) => p.editorId === editorId)),
        };
      }
      return 'not found in any analysis';
    },
  };
}
