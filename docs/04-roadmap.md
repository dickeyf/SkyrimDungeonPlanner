# Roadmap

Détail des phases 0–2 en étapes livrables : `07-plan-v1.md`. Squelette de projet (étape 0) fait le 21 sept. 2026.

## Phase 0 – Tests de concept
Pages HTML de test et scripts jetables. Voir `03-risques.md`.
- [ ] R5 module et pivots du kit Impérial
- [ ] R3 signatures de mesh
- [ ] R14a accès disque depuis le navigateur
- [ ] R14b BSA + NIF + affichage WebGL d'une tuile
- [ ] R14c ESP en place : aller-retour identique, puis ajout d'une REFR (couvre R6)
- [ ] R10 dérivation de la grille sur cellules existantes
- [ ] R2 deux NAVM dans une cellule (test manuel CK, peu coûteux, à faire tôt)
- [ ] Fermer les questions ouvertes restantes (MO2, navigateurs non Chromium)

## Phase 1 – Catalogue Impérial
- [ ] Extraction ESM : liste des STAT impériaux (couloirs, salles, portes)
- [ ] Analyse de mesh : `pivot`, `cells`, signatures de faces → types de connexion proposés
- [ ] Outil de validation : nommer les types, corriger, marquer validé
- [ ] `catalogue.json` V1

## Phase 2 – Éditeur V1 (un seul Z)
- [ ] Lire une cellule du .esp, dériver la vue grille, afficher les refs opaques
- [ ] Grille, pan/zoom, rendu des tuiles (murs vs passages)
- [ ] Assistant contextuel : clic sur face ouverte → pièces compatibles (rotation incluse)
- [ ] Ajouter / déplacer / supprimer ; détection de chevauchement
- [ ] Écriture en place dans le plugin
- [ ] Liste des pièces utilisées (sous-produit gratuit)

**Jalon : faire un niveau impérial d'un seul Z très rapidement, l'ouvrir dans le CK.**

## Phase 2b – Vérification profonde des jonctions (R16)
- [ ] Preuve de concept sur les deux cas connus (couture de porte, pièces de salle)
- [ ] Bords libres exacts + visibilité depuis l'intérieur (rendu GPU), cache local par paire
- [ ] Profils = filtre rapide, test profond = confirmation ; continuité des textures (14b)
- [ ] Plus tard, avec les grottes et les props : où boucher une fuite, bouchon vérifié

## Phase 3 – NavMesh de base
- [ ] R1 écrire un NAVM valide ; R4 polygones marchables ; R11
- [ ] `walkable` et `navEdge` dans le catalogue
- [ ] Bake sur sélection, outil « fill » (tuiles sans NavMesh), effacer tout
- [ ] Raccord aux lots existants ; drapeau verrouillé

## Phase 4 – Z
- [ ] Tranches Z, tranche active, fantôme atténué dessous, option tout cacher
- [ ] Pièces à cheval sur deux tranches (escaliers, couloirs en pente)
- [ ] NavMesh par couche, raccord aux escaliers (R7)

## Phase 5 – Props et obstacles
- [ ] Classe Prop, aides au snap ; extraction sur les NIF custom du mod de travail
- [ ] Obstacles dans le NavMesh, par itérations : murs libres → piliers → clutter → meubles

## Phase 6 – Mode Spriggit (D57)
- [ ] Interface « magasin de niveau » isolée du format dès la phase 2 (backend `.esp`)
- [ ] Backend Spriggit : lire le dossier YAML/JSON du mod, écrire les REFR dedans ; masters toujours en binaire
- [ ] Vérifier avec Spriggit que le dossier modifié se traduit en `.esp` identique à ce que l'outil aurait écrit

## Plus tard
Voir `05-idees.md` : vue transverse, autres kits, vignettes, room markers/portals.
