# Décisions

Statuts : **Décidé** (tranché), **Proposé** (suggéré, à confirmer), **Ouvert**.

## Périmètre
| # | Décision | Statut |
|---|---|---|
| D1 | Kit Impérial en premier ; couloirs, salles et portes pour commencer | Décidé |
| D2 | V1 sur un seul Z | Décidé |
| D3 | Le Z viendra plus tard, par « tranches » pour rester en 2D vue de dessus ; l'UI rend transparent/atténué ce qui est sous la tranche active, avec option de tout cacher | Décidé |
| D4 | Vue transverse (coupe) pour voir la structure des étages : plus tard, mais doit rester possible | Décidé |
| D5 | Volumes superposés libres à terme (pas seulement des étages reliés) | Décidé |
| D6 | Pièces libres (piliers, murs libres) à supporter, en plus des tuiles structurelles ; pas en V1 | Décidé |
| D7 | Grottes hors périmètre initial (ne snappent pas proprement) | Proposé |

## Données
| # | Décision | Statut |
|---|---|---|
| D10 | Le .esp est la source de vérité du niveau ; l'outil ne gère que les données d'emboîtement des pièces | Décidé |
| D11 | La liste des pièces est extraite de l'ESM (records STAT : EditorID, modèle, bounds), filtrée par chemin de modèle | Décidé |
| D12 | Les règles d'emboîtement ne sont pas dans l'ESM : base de données maintenue par l'outil, remplie par analyse de mesh (signatures de profil aux faces) + validation manuelle | Décidé (analyse de mesh **prouvée** par R3 le 21 sept. 2026 : 15 groupes sur 304 faces, tolérance 8 unités) |
| D13 | La compatibilité est stockée comme **type de connexion par face**, pas comme table pièce-à-pièce ; « A s'emboîte avec B » est dérivé | Décidé |
| D14 | Pas toute la structure dès la V1, mais le format V1 ne doit pas bloquer le Z, les props ni le NavMesh | Décidé |
| D15 | Deux classes d'objets : **Tuile** (snappée, occupe des cellules, faces typées) et **Prop** (transformation libre, hors compatibilité, aides au snap optionnelles) | Proposé |

## Relation avec le CK
| # | Décision | Statut |
|---|---|---|
| D20 | Export + relecture d'une cellule existante | Décidé |
| D21 | Modification du plugin **en place** : conserver les FormID des refs existantes, ne jamais régénérer la cellule | Décidé (validé par R14c le 22 sept. 2026) |
| D22 | L'outil ne touche qu'aux refs de tuiles qu'il reconnaît ; tout le reste (lumières, clutter, markers) passe intact. Implémenté : `Plugin` ne modifie que les REFR dont le FormID appartient au plugin, jamais les overrides de masters | Décidé (validé par R14c) |
| D23 | Une ref qui ne tombe pas sur la grille ou dont la base est inconnue est affichée comme objet opaque, non éditable | Décidé (validé par R10 : 374 opaques sur 579, toutes pour base inconnue) |

## NavMesh et bake
| # | Décision | Statut |
|---|---|---|
| D30 | Le NavMesh n'est généré que sur demande explicite | Décidé |
| D31 | Concept général de « bake » sur demande ; le NavMesh en est un exemple. Effacer tout et recommencer doit être possible | Décidé |
| D32 | Bake partiel : NavMesh des tuiles sélectionnées seulement ; un outil « fill » sélectionne les tuiles sans NavMesh | Décidé |
| D33 | Raccord au NavMesh existant : tenté automatiquement ; sinon le designer raccorde dans le CK | Décidé |
| D34 | La finalisation manuelle dans le CK ne se fait qu'à la toute fin ; l'outil ne tente pas de préserver ni de fusionner les retouches manuelles | Décidé |
| D35 | « Tuile sans NavMesh » déterminé par test géométrique (un triangle dont le centre tombe dans le volume de la tuile), pas par suivi interne | Proposé |
| D36 | Un record NAVM par lot baké ; l'outil ne supprime que les NAVM qu'il a créés | Proposé (à prouver, R2) |
| D37 | Drapeau « verrouillé » par cellule une fois en phase finition : avertissement avant tout bake destructif | Proposé |
| D38 | Gabarits de NavMesh = **polygones marchables** par tuile (pas des triangles) ; au bake : union → soustraction des obstacles → triangulation ; vertex canoniques forcés aux frontières selon le type de connexion | Proposé |
| D39 | Prise en compte des obstacles dans le NavMesh par itérations : murs libres → piliers → clutter → meubles. Plus tard, mais l'architecture doit le permettre | Décidé |

