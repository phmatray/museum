# Musée GitHub — Spec de conception

> Date : 2026-07-25
> Statut : validé
> Remplace : le périmètre « portfolio manuel » des `virtual-museum-user-stories.md` (Epics 2, 4, 6)

## 1. Objectif

Un musée 3D navigable en vue subjective dans le navigateur, dont **le contenu et le bâtiment sont générés à partir de l'API GitHub**. Chaque dépôt devient une œuvre accrochée à un mur ; chaque groupe thématique devient une salle ; le nombre de salles détermine le nombre d'étages.

Le projet est **générique par construction** : aucune donnée d'un compte particulier n'est codée en dur. On le pointe vers n'importe quel utilisateur ou organisation GitHub et il produit un musée. L'instance de référence agrège `phmatray` et `Atypical-Consulting`, déployée en GitHub Pages.

### Ce qui existe déjà

L'Epic 1 (navigation) est terminé sur `main` : contrôleur FPS avec pointer lock, `KinematicCharacterController` Rapier avec autostep et snap-to-ground, contrôles tactiles, minimap, tour guidée sur spline, transitions de salle par capteurs. React 19, R3F 9, Rapier 2, zustand 5, Vite 8, TypeScript, vitest.

Ce socle est conservé. Ce qui change : le modèle de données devient multi-étages et génératif, `museum.json` cesse d'être écrit à la main, et `Room.tsx` cède la place à des constructeurs procéduraux.

## 2. Décisions actées

| Décision | Choix | Raison |
|---|---|---|
| Point de départ | Étendre le repo existant | L'Epic 1 est fonctionnel et testé |
| Typologie bâtie | Atrium central traversant + rampes | Verticalité lisible, effet d'accueil |
| Ouverture sur l'atrium | **Baies étroites** | ~30 œuvres visibles au lieu de 200 ; le vide et les rampes portent le spectacle |
| Circulation verticale | Rampe hélicoïdale physique | Pente ~9°, très en dessous des 45° du contrôleur ; aucun risque de blocage |
| Source du contenu | API GitHub, fetch au build | Le quota anonyme (60 req/h **par IP visiteur**) interdit tout fetch client |
| Persistance | Zéro backend, écriture en dev | Déployable en statique sur Pages |
| Portée | **Générique dès le départ** | Aucune donnée en dur, y compris la taxonomie manuelle existante |
| Éditeur | Plan 2D (réglage) + accrochage in-3D | Un plan se règle en vue de dessus, un accrochage se juge à hauteur d'œil |

### Signal disponible (mesuré sur le corpus de référence, 256 dépôts publiables)

- 252/256 ont des topics, 256/256 ont une description → le clustering automatique a de la matière.
- Les topics sont **très déséquilibrés** : `dotnet` 194, `csharp` 167, `blazor` 90. Un regroupement par topic dominant produirait une salle géante et des placards. **La pondération IDF est donc structurante, pas cosmétique.**
- `opengraph.githubassets.com/<hash>/<owner>/<repo>` renvoie un PNG 1200×600 pour tout dépôt public, avec un hash arbitraire (vérifié : HTTP 200, 100–500 Ko). Chaque dépôt a donc déjà sa toile, sans travail de création.

## 3. Architecture des modules

```
src/
├── domain/     types + logique pure. Zéro import three, zéro import react.
├── schema/     zod : parse, erreurs lisibles, migration de version
├── builders/   domain → géométrie. Pur : (Floor) → BufferGeometry
├── scene/      composants R3F. Ne décident rien, ils rendent.
├── player/     contrôleur FPS + physique (existant, à ajuster)
├── editor/     plan 2D + gizmos 3D + panneaux, retiré du bundle prod
├── stores/     museumStore (données éditées) ⟂ gameStore (runtime)
└── io/         fetch GitHub, chargement, sauvegarde, plugin Vite dev-write

tools/          scripts Node exécutés en CI (fetch, médias, dérivation)
```

Deux règles invariantes :

1. **`domain/` et `builders/` sont testables sans WebGL.** Un test vitest doit pouvoir vérifier une trémie, une pente de rampe ou un accrochage sans jamais instancier de canvas. Toute logique qui décide de quelque chose vit là, jamais dans `scene/`.
2. **`museumStore` ≠ `gameStore`.** Le premier contient ce que l'éditeur modifie, le second la position du joueur et la salle courante. Les fusionner ferait re-rendre la scène à chaque pas.

## 4. Modèle de données

### 4.1 Catalogue (généré depuis GitHub)

