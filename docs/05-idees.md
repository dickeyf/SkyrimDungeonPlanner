# Idées (non planifiées)

- **Vue transverse (coupe)** pour voir la structure des étages. Possible dès que `cells` est 3D.
- **Vignettes vue de dessus** générées depuis les meshes, à la place de rectangles.
- **Autres kits** : Nordique, Dwemer. Grottes probablement jamais en snapping strict.
- **Pièces de transition entre kits** : un type de connexion dont `mate` appartient à un autre kit. Décidé (D54) : les deux grilles s'affichent superposées, chacune dans sa couleur, pendant le placement.
- **Room markers et portals** générés comme sortie bakée (performance des grands donjons).
- **Portes** : poser la porte (ref DOOR) avec son cadre ; liens de téléportation laissés au CK.
- **Variantes visuelles** : proposer les pièces équivalentes (même empreinte, mêmes connexions) pour casser la répétition.
- **Cases partiellement occupées** : une annexe de 214 unités (embrasure des grandes salles) remplit sa rangée de cases à 84 % ; distinguer « cases partagées » de « murs qui se croisent » rendrait le signalement de chevauchement (D58) plus juste. Vu sur la cellule du mod de travail, là où le level designer a dû forcer l'assemblage et cacher les coutures avec des colonnes.
- **Validation de plan** : faces ouvertes orphelines, zones inaccessibles, tuiles sans NavMesh.
- **Contre-vérification par les noms** : comparer les types déduits du mesh aux suffixes d'EditorID pour repérer les erreurs de catalogue.
- **Correction manuelle du polygone marchable** dans l'outil de validation du catalogue.
- **Mode Spriggit** (décidé, D57, phase 6) : le mod de travail lu et écrit en YAML/JSON Spriggit, les masters en binaire ; pour les mods versionnés dans git sans `.esp`.
- **Kits custom du mod de travail** (murs libres impériaux custom, variantes fenêtrées) dans le catalogue comme props avec pas de 128.
- **Voir le Z en V1** : le niveau des tuiles (rampes, escaliers) ne se voit pas dans la vue
  de dessus ; il faut être prudent. Au minimum, afficher le niveau `k` de la tuile survolée
  ou teinter les tuiles selon leur niveau, en attendant les tranches Z de la phase 4. Relevé
  au test de l'étape 16.