## Public et plateforme
| # | Décision | Statut |
|---|---|---|
| D40 | Public visé : les modders (outil publié) | Décidé |
| D41 | SPA dans le navigateur, **sans backend**, sans installation | Décidé (sous réserve de R14) |
| D42 | Configuration : dossier racine du jeu + plugin à travailler ; l'outil s'en souvient d'une session à l'autre. **Complété (D49 révisé)** : + instance MO2 et profil, optionnels ; sans MO2 (Vortex ou vanilla), la vue Data = le dossier `Data` seul. Le profil se choisit dans l'outil et se mémorise (localStorage) : une instance MO2 globale n'a pas son `ModOrganizer.ini` dans le dossier d'instance, donc le profil actif de MO2 n'est pas lisible | Décidé |
| D43 | Accès disque par la File System Access API (Chromium : Chrome/Edge). Les handles de dossier se conservent dans IndexedDB, pas dans localStorage ; localStorage pour les préférences simples | Décidé (validé par R14a le 21 sept. 2026) |
| D44 | Rendu 3D WebGL dans le canvas ; la vue 2D de dessus = caméra orthographique sur la scène 3D ; tranches Z = plans de coupe ; vue transverse = caméra orthographique de côté | Proposé |
| D45 | Parseurs maison ciblés plutôt que librairies complètes : ESP (records opaques, seuls STAT/CELL/REFR/NAVM décodés), BSA v105 + LZ4, NIF SSE (noeuds, BSTriShape, collision) | Décidé (BSA + LZ4 + NIF validés par R14b, ESP validé par R14c) |
| D46 | Le catalogue se construit **dans le navigateur de l'utilisateur** à partir de son installation ; seules nos annotations (noms de types, validations) sont distribuées | Décidé (validé par l'étape 9 le 22 sept. 2026 : 111 pièces analysées en 9 s, identiques aux mesures Python) |
| D47 | Copie de sauvegarde du plugin avant toute écriture | Proposé |
| D48 | Limite Chromium acceptée ; mode dégradé (import/export de fichier) plus tard, si ajoutable | Décidé |
| D49 | ~~Pièces custom / VFS MO2 : après une bonne couverture du jeu de base~~ **Révisé le 21 sept. 2026** : la vue « Data virtuel » MO2 est nécessaire dès la V1, parce que les DLC et le plugin de travail vivent dans `mods/*`, pas dans le `Data` du jeu (installation « Game Root » stock + MO2). Les pièces custom restent pour plus tard | Décidé |
| D50 | Pour MO2, piste principale : l'outil lit `modlist.txt` du profil et résout lui-même la priorité des dossiers de mods (superposition ordonnée), sans dépendre du VFS. Lancer Chrome via MO2 : écarté sauf besoin. **Implémenté** (`src/lib/vfs`, 21 sept. 2026) : aucune copie sur disque, simple table de recherche en mémoire ; une écriture va directement dans le dossier du mod. Ordre des plugins lu de `plugins.txt` / `loadorder.txt`, ordre des archives = archives de base de Skyrim.ini puis archives de chaque plugin. Vérifié dans `poc/r15-mo2.html` contre le panneau MO2 : le premier mod de `modlist.txt` est le plus prioritaire | Décidé |