```ts
type RepoKey = string  // "owner/name" — clé stable, seul identifiant qui traverse un refetch

interface Artwork {
  key: RepoKey
  owner: string
  name: string
  title: string              // name, humanisé (séparateurs → espaces)
  description: string
  url: string
  homepage?: string
  topics: string[]
  language: string | null
  languages: Record<string, number>   // octets par langage
  stars: number
  forks: number
  openIssues: number
  isFork: boolean
  isArchived: boolean
  isTemplate: boolean
  createdAt: string          // ISO 8601
  pushedAt: string           // ISO 8601
  license: string | null
  readmeExcerpt: string      // 1200 premiers caractères, markdown nettoyé
  media: {
    ogImage: string          // chemin relatif après traitement au build
    ogImageLayer: number     // index de couche dans la texture array
    aspect: number           // 2.0 pour les OG images GitHub
  }
  commitActivity: number[]   // 52 semaines, pour le relief sculpté (lot 7)
}

interface Catalogue {
  schemaVersion: 1
  generatedAt: string
  owners: string[]
  artworks: Artwork[]
}
```

Écrit dans `public/data/catalogue.json`. **Généré, jetable, écrasé à chaque build.** Aucun humain ne l'édite.

### 4.2 Curation (écrite à la main / par l'éditeur)

```ts
interface Curation {
  schemaVersion: 1
  repos: Record<RepoKey, RepoOverride>
  rooms: Record<string, RoomOverride>
  excluded: RepoKey[]
}

interface RepoOverride {          // tout est optionnel : absent = automatique
  include?: boolean               // force l'inclusion malgré les filtres
  featured?: boolean              // → salle d'honneur du rez-de-chaussée
  room?: string                   // force l'affectation de salle
  title?: string
  blurb?: string
  image?: string                  // chemin relatif dans public/custom/
  placement?: { wallId: string; u: number; scale?: number }
}

interface RoomOverride {
  name?: string
  floor?: number
  theme?: ThemeId
  order?: number                  // position dans l'anneau
  hidden?: boolean
}
```

Écrit dans `curation.json` à la racine. **Commité.** Une clé orpheline (dépôt disparu de GitHub) est signalée au chargement, jamais bloquante.

### 4.3 Configuration d'instance

```ts
interface MuseumConfig {
  schemaVersion: 1
  name: string
  owners: string[]
  filters: {
    excludeForks: boolean        // défaut true
    excludeArchived: boolean     // défaut false → ils vont en réserve
    minStars?: number
    requireTopics?: string[]
    excludePatterns?: string[]   // globs sur "owner/name"
  }
  building: {
    roomDepth: number            // défaut 9
    ceilingHeight: number        // défaut 4.3
    slabThickness: number        // défaut 0.4
    minAtriumSize: number        // défaut 12
    minRoomWidth: number         // défaut 6
    roomsPerFloor: number        // défaut 6
  }
  clustering: {
    minClusterSize: number       // défaut 4
    maxClusterSize: number       // défaut 14
  }
}
```

`museum.config.json` à la racine. **C'est le seul fichier spécifique à une instance.** Forker le projet et changer `owners` suffit à produire un autre musée.

### 4.4 Bâtiment (dérivé — jamais stocké à la main)

```ts
interface Museum {
  config: MuseumConfig
  floors: Floor[]
  atrium: { width: number; depth: number }
  spawn: { floorId: string; position: Vec3; yaw: number }
  stats: { artworkCount: number; roomCount: number; floorCount: number }
}

interface Floor {
  id: string
  name: string
  level: number              // -1 = réserve, 0 = RDC, 1+ = étages
  elevation: number          // CALCULÉ depuis les niveaux inférieurs, jamais saisi
  ceilingHeight: number
  rooms: Room[]
  slabHoles: Rect[]          // trémies ; l'atrium en est une
  ramps: Ramp[]
}

interface Room {
  id: string
  name: string
  side: 'north' | 'east' | 'south' | 'west'
  footprint: Rect            // coordonnées monde, y = elevation du plancher
  theme: ThemeId
  walls: Wall[]
  bay: Rect                  // la baie étroite ouvrant sur l'atrium
  clusterTopics: string[]    // les topics de plus fort IDF, pour le cartel de salle
}

interface Wall {
  id: string
  a: Vec2                    // extrémités du segment au sol
  b: Vec2
  height: number
  kind: 'outer' | 'side' | 'inner'
  openings: { u0: number; u1: number }[]   // portes et baies, en fraction de longueur
  placements: Placement[]
}

interface Placement {
  key: RepoKey
  u: number                  // centre le long du mur, en mètres depuis `a`
  centerHeight: number       // défaut 1.45 — standard muséal (57")
  width: number
  height: number
  layer: number              // couche de texture array
  pinned: boolean            // vient d'un override de curation
}

interface Ramp {
  fromFloor: string
  toFloor: string
  centre: Vec2
  radius: number
  startAngle: number
  sweep: number              // radians ; π = demi-tour par niveau
  width: number
  rise: number
}
```

