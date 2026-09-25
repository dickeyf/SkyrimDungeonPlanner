# Handoff point

Where the work stands, and where to resume. The project moves forward one step at a time, with
the reason for each step. Code, comments, tests, UI and docs in English.

## Read in order
`00-overview.md` → `01-decisions.md` → `02-data-model.md` → `03-risks.md` → `04-roadmap.md` →
`07-plan-v1.md`. The architecture is documented in `../arch/`.

## Where we are (25 Sep 2026)
- **V1 is done and released as 0.1.0** (beta, pre-release on GitHub, D63): Imperial kit, one Z
  level, plugins and cells created or edited in place, assistant offering only pieces that fit
  every neighbour, junction checks on the face profiles, safe saving with backups.
- Phase 0 (proofs of concept) is complete except R2 (two NAVMs in one cell), a manual CK test
  that belongs to phase 3. Phases 1 (catalogue) and 2 (editor) are complete.
- Published on GitHub (`dickeyf/SkyrimDungeonPlanner`, public, GPL v3) with CI, CodeQL, a
  security scan (npm audit, Trivy), the single-file build attached to releases, and a Docker
  image on GHCR. Builds run on Node 24 LTS; Dependabot groups minor updates and ignores
  TypeScript 7 until the tooling supports it.
- The V1 steps and their results: `07-plan-v1.md`. The decisions: `01-decisions.md` (D1–D63),
  with how every V1 question was settled.

## Next
**V2 (release 0.2.0)**, chosen on 25 Sep 2026: texture continuity (14b), the deep junction check
(R16) and a basic NavMesh (phase 3). Step plan: `08-plan-v2.md`, starting with the NavMesh
proofs of concept (R2, NAVM round trip, R1, R4) and R16's proof of concept.
