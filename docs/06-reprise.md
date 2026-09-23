# Point de reprise (Claude Code)

Contexte : ces documents résument une session de planification du 21 sept. 2026. Le squelette du projet a été créé le même jour (étape 0 de `07-plan-v1.md`). Le projet avance une étape à la fois, avec la raison de chaque étape. Code, commentaires, tests et UI en anglais ; docs en français.

## À lire dans l'ordre
`00-apercu.md` → `01-decisions.md` → `02-modele-de-donnees.md` → `03-risques.md` → `04-roadmap.md` → `07-plan-v1.md`.

## Où on en est
- Exigences structurantes tranchées : Impérial d'abord (couloirs, salles, portes), un seul Z en V1, .esp comme source de vérité, types de connexion par face, SPA Chromium sans backend, bake sur demande pour le NavMesh (phase 3).
- Reste à trancher : le tableau « Reste à décider pour la V1 » de `01-decisions.md` (V1–V14) et les lignes « Proposé ».

## Pile décidée
TypeScript + Vite + Svelte 5 + three.js (V11), Vitest pour les tests. Parseurs et géométrie en TypeScript pur, indépendants du framework. Squelette : `src/lib/{binary,format,catalogue,grid,fs,render,editor}`, pages de test dans `poc/`, scripts Python dans `tools/`. Voir `README.md` et `CLAUDE.md`.

## Prochaine action suggérée
Suivre `07-plan-v1.md` : étape 1 (R5) faite sur les 5 sous-kits V1 le 21 sept. 2026
(D51, D53, D54 décidés ; D52, D55 proposés). Étape 2 (R3) faite le même jour : l'analyse de mesh
est prouvée (D12), 15 groupes sur 304 faces. Étape 3 (R14a) faite et validée dans Chrome le
21 sept. 2026. Étape 3b (R15, vue Data virtuel MO2) faite et validée
contre MO2. Étape 4 (R14b) faite et validée dans Chrome.
Étape 5 (R14c) faite et validée le 22 sept. 2026
(aller-retour identique, REFR ajoutée acceptée par xEdit et le CK). Étape 6 (R10) faite et validée le 22 sept. 2026 :
**phase 0 terminée** (seul R2, manuel et propre à la phase 3, reste ouvert). Étape 8 faite et vérifiée dans l'app (111 pièces
structurelles sur 525 STAT impériaux). Phase 1 terminée le 22 sept. 2026 : catalogue Impérial construit
dans le navigateur et validé (105 tuiles, annotations dans `data/annotations/imperial.json`).
Étape 11 faite le même jour (plugin de travail ouvert dans l'app, cellule chargée :
205 tuiles reconnues). Prochaine action = **étape 12** : rendu three.js de la cellule (caméra
orthographique de dessus, grille au module du kit, meshes réels non texturés, objets non
éditables en gris, pan/zoom, sélection au clic).

Un échec de R3 ne tue pas le projet (repli : saisie manuelle). Un échec de R14b/c déplace l'extraction vers un utilitaire local ; l'éditeur reste une SPA.

## Faits vérifiés vs hypothèses
- Vérifié par recherche : pas de librairie JS/WASM prête pour écrire des plugins Skyrim ; un éditeur NIF navigateur existe pour Morrowind.
- Hypothèses non vérifiées : plusieurs NAVM reliés par Finalize dans une cellule intérieure (R2) ; vertex identiques aux jonctions des kits (R3) ; module du kit Impérial (R5) ; détails du format BSA v105 / NIF SSE / NAVM à confirmer contre les specs (UESP, nif.xml) au moment d'écrire les parseurs.