**`Museum` est le résultat d'une fonction pure `derive(catalogue, curation, config) → Museum`.** Elle tourne au build pour la production et en direct dans l'éditeur en développement. Un seul code, deux contextes.

## 5. Pipeline de données

```
1. SOURCE      API GitHub, fetch au build dans l'Action, GITHUB_TOKEN (5000 req/h)
   │           GraphQL paginé : repos, topics, langages, README, activité de commits
   ▼
2. CATALOGUE   public/data/catalogue.json   généré · jetable · écrasé chaque nuit
   ▼
3. CURATION    curation.json                commité · écrit par l'éditeur
   ▼
4. MUSÉE       public/data/museum.json      dérivé au build par derive()
```

Tout ce qui est dérivé est calculé **au build**. Le visiteur télécharge un `museum.json` prêt à rendre ; aucun clustering ne tourne dans son navigateur.

### Requête GraphQL

Une requête par propriétaire, paginée à 100. Champs : `name owner{login} description url homepageUrl stargazerCount forkCount isFork isArchived isTemplate createdAt pushedAt licenseInfo{spdxId} repositoryTopics(first:20) languages(first:10) object(expression:"HEAD:README.md"){...on Blob{text}}`.

L'activité de commits (52 semaines) vient de l'endpoint REST `/stats/commit_activity`, appelé **uniquement pour les dépôts retenus après filtrage**, avec gestion du 202 (statistiques en cours de calcul → une nouvelle tentative après 2 s, puis abandon et tableau vide). C'est le seul appel coûteux ; il est facultatif et n'échoue jamais le build.

### Traitement des médias

Pour chaque dépôt retenu :
1. Télécharger `https://opengraph.githubassets.com/<sha1(key)>/<owner>/<name>`.
2. Si `curation.repos[key].image` existe, prendre ce fichier à la place.
3. Produire deux sorties : WebP 1024×512 qualité 78 dans `public/media/near/<slug>.webp` (LOD proche) et une couche 256×128 dans la texture array KTX2 (LOD lointain).
4. Échec de téléchargement → toile de repli générée : aplat de la couleur du langage + nom du dépôt. **Aucun dépôt ne reste sans visuel.**

Budget : 256 WebP à ~45 Ko ≈ 11 Mo, chargés à la demande par proximité. La texture array complète pèse ~17 Mo en ETC1S et se charge une fois.

## 6. Clustering

Déterministe, sans dépendance d'apprentissage automatique, ~200 lignes dans `domain/clustering.ts`.

```
1. VECTORISATION
   Pour chaque dépôt, un sac de termes pondérés :
     topics            × 3.0
     tokens du nom     × 1.5   (découpage camelCase, kebab, snake, points)
     termes de la description × 1.0  (minuscules, stop-words fr+en retirés,
                                      longueur ≥ 3)
     langage principal × 2.0
   Poids final du terme t : tf(t) × idf(t), avec idf(t) = ln(N / (1 + df(t)))
   → un terme présent sur 76 % du corpus tend vers 0. C'est exactement le
     comportement voulu pour `dotnet` et `csharp`.
   Vecteurs normalisés L2.

2. AGGLOMÉRATIF
   Similarité cosinus, average linkage, matrice complète (N ≤ 2000 : O(N²)
   acceptable, ~65 k paires pour 256 dépôts).
   Fusion itérative de la paire la plus proche jusqu'à une seule racine.
   Départage déterministe des égalités : par clé alphabétique.

3. COUPE SOUS CONTRAINTE DE CAPACITÉ
   Descente depuis la racine :
     - taille > maxClusterSize  → descendre dans les deux enfants
     - taille < minClusterSize  → fusionner avec le voisin le plus proche
                                   (cosinus des centroïdes)
     - sinon                    → émettre le cluster
   Résidu non fusionnable → salle « Divers ».

4. NOMMAGE
   Les deux termes de plus fort IDF cumulé du cluster, capitalisés, joints
   par « / ». Collision de noms → suffixe numérique. Un override de curation
   remplace le nom généré.
```

