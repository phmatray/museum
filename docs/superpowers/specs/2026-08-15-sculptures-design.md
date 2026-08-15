# Pièces en volume — Spec de conception

> Date : 2026-08-15
> Statut : validé
> Étend : `2026-07-25-github-museum-design.md`
> Modifie : son §15, qui rangeait la génération de modèles 3D par IA hors périmètre

## 1. Objectif

Le musée sait accrocher des œuvres **dérivées de GitHub** : une toile par dépôt, sur un mur.
Il ne sait pas exposer un **objet en volume**, et rien dans son modèle de données ne peut en
porter un — `curation.json` est indexé par `RepoKey`, il ne parle que de dépôts.

Ce spec ajoute les **pièces en volume** : des objets 3D déclarés par l'instance, posés au sol
ou sur un socle, avec leur cartel. La première est `bavette`, un chat endormi dans un fauteuil
en osier, reconstruit par Meshy à partir d'une photo.

**Le mécanisme est générique ; Bavette n'est qu'une entrée de configuration.** C'est la même
règle que celle du spec parent (§2, « générique par construction ») : un fork qui change
`owners` doit pouvoir aussi poser ses propres pièces, sans hériter du chat de quelqu'un
d'autre.

### Ce que le §15 disait, et pourquoi on l'ouvre

Le spec parent excluait « génération de modèles 3D par IA ». L'exclusion visait la génération
*au build*, dans le pipeline : un musée dont le contenu se fabriquerait tout seul. Ce n'est pas
ce qui se passe ici. Le modèle est produit une fois, à la main, hors du dépôt ; ce qui entre
dans le pipeline est un GLB fixe, mesuré, commité — exactement comme le kit de props sorti de
Blender. **L'ouverture est bornée à ça, et cette phrase est la borne.**

## 2. Ce qu'on expose — la mesure d'abord

Source : `Bavette Catnap Texture.glb`, 80 Mo, générateur `meshy-scene`.

| Mesure | Valeur | Conséquence |
|---|--:|---|
| Triangles | **1 954 738** | ~2× le budget géométrique de TOUTE la scène (§9.5 du parent : 1 000 000, vue la plus chère ~938 000) |
| Maillages / matières | 1 / 1 | rien à fusionner, rien à séparer |
| Cartes | 3 × 2048² JPEG (6,5 Mo) | couleur, metallic-roughness, normale |
| Emprise | 1,557 × 1,588 × 1,904 unités | **normalisée par Meshy** — l'échelle réelle n'est pas dans le fichier |
| Origine | au **centre** du volume | il faut la ramener au sol pour que la pièce se pose |
| Squelette / animation | aucun | pas de compagnon possible sans un rig, hors périmètre |

**Ce n'est pas un chat, c'est une scène.** `meshy-scene` a reconstruit toute la photo : un
fauteuil en osier, un plaid rose jeté sur l'accoudoir, et le chat endormi dans l'assise. Le
fauteuil porte l'essentiel de la géométrie et de la masse visuelle. Il est conservé — « chat
endormi dans un fauteuil » est la pièce, le meuble n'est pas un déchet de reconstruction.

**Et la pièce ne se lit que de face.** Rendue sous quatre angles, elle ne montre son sujet que
d'un côté ; les trois autres quarts de tour sont une coque d'osier fermée. C'est un bas-relief
déguisé en ronde-bosse, et c'est ce qui rend `facing` obligatoire au §4.

## 3. Décisions actées

| Décision | Choix | Raison |
|---|---|---|
| Entrée dans le modèle | tableau `sculptures` de `museum.config.json` | seul fichier propre à une instance ; préserve la généricité |
| Rôle | œuvre de la collection | pas un prop décoratif : elle a un cartel et une place voulue |
| Pose | **socle bas de 0,25 m** | voir le calcul de §5 : le socle existant à 1,05 m escamote le sujet |
| Emplacement | centre de la salle d'honneur, face sud | l'axe du bâtiment existe déjà et traverse une baie |
| Budget de triangles | **18 000** | regardé à 2 m, pas estimé (§6) |
| Collider | **oui**, un cuboïde | rupture assumée avec `PropsLayer`, qui n'en a aucun (§8) |
| Le fauteuil | conservé | maillage unique ; et c'est le sujet, pas un résidu |

## 4. Modèle de données

`museum.config.json` gagne un champ optionnel. Absent — le cas de tout fork — le musée est
exactement celui d'aujourd'hui.

