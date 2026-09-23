# Plan d'implémentation V1 (kit Impérial, un seul Z)

Détaille les phases 0 à 2 de `04-roadmap.md` en étapes livrables, dans l'ordre d'exécution
proposé. Chaque étape dit **pourquoi** elle vient à ce moment, ce qu'elle produit, et
quand elle est finie. Une étape = une session de travail courte, terminée par `npm test`
et `npm run check` au vert quand il y a du code.

Critère de réussite V1 (V14) : *un donjon impérial de 30 tuiles sur un Z en moins de 10
minutes, ouvert dans le CK sans erreur ni fente visible.*

## Hypothèses retenues pour ce plan

Les recommandations de `01-decisions.md` (« Reste à décider pour la V1 ») sont prises telles
quelles : V1 édition de cellules existantes seulement, V2 embrasures STAT seulement,
V3 meshes réels non texturés, V4 rotation 90° + undo/redo, V5 sauvegarde explicite,
V6 ESL refusés, V7 prototypage Python puis portage TS, V8 validation dans la même SPA,
V9 annotations par EditorID, V10 ancrage par meilleur ajustement, V12 pages statiques.
Les lignes « Proposé » D15, D21–D23, D43–D47 sont aussi supposées acquises. Chaque
étape indique quand une de ces hypothèses devient engageante ; c'est le moment de la
contredire si besoin.

Convention de code : code, commentaires, tests et UI en anglais ; ces docs en français.

## Étape 0 – Squelette (fait le 21 sept. 2026)

Vite + Svelte 5 + TypeScript + three.js + Vitest, ESLint, Prettier, config IntelliJ.
`src/lib/binary` (lecteur/écrivain little-endian testés), types du catalogue et de la
grille (`src/lib/catalogue`, `src/lib/grid`), stubs des modules, `poc/` et `tools/`.
Extracteur BSA en Python (`tools/bsa.py`, `tools/bsa_extract.py`) testé sur l'installation
réelle.

---

## Phase 0 – Tests de concept

Ordre : du moins cher au plus cher, et les résultats de R5 nourrissent tout le reste.

### Étape 1 – R5 : module et pivots du kit Impérial (Python) — FAIT (21 sept. 2026)
Résultats dans `03-risques.md` (R5) sur les 5 sous-kits : 105 tuiles sur 113 tiennent sur le
module 128 (D51 décidé), pivot toujours au centre (D52), le z des faces va dans le profil
(D55). Le dossier `door/` = objets DOOR, hors catalogue de tuiles.

- **Pourquoi d'abord** : tout le modèle de données (`pivot`, `cells`, module de grille)
  repose sur des mesures que personne n'a encore faites. Sans elles, la grille, la
  dérivation d'une cellule (R10) et le catalogue sont bloqués.