**Aucun aléa nulle part.** Même entrée, même musée : le build est reproductible et le clustering est testable au sens strict.

## 7. Disposition

### 7.1 Affectation aux étages

| Niveau | Contenu | Règle |
|---|---|---|
| −1 | Réserve | archivés et forks ; accrochage dense, éclairage minimal, une seule grande salle |
| 0 | Salle d'honneur | les `featured` de la curation, complétés jusqu'à 12 par le score `stars × 2 + récence` |
| 1+ | Collections | clusters par taille décroissante, `roomsPerFloor` par niveau |

`floorCount = 1 + ceil(clusters / roomsPerFloor) + (réserve ? 1 : 0)`. Le bâtiment prend la forme du compte : 5 dépôts donnent un plateau unique, 2000 donnent une tour.

`elevation` est **calculée** : `elevation(n) = Σ(ceilingHeight + slabThickness)` sur les niveaux inférieurs. Jamais saisie, donc deux étages ne peuvent pas se chevaucher.

### 7.2 Plan en anneau

L'atrium est un rectangle centré à l'origine. Les salles occupent un anneau de profondeur `roomDepth`.

Partition des côtés, sans recouvrement aux angles :
- **Nord** et **Sud** couvrent toute la largeur extérieure : `atriumW + 2·roomDepth`
- **Est** et **Ouest** ne couvrent que la profondeur de l'atrium : `atriumD`

Allocation :
1. Trier les clusters par poids décroissant, répartir en 4 bacs (les côtés) par remplissage du bac le moins chargé — déterministe.
2. Dans chaque côté, subdiviser la longueur proportionnellement au poids, avec un plancher à `minRoomWidth`.
3. **Vérification de capacité** : pour chaque salle, `wallCapacity(room) ≥ taille du cluster`. Si une salle est trop petite, agrandir l'atrium de 2 m et reprendre en 1. Maximum 10 itérations ; au-delà, réduire `maxClusterSize` et relancer le clustering.

Cette boucle est ce qui rend l'accrochage **total** : quand on arrive au mur, la place est déjà garantie.

### 7.3 Murs et baies

Chaque salle produit 4 murs : `outer` (extérieur), deux `side` (mitoyens), `inner` (côté atrium). Le mur `inner` porte une **baie étroite** centrée, de largeur `min(2.4, largeurSalle × 0.25)`, plus la porte d'accès depuis la circulation.

Les murs `side` mitoyens entre deux salles voisines portent une porte de 2 m centrée, sauf en bout de côté.

### 7.4 Accrochage

```
Pour un mur de longueur L :
  utile = L − 2×0.5 (marges d'angle) − Σ(largeur des ouvertures)
  Les segments utiles sont les intervalles entre ouvertures ≥ 1.2 m.

Taille d'une œuvre :
  h = clamp(0.50 + 0.25 × log10(1 + stars), 0.50, 1.60)
  w = h × aspect  (2.0 pour les OG images GitHub)

Répartition sur un segment :
  reste = longueurSegment − Σw
  écart = reste / (n + 1)
  si écart < 0.60 → réduire toutes les tailles de 10 % et recommencer (max 5 fois)
  si écart > 2.50 → écart = 2.50 et centrer le groupe
  Les œuvres sont ordonnées par étoiles décroissantes depuis le centre du mur
  vers les bords (l'œil se pose au centre).

Hauteur d'axe : 1.45 m (standard muséal, 57 pouces), sauf override.
Les placements `pinned` sont posés d'abord et exclus de la répartition.
```

### 7.5 Rampe

Hélice autour du vide, du niveau `n` au niveau `n+1`. Rayon = `atriumW/2 − 1.2`, balayage π (demi-tour par niveau), largeur 2,2 m.

Contrôle de sûreté : `pente = atan(rise / (radius × sweep))`. Avec rayon 9 m, balayage π et montée 4,7 m : développé 28,3 m, pente **9,4°**. Le test doit garantir `pente < 40°` pour toute configuration, avec une marge sur les 45° de `maxSlopeClimbAngle`.

Collision : décomposition en segments convexes (un `cuboid` incliné par pas de 10°), pas en trimesh — le contrôleur cinématique se comporte mieux sur des convexes.

## 8. Génération procédurale