```ts
interface MuseumConfig {
  // … champs existants inchangés
  sculptures?: Sculpture[]
}

interface Sculpture {
  id: string            // slug ; clé stable et graine de déterminisme
  file: string          // relatif à public/assets/sculptures/
  height: number        // hauteur réelle VISÉE, en mètres, > 0
  facing: Side          // 'north' | 'east' | 'south' | 'west'
  room?: string         // id de salle ; défaut : la salle d'honneur du niveau 0
  plinth?: number       // hauteur du socle ; 0 = à même le sol ; défaut 0.25
  cartel: {
    author?: string
    title: string
    year?: number
    medium?: string     // 3e ligne
    credit?: string     // 4e ligne
  }
}
```

Deux champs sont des mesures déguisées en options, et méritent leur justification :

**`height` est une donnée, jamais une constante.** Meshy normalise sa sortie dans une boîte
d'environ deux unités : mesuré, 1,557 × 1,588 × 1,904. L'échelle réelle de l'objet photographié
n'est nulle part dans le fichier. Coder 0,90 m en dur donnerait un musée qui ne sait exposer que
des objets de 90 cm.

**`facing` existe parce que l'unilatéralité est mesurée.** Une pièce sans orientation déclarée
serait posée dos au visiteur une fois sur deux, et pour Bavette « de dos » signifie un panneau
d'osier plein.

⚠️ **`facing` réutilise le type `Side` avec un sens DIFFÉRENT de `Room.side`, et les deux se
lisent dans le même fichier.** `Room.side` dit *où est* la salle dans l'anneau — `'north'`
signifie « cette salle occupe le côté nord ». `Sculpture.facing` dit *vers où regarde* la
pièce — `'south'` signifie « sa face avant est tournée vers le sud ». Une salle au nord reçoit
donc une pièce qui regarde au sud, et ce n'est pas une contradiction : c'est un objet qui fait
face à ceux qui entrent.

