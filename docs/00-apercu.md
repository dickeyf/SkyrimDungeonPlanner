# Skyrim Dungeon Planner – aperçu

Titre de travail. Outil de level design 2D (vue de dessus) pour assembler des donjons Skyrim SE à partir des kits modulaires, puis générer un NavMesh de base. Outil autonome, publiable indépendamment de tout mod.

État : planification terminée pour les exigences structurantes (21 sept. 2026). Squelette de projet en place (même jour) ; plan d'étapes vers la V1 dans `07-plan-v1.md`. Voir `06-reprise.md`.

## But
- Rendre la création d'un donjon rapide : l'outil connaît les pièces et ne propose que celles qui s'emboîtent sur la face cliquée.
- Poser un NavMesh de base qui permet de circuler partout, qui se raccorde automatiquement d'une tuile à l'autre.
- Le designer retourne ensuite dans le CK pour le clutter, les obstacles, l'éclairage, et la finition du NavMesh.
- Objectif de fond : minimiser les ajustements manuels.

## Principes
1. **Le .esp est la source de vérité du niveau.** L'outil lit et écrit les refs de la cellule ; il ne tient pas de document de design parallèle en V1.
2. **Les données propres à l'outil = le catalogue de pièces** : empreinte, pivot, et type de connexion de chaque face.
3. **« Bake » sur demande** : les sorties générées (NavMesh, plus tard autres) sont produites, effacées et refaites à la demande, sur tout ou sur une sélection.
4. **Planifier large, livrer étroit** : les structures de données prévoient le Z, les props et les obstacles ; la V1 n'en implémente qu'un sous-ensemble.
5. **Prouver avant de construire** : chaque risque technique a un test de concept (voir `03-risques.md`).

## Plateforme
SPA dans le navigateur, sans backend, pour les modders. Chromium seulement (File System Access API). Parseurs maison ESP / BSA / NIF. Rendu WebGL ; la vue 2D est une caméra orthographique sur la scène 3D. Le catalogue se construit chez l'utilisateur à partir de son installation. MO2 : l'outil lit `modlist.txt` et reproduit la superposition des dossiers de mods (plus tard, avec les pièces custom).

## Périmètre V1
- Kit Impérial seulement : couloirs, salles, portes.
- Un seul niveau Z.
- Lire une cellule existante, ajouter/déplacer/supprimer des tuiles, réécrire dans le plugin.
- Assistant contextuel : clic sur une face ouverte → pièces compatibles.

## Documents
- `01-decisions.md` – décisions prises et questions ouvertes
- `02-modele-de-donnees.md` – structures de données (V1 et prévues)
- `03-risques.md` – risques et tests de concept
- `04-roadmap.md` – phases
- `05-idees.md` – idées pour plus tard
- `06-reprise.md` – point de reprise pour Claude Code
- `07-plan-v1.md` – étapes détaillées vers la V1 (kit Impérial, un seul Z)
