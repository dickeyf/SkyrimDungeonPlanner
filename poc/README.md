# Proof-of-concept pages (phase 0)

One throwaway HTML page per browser-side risk from `docs/design/planning/03-risks.md`. Each page is picked
up automatically by `vite.config.ts` and served at `/poc/<name>.html` in dev.

| Page                | Risk              | Success criterion                                                                                                                        |
| ------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `r14a-fs.html`      | Disk access       | Pick the Data folder, reload, handle restored without re-picking; write a file in place.                                                 |
| `r14b-bsa-nif.html` | BSA + NIF + WebGL | Read one Imperial NIF straight from the archives (via the MO2 overlay when saved) and draw it at the right scale on the 128 grid.        |
| `r14c-esp.html`     | ESP in place      | Parse a plugin from the virtual Data view, rewrite it byte-identical, add a REFR to a `.r14c.esp` copy and check it in xEdit and the CK. |
| `r10-grid.html`     | Grid derivation   | On a vanilla Imperial cell and the working plugin's cell, count how many kit refs land on the grid.                                      |
| `r15-mo2.html`      | MO2 overlay       | Read the MO2 instance, overlay mod folders on Data, check priority order against MO2's pane.                                             |

Pages import from `src/lib` through the `$lib` alias so the code they prove moves into the
app unchanged.