- **Quoi** : `tools/r5_module_pivots.py` sur les NIF `dungeons\imperial\` extraits du BSA
  (couloirs, salles, portes). Par pièce : bounds, position du pivot, étendue du plancher,
  vertex extrêmes en X/Y. Sortie CSV/JSON dans `tools/out/`.
- **Fini quand** : un module XY (et Z) cohérent se dégage, et chaque pièce testée se
  décrit par `pivot` + `cells`. Les valeurs sont reportées dans `02-modele-de-donnees.md`
  (section Kit) et dans une décision D51.
- **Dépend de** : Python + pynifly (`tools/README.md`). Les NIF s'extraient avec
  `tools/bsa_extract.py` (fait le 21 sept. 2026 : 435 NIF impériaux, lecteur BSA v105 en
  Python qui servira de référence au portage TypeScript de l'étape 4).

### Étape 2 – R3 : signatures de faces (Python) — FAIT (21 sept. 2026)
Résultat dans `03-risques.md` (R3) : 15 groupes sur 304 faces, structure du kit retrouvée,
tolérance 8 unités, décalcomanies et décor exclus. Deux cas pour la validation humaine
(étape 10) : côtés 512 des grandes salles, tuiles `implhalldoor*`.

- **Pourquoi** : décide si le catalogue se construit automatiquement (analyse de mesh)
  ou à la main (repli). Le repli reste viable, mais l'architecture du catalogue en dépend.
- **Quoi** : `tools/r3_face_signatures.py` sur 10–15 pièces de compatibilité connue :
  arêtes ouvertes sur chaque plan de jonction (à ± tolérance du bord de cellule mesuré à
  l'étape 1), polylignes normalisées, regroupement avec tolérance, miroir testé.
- **Fini quand** : paires compatibles = même groupe, incompatibles = groupes différents,
  faces fermées = vides. La tolérance retenue et le nombre de groupes sont notés.
- **Dépend de** : étape 1 (module, position des plans de jonction).

### Étape 3 – R14a : accès disque depuis le navigateur — FAIT (21 sept. 2026)
`src/lib/fs` (résolution de chemins insensible à la casse, lecture par plage, écriture atomique,
handles dans IndexedDB, permissions, reconnaissance du dossier du jeu) avec 16 tests sur des
handles factices et `fake-indexeddb` ; page `poc/r14a-fs.html` validée dans Chrome : handle
restauré avec permission `granted` sans clic, lecture par plage 0,8 ms, écriture 67 ms.
Résultat dans `03-risques.md` (R14a). D42 et D43 confirmés.

- **Pourquoi** : première brique navigateur, la moins risquée, et prérequis des deux
  suivantes. Vérifie aussi que le plugin peut être écrit en place.
- **Quoi** : `poc/r14a-fs.html` + `src/lib/fs` : choisir le dossier Data, conserver le
  handle dans IndexedDB, le relire à la session suivante, écrire un fichier de test en
  place (écriture atomique via `createWritable`).
- **Fini quand** : aucun re-choix de dossier après rechargement ; fichier écrit et relu.
- **Engage** : D42, D43.

### Étape 3b – R15 : vue « Data virtuel » MO2 — FAIT (21 sept. 2026, validé contre MO2)
- **Pourquoi maintenant** : l'installation de référence est un « Game Root » stock + MO2, montage très courant chez les modders ; les
  DLC et le plugin de travail sont dans `mods/*`. Sans cette vue, l'outil ne trouve ni les
  masters ni le plugin à écrire (D49 révisé).
- **Quoi** : `src/lib/vfs` : lecture de l'instance MO2 (`ModOrganizer.ini` → profil,
  `modlist.txt` → mods activés par priorité, `plugins.txt`/`loadorder.txt` → ordre de
  chargement), superposition ordonnée des dossiers de mods sur `Data` (aucune copie), ordre
  des archives. 9 tests sur une instance factice. Page `poc/r15-mo2.html`.
- **Fini quand** : la page montre le bon profil, l'ordre des mods **concorde avec le panneau
  gauche de MO2** (vérifie l'hypothèse « premier de `modlist.txt` = plus prioritaire »),
  `Dawnguard.esm` et le plugin de travail sont trouvés dans leur dossier de mod, et la liste
  des archives commence par `Skyrim - Misc.bsa` et finit par celles des derniers plugins.
- **Engage** : D42 (complété), D49 (révisé), D50.

### Étape 4 – R14b : BSA + NIF + affichage WebGL — FAIT (21 sept. 2026, validé dans Chrome)
`src/lib/compress/lz4.ts` (blocs + frames), `src/lib/format/bsa` (tables lues en une lecture
ciblée, fichiers par lecture ciblée, LZ4), `src/lib/format/nif` (arbre de nœuds, BSTriShape,
fusion des formes, boîte englobante) : portages de `tools/bsa.py` et `tools/nif.py`. 18 tests
sur des fixtures synthétiques générées par `tools/make_fixtures.py` (aucun fichier du jeu dans
le dépôt). Page `poc/r14b-bsa-nif.html` : cherche le mesh dans la vue Data virtuelle (fichier
libre, sinon la dernière archive de l'ordre de chargement qui le contient) et l'affiche en
three.js, caméra orthographique de dessus, grille de 128. Mesuré pour `imphall1way01` :
2230 sommets, 256 × 256 × 307,5, boîte de -128 à 128 en XY, LZ4 1,9 ms, parsing 1,1 ms.
Résultat dans `03-risques.md` (R14b). D45 et D46 confirmés pour la lecture.

- **Pourquoi** : le catalogue se construit dans le navigateur (D46) et le rendu utilise
  les vrais meshes (V3). Si cette brique échoue, l'extraction bascule vers un utilitaire
  local et le plan change.
- **Quoi** : `src/lib/format/bsa` (en-tête v105, dossiers/fichiers, lecture par tranches
  d'un seul fichier, LZ4), `src/lib/format/nif` (en-tête, blocs, BSTriShape → vertex et
  triangles), `poc/r14b-bsa-nif.html` qui affiche une tuile impériale en three.js avec
  une grille au module mesuré à l'étape 1.
- **Fini quand** : la tuile s'affiche à la bonne échelle, sans charger le BSA complet.
- **Tests** : BSA et NIF synthétiques minuscules construits en code (pas de fichiers du
  jeu dans le dépôt).
- **Engage** : D45, D46.

### Étape 5 – R14c : ESP aller-retour, puis ajout d'une REFR — FAIT (22 sept. 2026, validé dans xEdit et le CK)
`src/lib/format/esp` : records et groupes opaques (tailles de groupes recalculées), sous-records
avec `XXXX`, records compressés (zlib via `DecompressionStream`), TES4 (HEDR, masters, refus des
ESL), CELL/REFR décodés, `Plugin.addRefr` / `moveRefr` / `deleteRefr` limités aux records propres
au plugin (D22) avec `nextObjectId` et `numRecords` tenus à jour, FormKey ↔ FormID. 12 tests sur un
plugin synthétique (`testPlugin.ts`). Page `poc/r14c-esp.html` : aller-retour comparé octet par
octet sur le vrai plugin, puis ajout d'une REFR (copie d'une tuile existante élevée de 512) écrite
dans une **copie** `<plugin>.r14c.esp` à ouvrir dans xEdit et le CK.

- **Pourquoi** : c'est la brique qui rend le tout utile : sans écriture fiable du plugin,
  pas de V1. Fusionne R6.
- **Quoi**, en deux temps :
  1. `src/lib/format/esp` : TES4, arbre GRUP, records opaques ; réécriture identique
     octet pour octet sur une copie du plugin de travail.
  2. Décodage de CELL (interior) et REFR ; ajout d'une REFR dans le groupe « temporary
     children » d'une cellule ; mise à jour des tailles de groupes, du compteur de
     records et du `nextObjectId` de HEDR ; refus des plugins ESL.
- **Fini quand** : 1) `diff` binaire vide ; 2) le plugin modifié s'ouvre dans xEdit et le
  CK sans erreur et la REFR apparaît au bon endroit.
- **Engage** : D21, D22, D47, V6.

### Étape 6 – R10 : dériver la grille d'une cellule existante — FAIT (22 sept. 2026, validé sur la cellule du mod de travail)
`src/lib/grid/derive.ts` (classement des refs : base inconnue / échelle / inclinaison /
rotation hors 90° / hors grille ; coin d'empreinte = position − R·pivot ; ancrage par le
résidu modulo le module partagé par le plus de refs, posé sur le coin le plus bas ;
empreintes tournées ; chevauchements) avec 8 tests. Convention de rotation : le cap Skyrim
(0 = +Y, positif = horaire vu de dessus) devient −rz en quarts de tour antihoraires, à
confirmer sur la cellule réelle. `src/lib/format/esp/scan.ts` lit un seul groupe de tête de
`Skyrim.esm` par lecture ciblée (STAT 2,9 Mo, CELL 35 Mo) ; `stat.ts` décode EDID/MODL/OBND.
Catalogue provisoire = STAT impériaux de `Skyrim.esm` joints aux mesures R5
(`poc/data/imperial-pieces.json`, 111 tuiles, `tools/export_r5_catalogue.py`). Page
`poc/r10-grid.html` : cellule du plugin de travail ou cellule vanilla filtrée par EditorID,
compte des tuiles reconnues / opaques par raison, bases inconnues les plus fréquentes, carte
2D des empreintes.

- **Pourquoi** : la V1 édite des cellules existantes (V1) ; il faut savoir quelle part des
  refs sera reconnue comme tuile et comment la grille s'ancre.
- **Quoi** : `src/lib/grid/derive.ts` (ref → `{cell, rotation}` ou opaque, ancrage par
  meilleur ajustement) + `poc/r10-grid.html` : pour une cellule impériale vanilla et une
  cellule du mod de travail, tableau des refs reconnues / opaques et raison.
- **Fini quand** : la grande majorité des tuiles structurelles est reconnue ; le reste est
  affiché opaque sans gêner.
- **Dépend de** : étapes 1 (pivots de quelques pièces, saisis à la main) et 5 (lecture des
  REFR).
- **Engage** : D23, V10.

### Étape 7 – R2 : deux NAVM dans une cellule (manuel, CK)
- **Pourquoi ici** : hors chemin critique de la V1 (NavMesh = phase 3), mais gratuit en
  code et à faire quand le CK est ouvert de toute façon (étape 5). Peut se faire à tout
  moment avant la phase 3.
- **Fini quand** : pathing d'un PNJ continu à travers la couture après Finalize, ou repli
  noté dans `03-risques.md`.

**Jalon phase 0 — atteint le 22 sept. 2026** : R5, R3, R14a, R15, R14b, R14c et R10 prouvés
(`03-risques.md`), décisions D51 à D57 prises. Seul R2 (test manuel de deux NavMesh dans le
CK) reste ouvert ; il ne concerne que la phase 3.

---

## Phase 1 – Catalogue Impérial

### Étape 8 – Extraction des STAT impériaux depuis Skyrim.esm — FAIT (22 sept. 2026)
Première structure de l'application (plus une page de test) : `src/App.svelte` avec navigation
par hash, `src/pages/{Home,Setup,Catalogue}Page.svelte`, session en runes Svelte 5
(`src/lib/session/session.svelte.ts`) au-dessus de la vue Data virtuelle déplacée dans
`src/lib/session/dataView.ts`. Catalogue : `src/lib/catalogue/kits.ts` (définition du kit
Impérial, module 128 comme donnée), `extract.ts` (classification par sous-dossier et nom :
hall / room / door / other, props reconnus par nom), `build.ts` (lecture ciblée du groupe STAT
de `Skyrim.esm`, cache IndexedDB clé sur taille + date du master). Page Catalogue : compteurs
par catégorie et par sous-dossier, filtre, tableau EditorID / sous-dossier / catégorie / bounds
/ modèle. **Mesuré dans l'app** : 9720 STAT dans `Skyrim.esm`, 525 impériaux, extraits en
110 ms ; **111 pièces structurelles** = 48 hall + 35 room + 28 door (`largeroom` 34,
`largehall` 31, `smallhall` 25, `smallroom` 21), exactement les 111 tuiles mesurées par R5 ;
414 « other » (exteriorice 154, clutterkits 110, exterior 91, tower 19, stablekit 15,
exteriorhelgen 9, jail 6, portcullis 6, door 1). `largeroom` a 36 STAT pour 35 NIF : deux
objets de base partagent un mesh, d'où l'indexation par FormKey.

- **Pourquoi** : c'est la liste de pièces de référence ; tout le reste de la phase la
  consomme.
- **Quoi** : décodage STAT (EDID, MODL, OBND) dans `src/lib/format/esp` ; filtre par
  chemin de modèle `dungeons\imperial\` ; classification `hall` / `room` / `door` /
  `other` par sous-dossier et suffixes d'EditorID (à corriger à l'étape 10). `door` = les
  tuiles `*door*` de `smallhall`/`largehall`/`smallroom`/`largeroom` ; le sous-dossier
  `door/` (objets DOOR) et les `brace`/`pillar` sont des props, hors V1.
- **Fini quand** : la liste s'affiche dans une page de la SPA avec compteurs par
  catégorie ; le nombre de pièces est noté dans les docs.

### Étape 9 – Portage TypeScript de l'analyse de mesh (R5 + R3) — FAIT (22 sept. 2026, vérifié dans l'app)
`src/lib/mesh` : géométrie soudée et arêtes ouvertes (`geometry.ts`), détection des ouvertures
(`openings.ts`), empreinte, phase de grille, cellules normalisées et pivot (`footprint.ts`),
profils de faces en coordonnées locales (`profiles.ts`), comparaison avec tolérance, miroir et
regroupement (`signatures.ts`) : ports fidèles de `tools/kit_geometry.py`, `r5_module_pivots.py`
et `r3_face_signatures.py`, testés sur un couloir synthétique (9 tests). `src/lib/vfs/archiveIndex.ts`
trouve chaque mesh (fichier libre, sinon dernière archive de l'ordre de chargement).
`src/lib/catalogue/analyze.ts` orchestre : lecture des 111 NIF structurels, analyse, groupes de
signatures → `ConnectionType`, `Piece` avec `pivot`, `cells` et `faces` par cellule (une face par
cellule couverte, même type ; les demi-profils gauche/droite viendront à l'étape 10 si utile).
Page Catalogue : « Analyze meshes » avec progression, types de connexion, correspondances
« presque », tableau par pièce, et **comparaison automatique avec les mesures Python**
(`poc/data/imperial-pieces.json`). Le catalogue est sauvé dans IndexedDB (`catalogue:Imperial`).
**Mesuré dans l'app** : 111 pièces analysées, 0 échec, 304 faces en 15 types de connexion,
384 correspondances « presque », en 9,2 s (Python : 17 s) ; **111 empreintes et pivots sur 111
identiques aux mesures Python**, mêmes groupes et mêmes miroirs que R3. Catalogue sauvé dans
IndexedDB. Le catalogue se construit donc entièrement dans le navigateur (D46 validé).

- **Pourquoi** : les algorithmes sont prouvés en Python (V7) ; ils doivent tourner dans le
  navigateur de chaque utilisateur (D46).
- **Quoi** : `src/lib/catalogue/analyze.ts` : NIF → `pivot`, `cells`, profils de faces →
  groupes de signatures → `ConnectionType` proposés (exact = automatique, presque = à
  valider). Vérifié contre les sorties Python de `tools/out/` sur les mêmes pièces.
- **Fini quand** : mêmes résultats que les scripts Python sur l'échantillon R3.
- **Si R3 a échoué** : cette étape devient « saisie manuelle assistée par EditorID » et
  la suivante grossit.

### Étape 10 – Page de validation du catalogue
Découpée en 4 livraisons : 1) format et moteur d'annotations, 2) page de validation en
lecture avec aperçu des profils, 3) édition, 4) écriture dans le dépôt et passe de validation.
**Livraison 1 faite (22 sept. 2026)** : `src/lib/catalogue/annotations.ts` ; fichier
`data/annotations/imperial.json` (vide). Clés = EditorID et `EditorID:dir`, jamais les G de
l'analyse ; noms de types via une face représentative, fusions de « presque », types
supplémentaires des faces composites (`Face.extraConn`, D56, pris en compte par
`facesMate`), exclusion / catégorie / validation par pièce ; problèmes signalés (faces ou
pièces inconnues, conflits de noms) sans échec ; sérialisation triée pour des diffs lisibles.
7 tests.

- **Pourquoi** : l'analyse propose, un humain dispose (D12) ; sans validation, l'assistant
  contextuel proposera des pièces fausses.
- **Quoi** : page de la SPA (V8) : liste des pièces, vignette three.js, faces avec type
  proposé, superposition des deux profils pour les « presque », nommage des types,
  correction manuelle, marquage `validated`. Export des **annotations** (par EditorID,
  V9) dans un JSON distribué avec l'outil ; le catalogue complet reste local.
- **Fini quand** : couloirs, salles et portes impériaux validés ; `catalogue.json` V1
  généré et rechargé sans re-analyse.
- **Engage** : D46, V8, V9.

**Jalon phase 1** : catalogue Impérial validé, chargeable en < 1 s depuis IndexedDB.

---

## Phase 2 – Éditeur V1

Ordre pensé pour avoir quelque chose de visible tôt, puis d'éditable, puis d'écrit.

### Étape 11 – Configuration et chargement d'une cellule
- **Pourquoi** : porte d'entrée de l'outil ; réutilise directement les étapes 3, 5 et 6.
- **Quoi** : écran de configuration (dossier Data, plugin, mémorisés) ; liste des
  cellules intérieures du plugin ; chargement → `TilePlacement[]` + `OpaqueRef[]` +
  ancrage de grille. Modèle d'état de l'éditeur (`src/lib/editor`) en runes Svelte 5.
  L'accès au plugin passe par une interface « magasin de niveau » (D57) dont `.esp` est le
  premier backend, pour brancher Spriggit en phase 6 sans toucher l'éditeur.
- **Fini quand** : la cellule du mod de travail se charge et la liste des refs reconnues / opaques
  s'affiche.

### Étape 12 – Rendu : grille, tuiles, pan/zoom
- **Pourquoi** : le designer doit voir le niveau avant de le modifier.
- **Quoi** : `src/lib/render` : scène three.js, caméra orthographique de dessus, grille
  au module, meshes réels non texturés ombrés (V3) chargés du BSA avec cache par modèle,
  refs opaques en gris, pan/zoom souris, sélection par clic (raycast).
- **Fini quand** : la cellule du mod de travail s'affiche lisiblement, 60 fps sur 100 tuiles.
- **Engage** : D44, V3.

### Étape 13 – Édition : ajouter, déplacer, supprimer, tourner, undo/redo
- **Pourquoi** : cœur de l'outil ; logique pure dans `src/lib/grid` testable sans DOM.
- **Quoi** : occupation des cellules, détection de chevauchement (refus + surbrillance),
  rotation 90°, déplacement par glisser avec snap, suppression, pile undo/redo par
  commandes, palette de pièces filtrée par catégorie.
- **Fini quand** : tests unitaires sur occupation/chevauchement/rotation ; scénario
  manuel : construire 10 tuiles, défaire tout, refaire tout.
- **Engage** : V4.

### Étape 14 – Assistant contextuel : clic sur une face ouverte
- **Pourquoi** : c'est la promesse principale de l'outil (« ne propose que ce qui
  s'emboîte »).
- **Quoi** : faces ouvertes libres = faces `conn` dont la cellule voisine est vide ;
  surbrillance ; au clic, liste des pièces dont une face `mate` peut se placer là
  (toutes rotations testées), aperçu fantôme au survol, pose au clic.
- **Fini quand** : sur une cellule vide, on enchaîne couloir → coin → salle → porte sans
  jamais choisir une pièce incompatible ; tests unitaires sur la recherche de candidats.

### Étape 15 – Sauvegarde en place dans le plugin
- **Pourquoi** : sans elle, rien n'arrive dans le CK. Dernière car la plus destructive.
- **Quoi** : bouton explicite (V5) ; copie de sauvegarde horodatée (D47) ; refs existantes
  conservées (FormID), nouvelles refs créées, refs supprimées retirées ; avertissement
  « fermer ou recharger le CK » ; refus si plugin ESL.
- **Fini quand** : cycle charger → modifier → sauver → recharger → identique ; le plugin
  s'ouvre dans le CK, les tuiles sont à leur place, aucune fente.
- **Engage** : D21, D22, D47, V5.

### Étape 16 – Jalon V1 : test du critère de réussite
- **Quoi** : chronométrer la construction d'un donjon de 30 tuiles à partir d'une cellule
  vide dupliquée dans le CK ; ouvrir dans le CK ; noter les frictions dans `05-idees.md`.
- **Fini quand** : < 10 minutes, aucune erreur CK, aucune fente. Sinon : liste des
  corrections, et on itère sur 12–15.

---

## Après la V1
Phase 3 (NavMesh), 4 (Z), 5 (props), 6 (mode Spriggit, D57) : voir `04-roadmap.md`. Rien dans les étapes
ci-dessus ne doit fermer ces portes : `cells` reste 3D, `Piece.walkable` / `obstacle` /
`ConnectionType.navEdge` restent dans le format même s'ils valent `null`.