En coordonnées monde, le nord est `−z` (le cap 0 du point d'apparition, `domain/derive.ts:594`).
Donc `facing: 'south'` donne une normale de face `(0, 0, +1)`.

L'entrée retenue pour l'instance de référence :

```json
{
  "id": "bavette",
  "file": "bavette.glb",
  "height": 0.9,
  "facing": "south",
  "plinth": 0.25,
  "cartel": {
    "author": "Philippe Matray",
    "title": "Bavette endormi",
    "year": 2026,
    "medium": "Photogrammétrie par IA (Meshy), maillage décimé",
    "credit": "Collection de l'artiste"
  }
}
```

## 5. Pose et emplacement

### 5.1 Pourquoi un socle bas, et pas le socle existant

`domain/props.ts` pose déjà un ou deux `socle` par salle de plus de 70 m² — un prisme de
**1,05 m**, vide depuis le lot 4. Le réflexe serait d'y poser la pièce. Le calcul l'interdit,
avec `HAUTEUR_OEIL = 1.62` (`components/Player.tsx:78`) et une assise de fauteuil à 0,42 m de
sa propre base :

| Pose | Assise à | Plongée du regard à 1,5 m | Le sujet est |
|---|--:|--:|---|
| socle existant, 1,05 m | 1,47 m | **5,7°** | invisible — on voit l'assise par la tranche, la traverse et le plaid l'occultent, et le dossier culmine à 1,95 m |
| socle bas, 0,25 m | 0,67 m | 32° | pleinement visible |
| à même le sol | 0,42 m | 38° | pleinement visible |

Le socle bas est retenu contre le sol nu pour une raison qui n'est pas géométrique : posé à même
le parquet, un fauteuil se lit comme du **mobilier**, et un visiteur essaiera de s'y asseoir.
Vingt-cinq centimètres suffisent à dire « ceci est une pièce » sans rien cacher.

### 5.2 L'axe du bâtiment existe déjà

Mesuré sur `public/data/museum.json` :

- le visiteur apparaît en `(0, 0, 10.5)`, **cap 0 = plein nord** (`domain/derive.ts:594`) ;
- la salle d'honneur occupe toute la bande nord du rez-de-chaussée, 30 × 9 m, centre `(0, −10.5)` ;
- son mur `inner` court de `x = −15` à `x = +15`, et sa **baie** occupe `u ∈ [13,8 ; 16,2]`,
  soit un centre à **`x = 0` exactement** — 2,4 m de large, 3,7 m de haut ;
- les deux socles existants sont en `x = ±10` ; le centre de la salle est libre.

La pièce est donc posée au **centre de la salle d'honneur, tournée plein sud**. Elle est cadrée
par la baie depuis le point d'apparition, à 21 m, puis grossit à mesure que le visiteur
contourne le vide de l'atrium et entre. La mise en scène n'est pas inventée : elle est lue dans
le bâtiment.

### 5.3 L'ordre de placement est un invariant, pas un détail

**`placeSculptures` tourne AVANT `placeProps`, et ses emprises entrent dans les obstacles.**

Sans cela : `poserLeBanc` cherche le mur le plus garni — l'extérieur, 5 œuvres — et pose son
banc à 2,60 m de ce mur, soit `z = −12.4`, à moins de deux mètres de la pièce. Et `poserLesSocles`
vise le centre de l'axe long quand la salle n'en reçoit qu'un.

Le mécanisme existe déjà et n'est pas à inventer : `placeProps` accumule ses poses dans `poses`
et les traite comme obstacles pour les suivantes. Une sculpture est une entrée pré-semée dans ce
même tableau.

## 6. Chaîne d'asset

`tools/blender/build-sculptures.py`, calqué sur `decimate-plants.py`, déterministe, sans aléa
ni horloge.

| Étape | Valeur | D'où elle vient |
|---|---|---|
| Mise à l'échelle | `height / bbox.z` | 0,4727 pour Bavette → **0,74 × 0,75 × 0,90 m** |
| Ancrage | recentré en XZ, **origine au sol** | la convention du kit, et sa raison écrite dans `propAssets.ts` : « l'origine de chaque instance devient le point d'ancrage » |
| Décimation | **18 000 triangles** | mesuré, voir ci-dessous |
| Cartes | 2048² → **1024²** | 512 est le réglage des plantes, vues à 3–8 m ; celle-ci est vue à 1,5 m |
| Export | GLB, Draco niveau 6 | **340 Ko** mesurés |

### Le budget de triangles a été regardé, pas estimé

Trois décimations rendues de face, œil à 1,62 m, socle de 0,25 m, à 2 m de distance — la vue
exigeante, pas celle depuis le point d'apparition où tout budget passerait :

| Budget | Conservé | Poids | Verdict à l'écran |
|--:|--:|--:|---|
| 8 000 | 0,41 % | 275 Ko | facettes franches sur le plaid et la lisse du fauteuil ; museau anguleux |
| **18 000** | **0,92 %** | **340 Ko** | le plaid lit comme du tissu, la lisse est ronde, la tête est nette |
| 40 000 | 2,05 % | 472 Ko | écart avec 18 000 quasi invisible, pour 2,2× le coût |

C'est la méthode que `decimate-plants.py` documente déjà, et la raison qu'il en donne :
« 6 000 était BEAUCOUP trop bas, et le défaut ne se voyait pas dans les chiffres — l'arbre sort
en SQUELETTE ». Un budget de triangles ne se choisit pas dans un tableur.

### Où vit la source

Le GLB **produit** est commité, sous la même exception de `.gitignore` que le kit et les LOD de
végétation, et pour la raison qui y est déjà écrite : *« la CI n'a pas Blender »*.

La source de 80 Mo **n'entre pas dans le dépôt** — il est public. Elle reste hors de l'arbre ;
`public/assets/sculptures/SOURCES.md` enregistre son nom, sa provenance et son **SHA-256**. La
reproductibilité est donc conditionnelle et le spec le dit franchement : rejouable *à condition
de disposer de la source*, et le hash rend la question « est-ce le même fichier ? » répondable
sans versionner 80 Mo.

⚠️ `public/assets/CREDITS.md` ouvre aujourd'hui sur « **Tous en CC0 (domaine public)** ». C'est
faux dès que Bavette est commité. L'en-tête doit distinguer les assets CC0 des pièces
appartenant à l'auteur du musée — sinon un dépôt public affirme une licence qu'il n'a pas.

## 7. Architecture des modules

Le découpage du spec parent (§3) est respecté à la lettre : ce qui décide vit dans `domain/`,
ce qui fabrique de la géométrie dans `builders/`, ce qui rend dans `scene/`.

```
schema/index.ts            + Sculpture, zod, message d'erreur exploitable
domain/sculptures.ts       placeSculptures(museum, sculptures) → SculpturePlacement[]   PUR
domain/props.ts            accepte des emprises pré-semées (une ligne de signature)
builders/plinth.ts         buildPlinth(emprise, hauteur) → BufferGeometry + collider     PUR
scene/sculptureAssets.ts   chargement GLB mémorisé, comme propAssets.ts
scene/SculptureLayer.tsx   rend la pièce, son socle, son collider
tools/blender/build-sculptures.py
```

Pas d'`InstancedMesh` : un exemplaire unique n'a rien à instancier. La pièce est groupée par
étage pour hériter du culling existant (§9.3 du parent).

⚠️ `builders/plinth.ts` tombe sous les deux pièges d'`ExtrudeGeometry` documentés au §8 du
parent, qui touchent déjà `buildSlab`, `buildWall` et `buildRamp` : **`bevelEnabled: false`**
(sans quoi 0,25 m d'épaisseur en donne 0,65) et **indexation explicite** (sans quoi le collider
trimesh est vide et on traverse le socle).

## 8. Le collider — une rupture assumée

`PropsLayer` n'a **aucun collider** : bancs, socles, jardinières et plantes se traversent
aujourd'hui. Seuls le sol, les murs, les rampes et le sol du parc sont solides.

La sculpture en reçoit un — un `CuboidCollider` unique sur l'emprise socle + pièce. C'est
incohérent avec les props, et c'est délibéré : **c'est la seule pièce du bâtiment que le
visiteur est explicitement invité à approcher et à contourner.** La traverser serait le défaut
le plus visible du musée, et il coûte une boîte convexe à éviter.

Poser des colliders sur les props existants est hors périmètre : c'est une décision qui les
concerne tous et qui se prendra pour eux, pas dans le sillage d'un chat.

## 9. Cartel

`CartelLayer` rend déjà les cartels sous 6 m ; `Cartel.tsx` est réutilisé tel quel. Le cartel de
sculpture est posé sur le socle, tourné selon `facing`.

```
Philippe Matray
Bavette endormi, 2026
Photogrammétrie par IA (Meshy), maillage décimé
Collection de l'artiste
```

## 10. Budget

| Poste | Avant | Après | Plafond |
|---|--:|--:|--:|
| Triangles, vue la plus chère | ~938 000 | ~956 000 | 1 000 000 |
| Chargement initial | < 5 Mo | + 340 Ko | 5 Mo |
| Draw calls | ~210 | ~212 | 150 — **déjà dépassé avant cette pièce** |

Les draw calls étaient au-dessus du plafond avant Bavette. Deux de plus ne sont pas gratuits ;
ils ne changent pas la nature du problème, et ce spec ne prétend pas le régler. Le juge reste
`node tools/capture.ts --check`, qui sort en 1 au moindre dépassement — et il devra passer, pas
être estimé. Le §12 du parent rappelle pourquoi : « une mesure manquante vaut `Infinity` et non
zéro ».

## 11. Stratégie de test

| Suite | Ce qu'elle garantit |
|---|---|
| `domain/__tests__/sculptures.test.ts` | la pièce tombe dans la salle demandée ; son emprise ne croise ni mur, ni ouverture, ni trémie, ni hélice de rampe ; l'orientation correspond à `facing` ; même entrée, même sortie |
| `domain/__tests__/props.test.ts` | **le test qui compte** : aucun prop ne croise l'emprise d'une sculpture. C'est l'invariant du §5.3 |
| `builders/__tests__/plinth.test.ts` | bounding box **3D** réelle — pas l'aire 2D, qui ne voit pas le biseau ; collider indexé et non vide |
| `schema/__tests__/schema.test.ts` | config sans `sculptures` ; `height` ≤ 0 ; `facing` inconnu ; cartel sans titre |
| `scene/__tests__/sculptureAssets.test.ts` | le GLB **commité** fait bien ≤ 18 000 triangles et 0,90 m de haut — comme `PROP_METRICS` mesure le kit réel plutôt que de se croire sur parole |

Aucun test ne dépend d'un canvas WebGL, conformément à l'invariant 1 du §3 du parent.

## 12. Hors périmètre

Rig et animation (le modèle n'a ni squelette ni pose) · compagnon qui suit le visiteur ·
plusieurs sculptures par salle · édition des sculptures dans l'éditeur · vitrine de verre ·
colliders sur les props existants · génération de modèles depuis le pipeline de build.

## 13. Risques

| Risque | Probabilité | Parade |
|---|---|---|
| `capture.ts --check` échoue sur les triangles ou les draw calls | moyenne | budget mesuré avec 44 000 triangles de marge ; à défaut, redescendre à 12 000 et re-regarder |
| Un prop se pose malgré tout sur la pièce | faible | l'invariant du §5.3 est couvert par un test, pas par la discipline |
| La source de 80 Mo est perdue | moyenne | le GLB commité reste ; seule la **régénération** devient impossible, et `SOURCES.md` dit exactement quel fichier manque |
| Le GLB commité dérive du script | faible | le test de `sculptureAssets` mesure le fichier réel |