## Grille (issu de R5, 21 sept. 2026)
| # | Décision | Statut |
|---|---|---|
| D51 | Module de grille **XY = 128, Z = 128** : la moitié de la tuile de base 256 × 256 × 256. Un couloir standard occupe 2 × 2 cellules, une ouverture couvre exactement 2 cellules (profil gauche / droite, miroir l'un de l'autre, ce que D13 prévoit avec `mate`). Les variantes « 64 » du kit (3 pièces sur 25 dans `smallhall` : `64short`, `64u`, `64d` ; `64l/r` tiennent) sont hors V1. Alternative : module 64, tout tient (25/25) mais 4 × 4 cellules par couloir et 3–4 sous-faces par ouverture | Décidé (21 sept. 2026) |
| D52 | Le pivot d'une pièce est l'**origine du NIF**, le point autour duquel le CK positionne et tourne la ref ; l'outil ne le choisit pas, il note où il tombe par rapport aux cellules (champ `pivot`). Mesuré : au centre XY de la tuile pour 101 tuiles sur 105 ; les 4 `implroomdoorl*` (512 × 726) ont l'origine au centre de leur carré de 512 et une annexe de porte en dehors. `pivot` et `cells` du catalogue sont lus tels quels du rapport R5 (`tools/out/r5-<subkit>-128.json`), pas saisis à la main | Décidé (21 sept. 2026) |
| D53 | Le module est une **propriété de chaque kit** (`Kit.module`), jamais une constante du code : chaque kit peut avoir le sien. L'éditeur adopte automatiquement le module du kit en cours ; en V1 une cellule utilise un seul kit. Passer un kit à un module plus fin = relancer R5 et revalider ses types de connexion, sans toucher aux niveaux (le .esp est en unités monde, D10) | Décidé |
| D54 | Pièces de transition entre kits : à prendre en charge (après la V1). Quand deux kits de modules différents cohabitent dans une cellule, l'éditeur affiche **les deux grilles superposées, chacune dans sa couleur**, pour montrer les cellules de chaque kit pendant le placement de la transition. Implique une grille (module + ancrage) par kit dans une cellule, pas une grille unique | Décidé |
| D55 | Le **z d'une face fait partie de son profil de connexion** (signature R3), pas de la grille : les sols d'ouverture varient par famille (+8, -8, +2, -34 selon le sous-kit) et une même tuile peut porter deux z. Les cellules restent de 128 en Z ; `pivot.z` d'une tuile = origine du NIF par rapport au plancher de sa tranche, lu du rapport R5. Deux faces à z différents ne s'emboîtent pas (fente visible) : le changement de niveau se fait à l'intérieur d'une pièce (escaliers, marches d'une salle), jamais à la jonction | Décidé (21 sept. 2026) |
| D56 | Une face peut porter **plusieurs types de connexion** (`conn` devient une liste) : les profils composites (mur percé d'une porte au bout d'un grand couloir, `implhalldoor*`) se raccordent à chaque profil qu'ils contiennent. La compatibilité par **inclusion** (contour de A entièrement sur celui de B) est proposée au palier « presque » de la validation, jamais acceptée automatiquement. **Implémenté** : annotation `composites` au niveau du type (`Face.extraConn`), 2 acceptées pour les `ImpLHallDoor*` | Décidé (22 sept. 2026) |
| D57 | **Mode Spriggit** (après la V1) : le mod de travail peut être lu et écrit sous sa forme Spriggit (YAML/JSON, un fichier par record) au lieu du `.esp`, parce que certains mods sont versionnés dans git sans `.esp`, généré seulement au build. Les masters (`.esm`/`.esp`) restent lus en binaire. Conséquence immédiate : dès l'étape 11, l'éditeur passe par une interface de « magasin de niveau » (lister les cellules, lire les refs, ajouter/déplacer/supprimer une REFR, sauvegarder) dont le backend `.esp` est la première implémentation et Spriggit la seconde | Décidé (22 sept. 2026) |
| D58 | Les **chevauchements existants** dans une cellule chargée sont tolérés et simplement signalés ; l'outil ne refuse un chevauchement que pour un **nouveau** placement ou déplacement. Mesuré : 8 cases en conflit dans la cellule du mod de travail, voulues par le level designer | Proposé (R10) |
| D59 | Une **face porte le niveau Z de son ouverture** (relatif à la tranche de l'origine du NIF), et une pièce **occupe tous les niveaux entre ses ouvertures** : une rampe ou un escalier occupe les deux niveaux qu'il relie. Constaté à l'étape 14 : sans cela, les jonctions des pièces en pente (`…D01`, `…U01`, `…R01`, escaliers) paraissaient ouvertes | Décidé (23 sept. 2026) |
| D60 | Une **jonction est jugée sur ses deux profils** superposés (celui d'en face retourné et décalé), pas sur les types de connexion, dont la tolérance de regroupement (8 unités) laisse passer des coutures visibles de près : **exacte** (à 1,5 unité près), **incluse** (un profil contenu dans l'autre ; le surplus d'un côté, détail de plafond ou cadre autour d'un couloir plus étroit, est toléré), **couture** (seulement à la tolérance large, en jaune avec l'écart) ou **incompatible** (en rouge). Les types restent utilisés par l'assistant pour proposer des pièces | Décidé (23 sept. 2026) |

## Reste à décider pour la V1
Aucune de ces lignes n'est tranchée ; la colonne de droite est la recommandation de Claude.

| # | Question | Recommandation |
|---|---|---|
| V1 | Création de cellule | Éditer seulement des cellules existantes (créées/dupliquées dans le CK) |
| V2 | Portes | Tuiles d'embrasure (STAT) seulement ; l'objet DOOR et la téléportation restent au CK. **Confirmé par R5** : les embrasures sont les tuiles `*door*` des sous-kits hall/room ; le dossier `door/` ne contient que des objets DOOR |
| V3 | Rendu | Meshes réels non texturés, ombrés, vus de dessus (on parse déjà les NIF) |
| V4 | Édition | Rotation 90°, undo/redo au minimum ; sélection multiple et déplacement de groupe si le temps le permet |
| V5 | Sauvegarde | Bouton explicite, pas d'autosave ; avertir « ferme ou recharge le CK » |
| V6 | Plugins ESL | Refusés en V1 avec message clair (plage de FormID restreinte). Implémenté dans `Plugin.parse` |
| V7 | Prototypage de l'analyse de mesh | R3/R5 en Python, puis portage TypeScript une fois l'algorithme prouvé. **Précision (21 sept. 2026)** : pynifly n'est pas installable hors Blender ; lecteurs BSA et NIF maison en Python (`tools/bsa.py`, `tools/nif.py`), qui servent de référence au portage |
| V8 | Outil de validation du catalogue | Une page de la même SPA. **Fait** (page Validation, étape 10) |
| V9 | Clé des annotations distribuées | EditorID (lisible) plutôt que signature. **Fait** : pièces par EditorID, types désignés par une face `EditorID:dir` ; les types ne sont jamais nommés à la main (internes, jamais montrés au designer) |
| V10 | Ancrage de la grille dans une cellule existante | Meilleur ajustement sur les tuiles reconnues ; origine monde pour une cellule vide. **Implémenté et validé par R10** (`deriveGrid`) |
| V11 | Pile technique | **Décidé** : TypeScript + Vite + Svelte 5 (runes) + three.js. Pas de SvelteKit ; scène de l'éditeur en three.js impératif hors du framework ; Threlte au plus pour les vignettes |
| V12 | Hébergement | Pages statiques (ex. GitHub Pages) |
| V13 | Licence, dépôt, nom du projet | À décider |
| V14 | Critère de réussite V1 | « Donjon impérial de 30 tuiles sur un Z en moins de 10 minutes, ouvert dans le CK sans erreur ni fente visible » |

Aussi à confirmer, déjà listés « Proposé » plus haut : D7, D15, D21–D23, D43–D47.

Reporté à la phase 3 (NavMesh) : où stocker l'état propre à l'outil (verrou, liste des NAVM créés).

## Questions ouvertes
- **MO2** : le navigateur voit le disque réel, pas le VFS. Configuration = dossier Data du jeu (BSA vanilla) + fichier plugin dans son dossier de mod + dossiers de meshes additionnels au besoin. À valider.
- **Pièces custom** : l'extraction doit-elle tourner sur les NIF custom du mod de travail (murs libres impériaux custom) ? Probablement oui dès que les props arrivent.
