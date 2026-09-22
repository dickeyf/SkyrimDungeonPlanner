# Risques et tests de concept

But : pouvoir tester le concept avant d'investir dans l'outil. Chaque risque a un test minimal et un critère de succès. Ordre = ordre suggéré des tests.

## Bloquants pour la V1

### R5 – Module et pivots du kit Impérial
Le module réel (XY et Z) est inconnu ; les bounds ne donnent pas l'empreinte (débordements de corniche/plinthe, ex. `impfreewall01` : coeur 384, +22 par bout) ; les pivots ne sont pas au centre.
- **Test** : script (pynifly hors Blender) sur les couloirs/salles/portes impériaux : bounds, position du pivot, étendue du plancher.
- **Succès** : un module XY cohérent se dégage et chaque pièce se décrit par `pivot` + `cells`.
- **Résultat (21 sept. 2026, `smallhall`, 25 pièces, `tools/r5_module_pivots.py`) : succès.**
  pynifly n'étant pas installable hors Blender, lecteur NIF maison (`tools/nif.py`).
  - Tuile de base 256 × 256 (XY), origine du NIF au **centre** de la tuile, sol à z = +8,
    plafond à z ≈ 307 (hauteur intérieure ≈ 300). Aucun décalage exotique : 23 pièces sur 25
    ont exactement ce pivot, les 2 autres sont les variantes descendantes (sol à -56 / -120).
  - Ouvertures : profil unique, 194 de large (198 sur deux faces +X de `3way01`/`4way01`),
    299 de haut (z 8 → 307), centré sur le côté de la tuile. Face fermée = pas de géométrie
    sur le plan, sauf une corniche z 210 → 310 (jamais confondue avec une ouverture).
  - Variantes : `128l/r` décalent la sortie de ±128 en X (pièce sur 3 cellules de 128),
    `64l/r` de ±64 ; `128u/d` et `64u/d` décalent la sortie de ±128 / ±64 en Z ;
    `128short` / `64short` font 128 / 64 de long (ouvertures à ±64 / ±32) ; les escaliers
    font 2 tuiles de long et montent de **256**.
  - Ajustement au module : 256 → 19/25, **128 → 22/25** (seules les 3 variantes « 64 »
    ne tombent pas dessus), 64 → 25/25. Les plans d'ouverture sont sur la grille à ±4 unités.
  - Débords hors cellule (corniches, retours de mur) : ≤ 6 unités, sauf `128l/r` (jusqu'à
    24 unités en deçà de la 3e cellule) ; le calcul des `cells` tolère un quart de module.
  - Heuristique d'ouverture réutilisable pour R3 : les sommets d'une ouverture sont sur des
    arêtes ouvertes (part mesurée 0,23 → 1,00), ceux d'un mur rendu jamais (0,00).
  - Décision prise : D51 (module 128), D53 (module par kit), D54 (transitions) ; D52 (pivot) proposé.
- **Résultat sur les autres sous-kits V1 (21 sept. 2026, module 128)** :
  | Sous-kit | Tuile | Cellules | Pivot (XY) | Sol (z du NIF) | Profils d'ouverture (largeur × hauteur, z du sol) | Tiennent |
  |---|---|---|---|---|---|---|
  | `smallhall` | 256 × 256 | 2 × 2 | centre | +8 | 194 × 299 @ +8 | 22 / 25 (3 variantes « 64 ») |
  | `largehall` | 512 × 512 | 4 × 4 | centre | -8 | 447 × 476 @ -8 ; escaliers 1024 de long, +512 | 28 / 31 (3 variantes « 64 ») |
  | `smallroom` | 256 × 256 | 2 × 2 | centre | +2 / -3 | 256 (côté entier, salle-salle), 225 (côté avec mur, décalé de 16), 194 × 299 @ +8 (porte vers couloir) | 21 / 22 (`brace01` = prop) |
  | `largeroom` | 512 × 512 (`doorl` : 512 × 726, 4 × 6) | 4 × 4 | centre | -34 | 512 / 414 × 770 (deux étages), 194 × 299 @ +8 (porte vers couloir, 42 au-dessus du sol de la salle) | 34 / 35 (`pillar01` = prop) |
  | `door` | — | — | — | — | aucune : ce sont les objets DOOR (portes en bois, trappes, boutons, cages), pas des tuiles | 0 / 14 (props) |
  - **Bilan : 105 tuiles structurelles sur 113 tiennent sur le module 128** ; les 8 autres sont
    les 6 variantes « 64 » (hors V1 par D51) et 2 props. Toutes les tuiles ont leur pivot au
    centre XY de la tuile.
  - **Le Z d'une face appartient au profil de connexion, pas à la cellule** : le sol des
    ouvertures varie selon la famille (+8 couloirs, -8 grands couloirs, +2/-3 petites salles,
    -34 grandes salles) et une tuile de grande salle a une face salle à -34 et une face porte
    à +8. Les cellules restent de 128 en Z ; la signature R3 inclut le z du profil.
  - **Catégorie `door` du catalogue = les tuiles à embrasure** des sous-kits hall/room
    (`imphalldoor*`, `improomdoor*`, `implroomdoor*`), qui portent le profil 194 × 299. Le
    dossier `door/` contient les objets DOOR, qui restent au CK (V2 confirmé).