| Constructeur | Entrée | Sortie | Test |
|---|---|---|---|
| `buildSlab` | footprint + trous | `BufferGeometry` (`Shape` + `.holes` → `ExtrudeGeometry`) + collider trimesh | trémie 6×6 dans 20×20 → aire = 364 m², aucun collider au-dessus du vide |
| `buildRailing` | périmètre de trou | garde-corps 1,1 m, main courante | périmètre d'une trémie 6×6 = 24 m |
| `buildWall` | segment + ouvertures | mur troué (`Shape` + `.holes`) + collider | somme des aires d'ouvertures conservée |
| `buildRamp` | `Ramp` | plancher extrudé + garde-corps + colliders convexes | pente < 40° pour toute config |
| `buildRoom` | `Room` | groupe : sol, plafond, 4 murs, baie | 4 murs, aucun chevauchement |

Tous purs, tous dans `builders/`, tous testables sans canvas.

## 9. Rendu et budget de performance

| Poste | Budget | Moyen |
|---|---|---|
| Draw calls | **< 150** | instancing + texture array |
| Triangles | < 500 k | procédural pur, aucun asset importé |
| VRAM textures | < 150 Mo | KTX2 array 256×128, haute définition à la demande |
| Lumières temps réel | **≤ 4** | tout le reste est peint dans le matériau |
| Shadow maps | 1 | la verrière zénithale seule |
| Chargement initial | < 5 Mo | `museum.json` + array + géométrie ; les WebP suivent |
| Images par seconde | ≥ 60 bureau, ≥ 30 mobile | mesuré, pas estimé |

### 9.1 Les toiles en un draw call

Une texture par œuvre donnerait 256 matériaux et 256 draw calls. À la place : une `CompressedArrayTexture` (KTX2/BasisU, WebGL2) dont chaque couche est une œuvre, et un `InstancedMesh` dont le shader échantillonne `texture(map, vec3(vUv, aLayer))` — `aLayer` étant un `InstancedBufferAttribute`.

Deux niveaux de détail :
- **loin** — couche de la texture array, 256×128, toujours résidente
- **près (< 10 m)** — WebP 1024×512 chargé à la demande, rendu par un mesh individuel qui masque l'instance correspondante

**C'est le pari technique du projet.** Le lot 0 le dérisque avant tout le reste. Repli si le chargeur KTX2 ne suit pas : atlas classique 4096² × 16 pages, moins élégant, éprouvé, même architecture en aval.

### 9.2 Les spots n'existent pas

256 projecteurs avec ombres ne tournent dans aucun navigateur, et sans DCC il n'y a pas de lightmap possible. Mais la signature visuelle d'un spot se réduit à deux choses **peintes** : une ellipse douce sur le mur et une surbrillance sur la toile.

Conservés en temps réel : 1 hémisphérique, 1 directionnelle pour la verrière (seule à projeter des ombres), 1 à 2 lumières locales dans la salle du joueur. Tout le reste passe par le matériau.

### 9.3 Culling

- Un `InstancedMesh` **par étage** : un plateau hors champ se saute d'un bloc.
- Étages à plus de 2 niveaux du joueur : seulement dalle et garde-corps, pas de contenu.
- Salles sans ligne de vue vers la salle courante : masquées (le suivi de salle existe déjà dans `useRoomTransition`).
- Cartels rendus uniquement sous 6 m — au-delà le texte est illisible de toute façon. Maximum ~15 simultanés au lieu de 256.

## 10. Éditeur

Deux modes, une touche `E` pour basculer. Retiré du bundle de production par `import.meta.env.DEV`.

| Mode plan (vue de dessus 2D) | Mode accrochage (vue subjective) |
|---|---|
| voir le plan dérivé, étage par étage | viser une œuvre → panneau de propriétés |
| déplacer une salle d'un niveau à l'autre | corriger titre, texte, visuel |
| renommer, rethémer, réordonner l'anneau | gizmo → fige `wall` + `u` |
| inspecter la réserve et les non-assignés | décrocher → réserve |
| **Régénérer** : recalcule tout, préserve les overrides | épingler en œuvre maîtresse |

Le bouton **Régénérer** est le test de santé de l'architecture : s'il perd du travail, la séparation catalogue/curation fuit.

### Écriture

Plugin Vite `museumDevWrite()`, actif seulement quand `command === 'serve'`. Il expose `POST /__museum/curation` qui valide par le schéma zod puis écrit `curation.json` avec un formatage stable (clés triées, 2 espaces) pour que les diffs git restent lisibles.

