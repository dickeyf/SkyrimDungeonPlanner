# Modèle de données

Deux ensembles de données seulement :
1. **Le catalogue** (propre à l'outil, versionné, généré par extraction + validation).
2. **Le niveau** (lu du .esp, jamais dupliqué ; l'outil en dérive une vue « grille »).

Les EditorID dans les exemples sont illustratifs ; les vrais viendront de l'extraction.

## 1. Catalogue

### 1.1 Kit
```json
{
  "kit": "Imperial",
  "module": { "xy": 128, "z": 128 },
  "note": "mesuré (R5, smallhall) : tuile de base 256 x 256, escaliers +256 ; variantes 128 et 64. Module 128 proposé (D51). Le mur libre vanilla a un coeur de 384."
}
```
Exemple mesuré (`imphall1way01`, module 128) : `pivot: [128, 128, -8]`, `cells` = 2 × 2 × 1
(`[0,0,0] [1,0,0] [0,1,0] [1,1,0]`), ouvertures en -Y et +Y sur les deux cellules de chaque
côté. `imphall1way128l01` : `pivot: [256, 128, -8]`, 3 × 2 cellules, sortie +Y décalée de -128.

### 1.2 Pièce
```json
{
  "editorId": "ImpHallExemple01",
  "formKey": "0xxxxxx:Skyrim.esm",
  "model": "dungeons\\imperial\\...\\exemple.nif",
  "kit": "Imperial",
  "class": "tile",
  "category": "hall",
  "pivot": [0, 0, 0],
  "cells": [[0, 0, 0]],
  "faces": [
    { "cell": [0, 0, 0], "dir": "+X", "conn": "ImpHallSm" },
    { "cell": [0, 0, 0], "dir": "-X", "conn": "ImpHallSm" }
  ],
  "walkable": null,
  "obstacle": null,
  "review": { "auto": true, "validated": false }
}
```

| Champ | Rôle | Requis |
|---|---|---|
| `editorId`, `formKey`, `model` | identité ; `formKey` sert à reconnaître la base d'une ref relue | V1 |
| `class` | `tile` ou `prop` | V1 (tile seulement) |
| `category` | hall / room / door (filtrage UI) | V1 |
| `pivot` | position de l'origine du NIF par rapport au coin min de la cellule (0,0,0) de la pièce, rotation 0 | V1 |
| `cells` | cellules de grille occupées, indices 3D, rotation 0. En V1 tous les z = 0 | V1 |
| `faces` | faces **ouvertes** seulement ; une face absente est fermée. `dir` ∈ ±X, ±Y, ±Z. `conn` : un type, ou une liste pour les profils composites (D56, `implhalldoor*`) | V1 (±X, ±Y) |
| `walkable` | polygone(s) marchable(s), vertex avec Z, en coordonnées locales | NavMesh |
| `obstacle` | empreinte(s) au sol pour trouer le NavMesh (props, puis meubles) | Obstacles |
| `review` | proposé par l'analyse vs validé à la main | V1 |

Pourquoi des indices 3D dès la V1 : un escalier ou un couloir en pente est simplement une tuile dont `cells` couvre deux tranches Z, avec des faces ouvertes à des z différents. La « quantification » des étages tombe du modèle ; pas de migration de format quand le Z arrive.

### 1.3 Type de connexion
```json
{
  "id": "ImpHallSm",
  "kit": "Imperial",
  "signature": "identifiant du groupe de profils équivalents (arêtes ouvertes sur le plan de jonction, polylignes normalisées)",
  "mate": "ImpHallSm",
  "navEdge": null
}
```
- Deux faces s'emboîtent si elles se font face et que `conn` de l'une = `mate` de l'autre. `mate` = soi-même pour un profil symétrique ; sinon pointe vers le profil miroir (gauche/droite).
- `signature` n'est pas un hash brut : les profils sont comparés avec tolérance et regroupés (exact → automatique, presque → validation humaine) ; voir R3.
- Le profil inclut son **z** (sol de l'ouverture par rapport au plancher de la cellule) : R5 a montré que ce z varie par famille de pièces (D55).
- Format du profil (R3) : polylignes `[u1, v1, u2, v2]` en unités, u vers la droite vu de l'extérieur de la pièce, origine au centre des cellules couvertes par l'ouverture, v = z moins niveau × module Z. Deux faces qui se regardent voient la même géométrie en miroir : `mate` = groupe du profil miroir, soi-même si symétrique. Tolérance de comparaison : 8 unités.
- `navEdge` (plus tard) : extrémités canoniques de l'arête marchable sur cette face. C'est ce qui garantit que deux lots de NavMesh bakés séparément coïncident.
- Une table pièce-à-pièce n'est **pas** stockée : elle grossit en n² et casse à chaque ajout de pièce. Elle se dérive des types.

### 1.4 Prop (plus tard)
Même record que la pièce avec `class: "prop"`, sans `cells` ni `faces`, avec `obstacle` et éventuellement :
```json
"snapHints": [ { "kind": "cellCorner" }, { "kind": "step", "axis": "X", "size": 128 } ]
```
(ex. piliers aux coins de cellule ; murs libres L/M/R au pas de 128.)

## 2. Niveau (vue dérivée du .esp)

Ce que l'outil lit pour chaque ref de la cellule :
```json
{ "refFormKey": "...", "base": "...", "pos": [x, y, z], "rot": [rx, ry, rz], "scale": 1.0 }
```

Dérivation d'un placement de tuile :
- la base est dans le catalogue avec `class: tile` ;
- `rx = ry = 0`, `rz` multiple de 90° (tolérance), `scale = 1` ;
- `pos` moins le pivot tourné tombe sur la grille (tolérance).

→ `{ "cell": [i, j, k], "rotation": 0..3 }`. Sinon la ref est **opaque** : affichée, jamais modifiée.

À l'écriture : l'inverse (cellule + rotation + pivot → pos/rot monde). Les refs existantes gardent leur FormID ; seules les nouvelles tuiles créent des refs.

Occupation : l'ensemble des cellules occupées (toutes tuiles) sert à la détection de chevauchement et à trouver les faces ouvertes libres.

## 3. Sorties bakées (plus tard)
- NavMesh : records NAVM dans la cellule. « Tuile couverte » = test géométrique sur les triangles existants, donc aucune donnée à stocker.
- État propre à l'outil, s'il en faut (verrou, liste des NAVM créés) : fichier annexe minimal à côté du plugin. Question ouverte.

## 4. Minimum pour la V1
Catalogue : `editorId`, `formKey`, `category`, `pivot`, `cells` (z = 0), `faces` (±X/±Y) + types de connexion (`id`, `mate`). Tout le reste peut rester `null`.