### R3 – Fiabilité des signatures de mesh
Hypothèse : deux pièces compatibles ont les mêmes vertex sur leur plan de jonction.
- **Test** : sur 10–15 pièces dont on connaît la compatibilité, calculer les signatures de face (vertex sur le plan ± tolérance, coordonnées locales, quantifiés, hashés).
- **Succès** : paires compatibles = même signature (ou miroir) ; incompatibles = différentes ; faces fermées = vides. Repérer la tolérance nécessaire.
- **Points à surveiller** : coordonnées locales à la face (indépendantes de la position et de la rotation de la pièce) ; effet miroir gauche/droite entre deux faces qui se regardent ; arrondi avant hash fragile près d'une limite d'arrondi → comparer les ensembles de points avec tolérance, regrouper, puis donner un identifiant au groupe ; vertex « en trop » sur le plan (cadre de porte, décor) → au besoin ne comparer que le contour de l'ouverture.
- **Signature préférée** : les **arêtes ouvertes** du mesh (utilisées par un seul triangle) situées sur le plan de jonction, en polylignes normalisées (segments colinéaires fusionnés). Ce sont exactement les arêtes qui doivent coïncider pour ne pas voir de trou ; un vertex en trop sur un segment droit ne change rien.
- **Correspondance approximative** : score de similarité entre deux profils (part des points/segments de A retrouvés dans B à la tolérance près, et l'inverse ; miroir testé aussi). Trois paliers : exact → même type automatiquement ; presque → proposé à la validation humaine avec superposition des deux profils, jamais accepté automatiquement ; loin → types distincts. Clé grossière (largeur, hauteur, Z du plancher de l'ouverture) comme premier filtre. Comparaison faite une seule fois, à la construction du catalogue.
- **Repli** : saisie manuelle assistée par les noms d'EditorID. Le projet reste viable.
- **Résultat (21 sept. 2026, `tools/r3_face_signatures.py`, 4 sous-kits V1, 111 pièces, 304 faces) : succès.**
  - Signature = polylignes des arêtes ouvertes sur le plan de la face, en coordonnées locales
    (u vers la droite vu de l'extérieur, origine au centre des cellules couvertes ; v = z moins
    le niveau), comparées par échantillonnage avec tolérance, miroir testé.
  - Trois nettoyages ont été nécessaires, tous prévus par les « points à surveiller » :
    1. exclure les meshes à propriété alpha (décalcomanies de crasse, différentes par pièce) ;
    2. ne garder que les composantes connexes principales des arêtes ouvertes (les médaillons
       et bouts de corniche posés dans le plan ne sont pas de la jonction) ;
    3. **tolérance de 8 unités** : les jambages gauche et droit d'une même ouverture sont
       modélisés avec des sommets qui diffèrent jusqu'à 6 unités, et Bethesda raccorde
       n'importe quelle face de couloir à n'importe quelle autre.
  - **15 groupes**, qui reflètent la structure du kit : profil de porte 194 × 299 (66 faces,
    **commun à `smallhall`, `smallroom` et `largeroom`**, symétrique) ; grand couloir 447 × 476
    (60 faces, symétrique) ; petite salle côté entier 256 (24, symétrique) et côté avec mur 225
    décalé (2 groupes de 20, **miroirs l'un de l'autre**, comme D13 le prévoyait) ; grande salle
    414 en deux hauteurs (4 groupes de 16, deux paires miroir) et 512 (2 groupes de 16 miroir + 4
    faces `mid`) ; tuiles `door` du grand couloir (10) ; variantes « 64 » (2 + 2, hors V1).
  - Paires compatibles = même groupe ou groupe miroir ; incompatibles (194 / 447 / 256 / 225 /
    414 / 512) = groupes distincts, aucune confusion ; faces fermées = aucune ouverture (R5).
  - **À valider par un humain (palier « presque »)** : les côtés de 512 des grandes salles
    (3 groupes à 0,91 entre eux, en 3 paires de groupes seulement ; deux sont miroirs exacts
    l'un de l'autre à 1,00 et le troisième, les pièces `mid`, est **inclus** dans les deux
    autres) ; les deux hauteurs 770 / 728 des côtés 414 (les deux faces d'un même coin de
    grande salle ne sont pas miroir l'une de l'autre : 0,94).
  - **Profils composites, découverte de R3** : le contour du couloir 447 est inclus à 100 %
    dans celui des 10 faces `implhalldoor*`, et leur supplément (466 points, u ± 104, v 8 → 307)
    est exactement l'arc de porte 194 × 299. Ces tuiles sont des bouts de grand couloir fermés
    par un mur percé d'une petite porte : la même face se raccorde au couloir 447 (qu'elle
    ferme) **et** au couloir 194 (qu'elle ouvre). Règle à retenir : si le contour de A est
    entièrement sur le contour de B (couverture 1,00 dans un sens), A et B se raccordent sans
    fente ; les arêtes en plus de B sont sa propre structure. Le score `min` des deux sens
    (0,67 ici) ne suffit pas ; l'inclusion est un troisième critère, proposé à la validation
    humaine (D56).
  - Temps : 17 s pour 304 faces en Python ; rapport `tools/out/r3-<sous-kits>-128.json`
    avec les polylignes, réutilisable par les tests du portage TypeScript.

### R6 – Édition du plugin en place
Relire/écrire sans perdre FormID, records inconnus, ni ce que le CK a produit. Test fusionné dans **R14c** (sur une copie du plugin de travail).
- **À noter** : le plugin ne peut pas être écrit pendant que le CK l'a ouvert ; MO2/VFS – prévoir « fermer ou recharger le CK ».

### R10 – Dériver la grille d'une cellule existante
Refs légèrement décalées, tournées hors 90°, mises à l'échelle ; origine de la grille propre à chaque cellule.
- **Test** : sur une cellule impériale vanilla et la cellule du mod de travail, compter les refs de kit qui tombent sur la grille.
- **Succès** : la grande majorité des tuiles structurelles sont reconnues ; le reste s'affiche comme opaque sans gêner.
- **Résultat (22 sept. 2026, `poc/r10-grid.html`, cellule du mod de travail) : succès.**
  579 REFR → **205 tuiles reconnues, 374 opaques, toutes pour « base inconnue »** : aucune ref
  hors grille, inclinée, mise à l'échelle ou tournée hors 90°. Les opaques sont des props et
  des sous-kits hors V1 (piliers, gravats, poutres, chandeliers, marqueurs, murs et
  encadrements de prison, pièces custom du mod). Ancre trouvée par meilleur ajustement
  à (−384, −128, −512). Dérivation en 1,5 ms ; catalogue provisoire (9720 STAT de
  `Skyrim.esm` lus par lecture ciblée, 111 tuiles jointes aux mesures R5) construit en
  130 ms. La carte 2D des empreintes reproduit le plan du donjon.
  - **Bug trouvé et corrigé en chemin** : R5 indexe les cellules par rapport à l'origine du
    NIF ; le catalogue les veut à partir du coin min (D52). Non normalisées, les empreintes
    étaient décalées d'une case selon la rotation : 122 cases en conflit. Normalisées : 8,
    identiques dans les deux conventions de rotation, donc de vrais recouvrements de level design.
  - **Convention de rotation** : cap Skyrim horaire (0 = +Y) → −rz en quarts de tour
    antihoraires, conforme à la documentation du CK. Cette cellule ne peut pas la trancher
    (pièces symétriques) ; une pièce asymétrique tournée de 90° la confirmera à l'usage.
  - Conséquence pour l'éditeur (D58) : les chevauchements existants sont tolérés au
    chargement ; seuls les nouveaux placements sont refusés en cas de conflit.

### R9 – Outillage : tout dans le navigateur
Recherche du 21 sept. 2026 : aucune librairie JS/WASM prête à l'emploi pour **écrire** des plugins Skyrim ; les crates Rust trouvées (esplugin, skyrim-cell-dump) sont en lecture seule ; un éditeur NIF entièrement navigateur existe pour les assets Morrowind (NIFZER0EDIT), ce qui montre que l'approche est viable. Conséquence : parseurs maison ciblés (D45). `pytes5`, Mutagen, Spriggit ne sont plus sur le chemin critique.

### R14 – Pile navigateur (nouveau, bloquant)
Trois briques à prouver, chacune par une page HTML de test :
- **a. Accès disque** : choisir le dossier Data, relire le handle à la session suivante, écrire un fichier en place. Succès : aucun re-choix de dossier, écriture atomique.
  - **Résultat (21 sept. 2026, Chrome, `poc/r14a-fs.html`) : succès.** Après rechargement, le
    handle est relu d'IndexedDB avec la permission déjà `granted` (Chrome conserve la
    permission accordée ; aucun clic « Re-authorize » n'a été nécessaire). Racine du jeu
    reconnue par `Data/Skyrim.esm`. 18 archives listées en 6 ms ; en-tête de
    `Skyrim - Meshes0.bsa` lu par plage de 36 octets en 0,8 ms (`BSA`, v105, 978 dossiers,
    19 443 fichiers) ; écriture de 64 octets en 67 ms, relue identique, puis supprimée.
    Module `src/lib/fs` : chemins insensibles à la casse, lecture par plage, écriture atomique
    par `createWritable`, handles en IndexedDB, 16 tests unitaires sur handles factices.
  - À noter : le dossier choisi s'appelle « Game Root » et ne contient que 18 archives, contre
    une centaine dans le `Data` Steam listé plus tôt (Creation Club inclus) : probablement une
    copie « stock game » gérée par MO2. À confirmer avec la question MO2 (R15, D50) : quel
    dossier l'outil doit-il viser par défaut.
- **b. BSA + NIF** : lire un NIF impérial directement dans `Skyrim - Meshes*.bsa` (lecture par tranches, sans charger le Go complet ; décompression LZ4), en extraire vertex et triangles, l'afficher en WebGL. Succès : la tuile s'affiche à la bonne échelle.
  - **Résultat (21 sept. 2026, Chrome, `poc/r14b-bsa-nif.html`) : succès.** `imphall1way01`
    lu dans `Skyrim - Meshes0.bsa` via la vue Data virtuelle MO2 (71 mods, 11 archives
    ouvertes) : tables de l'archive (19 443 fichiers) lues en 18 ms, fichier LZ4 72 060 →
    99 910 octets décompressé en 1,9 ms, NIF parsé en 1,1 ms ; 20 blocs, 4 formes, 2230
    sommets, 3428 triangles, boîte -128..128 × -128..128 × 2,5..310, identique au rapport
    R5. Affiché en three.js centré sur l'origine, sans texture ; `128l01` déborde sur 3 × 2
    cases sans remplir la troisième (24 unités, comme mesuré par R5). Portages TypeScript de
    `tools/bsa.py` et `tools/nif.py` dans `src/lib/format/{bsa,nif}` + `src/lib/compress/lz4.ts`,
    18 tests sur fixtures synthétiques. Le premier accès coûte ~140 ms parce que les tables de
    chaque archive sont ouvertes à la demande depuis la fin de l'ordre de chargement ; l'app
    construira un index chemin → archive au démarrage.
- **c. ESP en place** : parser un plugin en records opaques, le réécrire ; succès = fichier identique octet pour octet. Puis ajouter une REFR dans une cellule (tailles de groupes, compteur de records et prochain ID dans l'en-tête), ouvrir dans le CK et xEdit sans erreur. Attention aux plugins ESL (plage de FormID) et aux records compressés.
  - **Résultat (22 sept. 2026, `poc/r14c-esp.html`, plugin de travail lu dans son dossier de
    mod MO2) : succès complet.** 276 311 octets, 13 masters, 1306 nœuds, parsés en 1,2 ms ;
    **réécriture identique octet pour octet** en 2,1 ms. Cellule de travail : 579 REFR
    propres au plugin + 24 objets placés d'autres types (ACHR, NAVM) qui passent intacts.
    Ajout d'une REFR (copie d'`ImpJailDoor01` élevée de 512) écrite dans une copie
    `.r14c.esp` : xEdit la charge sans erreur, la REFR ajoutée est dans le groupe Temporary
    à la bonne position, le CK affiche la porte flottante. Couvre R6.
  - **À noter** : le compteur `HEDR numRecords` du CK vaut 1303 pour un arbre de 1306 nœuds ;
    l'outil applique donc un delta au compteur d'origine plutôt qu'un recompte. Le CK et xEdit
    ont accepté l'une comme l'autre valeur.
  - `src/lib/format/esp` : records et groupes opaques, sous-records (`XXXX`), records
    compressés (zlib), TES4 (refus des ESL), CELL/REFR, `addRefr` / `moveRefr` / `deleteRefr`
    limités aux records propres au plugin (D22), FormKey ↔ FormID ; 12 tests.
- **Repli** si b ou c échoue : petit utilitaire local d'extraction qui produit le catalogue, l'éditeur restant une SPA.

### R15 – MO2 et fichiers hors Data
Le navigateur ne voit pas le VFS de MO2 : les meshes de mods (kits custom) sont dans leurs dossiers de mod. Les meshes en fichiers libres priment sur les BSA. Plus tard (D49). Deux pistes :
- **Lire `modlist.txt`** du profil MO2 et superposer les dossiers `mods/*` dans l'ordre : pas de dépendance au VFS, fonctionne Chrome déjà ouvert. Piste principale.
  **Devenu nécessaire pour la V1** (21 sept. 2026) : installation « Game Root » stock + tous les DLC et le plugin de travail dans MO2, montage très courant chez les modders. Implémenté dans `src/lib/vfs` (D50), page de test `poc/r15-mo2.html`. **Résultat (21 sept. 2026) : succès.** L'ordre des mods concorde avec le panneau gauche de MO2 (le premier de `modlist.txt` est bien le plus prioritaire), le profil est le bon, `Dawnguard.esm` et le plugin de travail sont trouvés dans leur dossier de mod, `Skyrim.esm` dans le `Data` du jeu, les archives sont ordonnées. Aucune copie sur disque.
- **Lancer Chrome via MO2** : USVFS accroche le processus lancé et ses enfants, mais si Chrome tourne déjà, le lancement est passé à l'instance existante (non accrochée) → il faudrait un profil séparé (`--user-data-dir`). Compatibilité avec le sandbox de Chrome inconnue. Test : lancer ainsi, ouvrir le sélecteur de dossier sur Data, vérifier qu'un fichier de mod y apparaît.
- Vortex : déploiement par liens dans Data, donc rien à faire.

## Bloquants pour le NavMesh

### R1 – Écrire un NAVM valide (le plus gros risque technique)
Adjacences de triangles, drapeaux d'arêtes, grille de recherche interne, liens de porte.
- **Test** : générer par code le NavMesh d'UNE tuile de couloir, ouvrir dans le CK, Finalize, faire marcher un PNJ en jeu.
- **Succès** : le CK l'accepte sans erreur, le PNJ circule.

### R2 – Plusieurs NAVM dans une cellule intérieure
Hypothèse : un record NAVM par lot baké, reliés par les edge links du Finalize.
- **Test (sans code)** : dans le CK, deux NavMesh séparés dans une cellule test avec vertex de bord coïncidents ; Finalize ; vérifier les liens et le pathing d'un PNJ à travers la couture.
- **Succès** : pathing continu. **Repli** : un seul NAVM par cellule, le bake partiel réécrit le record en préservant les triangles hors sélection.

### R4 – Polygone marchable depuis la collision
- **Test** : sur 3 tuiles (couloir, coin de salle, porte) : triangles de collision orientés vers le haut → projection → union → érosion par rapport aux murs.
- **Succès** : polygone propre, peu de vertex, comparable à ce qu'un designer tracerait. Correction manuelle possible dans le catalogue.

### R11 – Jonctions en T
Ouverture plus étroite que l'arête du voisin ; obstacle du voisin à moins d'une marge de la frontière. Réponse prévue : union puis triangulation (D38) plutôt que variantes de gabarits. À confirmer en même temps que R4.

## Plus tard

### R7 – Volumes superposés
L'union 2D ne tolère pas deux planchers superposés : traiter par couche, raccorder aux escaliers. L'UX des tranches Z et des pièces à cheval sur deux tranches est à concevoir.

### R12 – Obstacles dans le NavMesh
Empreintes des props/clutter/meubles ; objets déplaçables (Havok) à ignorer ; volume de données à produire.

### R13 – Distribution
Réglé par D46 : chaque utilisateur construit le catalogue depuis sa propre installation, dans son navigateur ; on ne distribue que nos annotations. Reste à décider : les annotations sont-elles indexées par EditorID ou par signature ?

## Risque de projet

### R8 – Ambition
Le plan complet est très ambitieux. Mitigation : V1 étroite (un kit, un Z, pas de NavMesh), structures prévues large, tests de concept d'abord.