**Limite assumée : on ne cure pas depuis le site déployé.** Le flux est forker → `npm run dev` → curer → commiter → l'Action publie. Repli en production : l'éditeur tourne en brouillon `localStorage` avec un bouton « Proposer ces changements » qui ouvre l'éditeur web GitHub sur `curation.json` pré-rempli — curation sans backend et sans clone, valable pour n'importe quel fork.

## 11. Intégration continue

```yaml
on: [push sur main, schedule nocturne, workflow_dispatch]

  fetch    tools/fetch-github.ts    GraphQL paginé, GITHUB_TOKEN → catalogue.json
  media    tools/build-media.ts     OG images → WebP + array KTX2
  derive   tools/derive-museum.ts   (catalogue, curation, config) → museum.json
  build    vite build
  deploy   actions/deploy-pages
```

Le fetch et les médias sont mis en cache par `actions/cache` sur le hash de `catalogue.json` : un build sans changement de dépôts ne retélécharge aucune image.

Dégradation gracieuse : si le fetch échoue, le `catalogue.json` du dernier build réussi (restauré du cache) est utilisé et le build passe avec un avertissement. **Une panne de l'API GitHub ne casse pas le site.**

## 12. Stratégie de test

- **`domain/` et `builders/`** — vitest, sans WebGL. Clustering (déterminisme, respect des bornes, décroissance IDF), élévations, capacité, accrochage (aucun chevauchement, tout dans les bornes, axe à 1,45 m), pente de rampe, aire de trémie.
- **`schema/`** — cas limites : curation orpheline, version inconnue, JSON malformé, tous avec un message d'erreur exploitable.
- **`io/`** — le client GitHub testé sur des réponses figées, pagination et 202 compris.
- **`scene/`** — pas de test unitaire. Validation par capture d'écran via Chrome DevTools et par mesure d'images par seconde.
- **Budget de performance** — un test de non-régression compte les draw calls sur une scène de référence et échoue au-delà de 150.

## 13. Découpage en lots

| Lot | Contenu | Critère de fin |
|---|---|---|
| **0** | Spike texture array : `KTX2Loader` + `CompressedArrayTexture` + `InstancedMesh` 256 couches | 256 quads texturés en 1 draw call, mesuré — ou décision de repli sur atlas |
| **1** | `domain/`, `schema/`, `io/github`, clustering, dérivation | `npm run plan` imprime le plan en texte. Tests verts. Zéro 3D. |
| **2** | `builders/` + scène du bâtiment : anneau, dalles à trémie, rampe, garde-corps ; réglage autostep | on marche dans un musée vide sur plusieurs niveaux |
| **3** | Œuvres : accrochage, `InstancedMesh`, LOD deux niveaux, cartels sous 6 m | tous les dépôts accrochés, 60 im/s mesurées |
| **4** | Pages + Action nocturne | **une URL publique en ligne** |
| **5** | Éditeur mode plan | régénérer sans perdre d'override |
| **6** | Éditeur mode accrochage in-3D | |
| **7** | Finitions : réserve, relief de contributions, tour guidée régénérée, partage d'URL | |

Le **lot 0 précède tout** : il dérisque le seul pari technique. Le **lot 4 précède l'éditeur** : mieux vaut un musée en ligne curé à la main qu'un éditeur parfait sur un projet que personne n'a vu.

## 14. Risques

| Risque | Probabilité | Parade |
|---|---|---|
| `KTX2Loader` ne gère pas les array textures compressées | moyenne | Lot 0 en premier ; repli atlas 4096² × 16 pages |
| Clustering IDF produisant des salles absurdes | moyenne | Overrides de curation ; le nommage se corrige en une ligne de JSON |
| 256 œuvres > budget de draw calls malgré l'instancing | faible | Baies étroites déjà choisies ; culling par étage ; réduire `roomsPerFloor` |
| Quota GitHub dépassé en CI | faible | `GITHUB_TOKEN` = 5000 req/h ; cache ; dégradation gracieuse |
| Poids des médias au-delà des 5 Mo initiaux | moyenne | Array seule au chargement (17 Mo mais unique et compressée) ; WebP par proximité |
| La rampe piège le joueur | faible | Pente 9° ; test automatique < 40° ; garde-corps à collision |

## 15. Hors périmètre

Retirés délibérément : multi-joueurs, authentification, backend, base de données, téléversement de médias depuis le site déployé, éditeur en production (remplacé par le flux de proposition GitHub), génération de modèles 3D par IA, WebXR, lightmaps bakées.

L'Epic 3 (audio) et l'Epic 8 (accessibilité) des user stories existantes restent valables mais sortent de ce spec — ils seront traités après le lot 7.
