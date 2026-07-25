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

### Signal disponible

Mesuré sur `public/data/catalogue.json`, produit par `tools/fetch-github.ts` le 2026-07-25 pour `phmatray` + `Atypical-Consulting`, `privacy: PUBLIC`. **115 dépôts publics, 100 hors forks, 72 hors forks et archives.**

> Une version antérieure de ce spec annonçait 256 dépôts et 98 % de couverture en topics. Ces chiffres venaient de `repos.json`, un audit des clones **locaux** qui incluait les dépôts privés. Ils ne sont reproductibles sur aucun périmètre atteignable en CI. Les chiffres ci-dessous le sont.

- **79 % ont des topics** (57/72), **98 % une description** (71/72), un seul dépôt n'a ni l'un ni l'autre. Le clustering a de la matière, mais pas pour tout le monde — d'où l'usage de plusieurs sources de termes, pas des seuls topics.
- Les topics restent **très déséquilibrés** : `dotnet` 62 %, `csharp` 55 %, `blazor` 15 %. Un regroupement par topic dominant produirait une salle géante et des placards. **La pondération IDF est donc structurante, pas cosmétique.**
- **La distribution d'étoiles est très creuse** : médiane 0, 40 dépôts sur 72 à zéro étoile, maximum 4338. Conséquence pour §7.4 : la grande majorité des cadres sort à la taille plancher (1,00 m de large), et le plus grand atteint 2,82 m. La contrainte de capacité est donc moins tendue que ne le suggère la plage théorique.
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
1. SOURCE      API GitHub, fetch au build dans l'Action, GITHUB_TOKEN
              (1000 req/h ET 1000 points/h PAR DÉPÔT, compteurs REST et
               GraphQL séparés — pas 5000, c'est un jeton d'Action)
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
3. Produire deux sorties, toutes deux avec `sharp` (pur npm, aucun binaire externe) :
   - **LOD proche** — WebP 1024×512 qualité 78 dans `public/media/near/<slug>.webp`
   - **LOD lointain** — une tuile 256×128 posée dans l'atlas `public/media/atlas-<n>.webp`, grille de 16×16 tuiles (4096×2048). Au-delà de 256 dépôts, plusieurs atlas, donc plusieurs `DataArrayTexture`, donc un draw call par atlas.
4. Écrire `public/media/atlas.json` : la correspondance `RepoKey → { atlas, layer }`. C'est ce fichier qui alimente `Placement.layer`.
5. Échec de téléchargement → toile de repli générée par `sharp` : aplat de la couleur du langage + nom du dépôt. **Aucun dépôt ne reste sans visuel.**

Budget : les WebP proches, ~45 Ko pièce, sont chargés à la demande par proximité et ne comptent pas au chargement initial. Chaque atlas pèse ~2 Mo au téléchargement et 32 Mo en VRAM une fois décomposé en couches.

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
| 0 | Salle d'honneur | les `featured` de la curation, complétés jusqu'à 12 par le score `honneur` décroissant |
| 1+ | Collections | clusters par taille décroissante, `roomsPerFloor` par niveau |

```
honneur(repo) = clamp(2 × log10(1 + stars), 0, 3)        notoriété, bornée à 3
              + max(0, 1 − joursDepuis(pushedAt) / 365)  récence, dans [0,1]

joursDepuis() se mesure depuis catalogue.generatedAt, JAMAIS depuis l'horloge
du build : le score doit être reproductible à partir du seul catalogue.
Égalité → départage par clé alphabétique, comme en §6.
```

Sans bornes explicites, additionner des étoiles brutes et une récence donne une somme dominée par le terme le plus grand : le score se réduit à un tri par étoiles, ou à un tri par date, selon les unités. Les deux termes sont donc normalisés dans des plages comparables.

Un dépôt `featured` reste dans le corpus de clustering — `N` et les IDF de §6 sont inchangés — mais son **accrochage est exclusif** : il est accroché en salle d'honneur et retiré des murs de sa salle thématique.

`floorCount = 1 + ceil(clusters / roomsPerFloor) + (réserve ? 1 : 0)`, avec `roomsPerFloor` borné à ≥ 1. Le bâtiment prend la forme du compte : 5 dépôts donnent un plateau unique, 2000 donnent une tour.

`elevation` est **calculée** : `elevation(n) = Σ(ceilingHeight + slabThickness)` sur les niveaux inférieurs. Jamais saisie, donc deux étages ne peuvent pas se chevaucher.

### 7.2 Plan en anneau

L'atrium est un rectangle centré à l'origine. Les salles occupent un anneau de profondeur `roomDepth`.

Partition des côtés, sans recouvrement aux angles :
- **Nord** et **Sud** couvrent toute la largeur extérieure : `atriumW + 2·roomDepth`
- **Est** et **Ouest** ne couvrent que la profondeur de l'atrium : `atriumD`

Allocation :

1. Longueurs courantes : `len(N) = len(S) = atriumW + 2·roomDepth` ; `len(E) = len(O) = atriumD`.
2. **Capacité du bac** : `maxRooms(côté) = floor(len(côté) / minRoomWidth)`. Trier les clusters par poids décroissant, affecter chaque cluster au bac le moins chargé **parmi ceux dont `nbSalles < maxRooms`**. Égalité tranchée dans l'ordre fixe N, E, S, O. Si aucun bac n'est éligible, agrandir l'atrium de 2 m et reprendre en 1.
   *Sans cette contrainte, un remplissage « bac le moins chargé » peut affecter à un côté plus de salles que sa longueur n'en admet au plancher `minRoomWidth` — et la subdivision de l'étape 3 devient infaisable sans que rien ne le détecte.*
3. Subdiviser chaque côté proportionnellement au poids, plancher à `minRoomWidth`. Toujours faisable après l'étape 2.
4. **Faisabilité de l'accrochage** — en longueur, par segment, jamais en cardinal :
   - calculer les largeurs **réelles** `w_i = clamp(0,50 + 0,25·log10(1 + stars_i), 0,50, 1,60) × aspect_i` de toutes les œuvres du cluster (les étoiles sont connues : elles viennent du catalogue) ;
   - énumérer les segments utiles des 4 murs selon la règle **exacte** de §7.4 ;
   - tenter un placement *first-fit decreasing* : œuvres triées par `w_i` décroissant, un segment accepte une œuvre tant que `Σw + (n+1)·écartMin ≤ L_seg` ;
   - la salle passe si et seulement si **toutes** les œuvres sont placées.
   - **Ce placement d'essai est conservé et sert directement d'affectation œuvre→segment à §7.4.** Une seule source de vérité : deux algorithmes séparés finiraient par diverger.

   Si une salle échoue, agrandir l'atrium de 2 m et reprendre en 1. Maximum 10 itérations ; au-delà, réduire `maxClusterSize` et relancer le clustering.

Une capacité exprimée en **nombre d'œuvres** ne peut pas fonctionner : la place consommée dépend des étoiles, et varie d'un facteur 3 entre une œuvre à 0 étoile (1,00 m) et une à 25 000 étoiles (3,20 m). Une même salle de 14 m accueille 13 œuvres dans un cas et 5 dans l'autre. C'est parce que le contrôle utilise les largeurs réelles **et la même règle de pavage que §7.4** que l'accrochage est réellement total.

Un total agrégé sur la salle (`Σ segments ≥ Σ largeurs`) ne suffit pas non plus : il ignore la granularité. Un mur offrant 8,6 m répartis en segments de 1,5 / 1,8 / 5,3 m n'accueille aucune œuvre de 2 m dans ses deux premiers segments.

**Invariant d'enveloppe : les 4 côtés de l'anneau existent toujours.** Un côté dont le bac est vide — cas courant, le rez-de-chaussée n'a qu'une salle d'honneur et `roomsPerFloor` peut être inférieur à 4 — reçoit une **galerie aveugle** : une salle occupant toute la longueur du côté, sans cluster ni placement, produite par le même `buildRoom`, avec mur `inner` sans baie ni porte. Elle n'est pas nommée dans les cartels ni comptée dans `stats.roomCount`. Sans cet invariant, un côté vide laisse la dalle sans garde-corps ni mur, et le joueur tombe.

### 7.3 Murs et baies

Chaque salle produit 4 murs : `outer` (extérieur), deux `side` (mitoyens), `inner` (côté atrium). Le mur `inner` porte une **baie étroite** centrée, de largeur `min(2.4, largeurSalle × 0.25)`, plus la porte d'accès depuis la circulation.

Les murs `side` mitoyens entre deux salles voisines portent une porte de 2 m centrée, sauf en bout de côté.

### 7.4 Accrochage

```
Taille d'une œuvre :
  h = clamp(0.50 + 0.25 × log10(1 + stars), 0.50, 1.60)
  w = h × aspect        aspect = 2.0 pour les OG images GitHub, mais une image
                        fournie par la curation peut valoir 1.0 ou 3.0 : ne
                        JAMAIS coder 2.0 en dur.

Segment utile — seuil DÉRIVÉ, jamais figé :
  wMin = 0.50 × aspect                       1.00 m à l'aspect 2.0
  un segment est utile ssi L_seg ≥ wMin + 2 × écartMin      soit 2.20 m au défaut

Capacité d'un segment (même règle qu'en §7.2, une seule définition) :
  capacité(segment, w) = max(0, floor((L_seg − écartMin) / (w + écartMin)))

Répartition sur un segment :
  écart = (L_seg − Σw) / (n + 1)
  si écart < écartMin → réduire toutes les tailles de 10 % et recommencer,
                        MAX 5 fois ; passé les 5 essais, poser autant d'œuvres
                        que la capacité l'autorise et RENVOYER LE RESTE à
                        l'appelant. Ne jamais laisser deux cadres se chevaucher,
                        et ne jamais lever d'exception.
  si écart > écartMax → plafonner à écartMax et centrer le groupe

Ordre : par étoiles décroissantes DEPUIS LE CENTRE du mur vers les bords.
Hauteur d'axe : 1.45 m (standard muséal, 57 pouces), sauf override.
Les placements `pinned` sont posés d'abord et exclus de la répartition.
```

Le seuil de segment utile est **dérivé de `wMin`, pas constant**. Un seuil figé à 1,20 m déclarerait utiles des segments où rien ne peut tenir : une seule œuvre demande `wMin + 2 × écartMin`, soit 2,20 m au défaut.

La branche terminale de la boucle de réduction doit être explicite. Après cinq réductions les cadres ne font plus que 59 % de leur taille voulue, ce qui annule le signal étoiles→taille ; au-delà, on renvoie le surplus plutôt que de continuer à rétrécir. En pratique cette branche ne doit jamais être atteinte : c'est le contrôle de faisabilité de §7.2 qui garantit la place, la réduction n'est qu'une marge de confort.

### 7.5 Rampe

Hélice autour du vide, du niveau `n` au niveau `n+1`. Rayon = `atriumW/2 − 1.2`, balayage π (demi-tour par niveau), largeur 2,2 m.

Contrôle de sûreté : `pente = atan(rise / (radius × sweep))`. Avec rayon 9 m, balayage π et montée 4,7 m : développé 28,3 m, pente **9,4°**. Le test doit garantir `pente < 40°` pour toute configuration, avec une marge sur les 45° de `maxSlopeClimbAngle`.

Collision : décomposition en segments convexes (un `cuboid` incliné par pas de 10°), pas en trimesh — le contrôleur cinématique se comporte mieux sur des convexes.

## 8. Génération procédurale

| Constructeur | Entrée | Sortie | Test |
|---|---|---|---|
| `buildSlab` | footprint + trous | `BufferGeometry` (`Shape` + `.holes` → `ExtrudeGeometry({ depth, bevelEnabled: false })`) + collider trimesh | trémie 6×6 dans 20×20 → aire = 364 m², aucun collider au-dessus du vide |
| `buildRailing` | périmètre de trou | garde-corps 1,1 m, main courante | périmètre d'une trémie 6×6 = 24 m |
| `buildWall` | segment + ouvertures | mur troué (`Shape` + `.holes`) + collider | somme des aires d'ouvertures conservée |
| `buildRamp` | `Ramp` | plancher extrudé + garde-corps + colliders convexes | pente < 40° pour toute config |
| `buildRoom` | `Room` | groupe : sol, plafond, 4 murs, baie | 4 murs, aucun chevauchement |

Tous purs, tous dans `builders/`, tous testables sans canvas.

**Piège `ExtrudeGeometry` — deux défauts silencieux**, qui touchent `buildSlab`, `buildWall` et `buildRamp` :

- **`bevelEnabled` vaut `true` par défaut** (`bevelThickness` 0,2 ; `bevelSize` 0,1). Sans `bevelEnabled: false`, une dalle demandée en 20×20×0,4 sort avec 20,2 m d'emprise et **0,8 m d'épaisseur** — le double. Aucun test d'aire en 2D ne le détecte : il faut tester la *bounding box* en 3D.
- **La géométrie produite n'est pas indexée** (`geometry.index === null`), alors que `ColliderDesc.trimesh(vertices, indices)` de Rapier exige un `Uint32Array` d'indices. Il faut donc indexer explicitement, ou générer la séquence `0..n-1`, sinon le collider est vide et **le joueur traverse le sol**.

## 9. Rendu et budget de performance

| Poste | Budget | Moyen |
|---|---|---|
| Draw calls | **< 150** | instancing + texture array |
| Triangles | < 500 k | procédural pur, aucun asset importé |
| VRAM textures | < 150 Mo | `DataArrayTexture` 256×128 (32 Mo par atlas de 256), haute définition à la demande |
| Lumières temps réel | **≤ 4** | tout le reste est peint dans le matériau |
| Shadow maps | 1 | la verrière zénithale seule |
| Chargement initial | < 5 Mo | `museum.json` + array + géométrie ; les WebP suivent |
| Images par seconde | ≥ 60 bureau, ≥ 30 mobile | mesuré, pas estimé |

### 9.1 Les toiles en un draw call — **validé par le lot 0**

Une texture par œuvre donnerait N matériaux et N draw calls. À la place : une **`DataArrayTexture`** dont chaque couche est une œuvre, et un `InstancedMesh` dont le shader échantillonne `texture(map, vec3(vUv, aLayer))`, `aLayer` étant un `InstancedBufferAttribute`.

Le spike (`spike/array-texture.ts`, commit `799aebe`) a mesuré sur 256 couches :

| Mesure | Résultat |
|---|---|
| Draw calls | **1** |
| Programmes shader | 1 |
| `MAX_ARRAY_TEXTURE_LAYERS` | 2048 — 8× de marge |
| VRAM | 32 Mo (RGBA 256×128 non compressé) |
| Images/s | 120 |

**Le chemin retenu n'est pas KTX2.** Aucun encodeur (`toktx`, `basisu`) n'est installable : pas de formule Homebrew, pas de paquet npm, et l'installer en CI seulement rendrait le pipeline inexécutable en local. Le transcodeur basis livré avec three ne sert qu'au décodage — il ne produit rien.

Chemin retenu, sans aucune dépendance d'encodage :

```
build (sharp)          →  un atlas WebP unique, 16×16 tuiles de 256×128
                          (4096×2048, ~2 Mo au téléchargement)
chargement (navigateur) →  découpe en DataArrayTexture, 256 couches, 32 Mo VRAM
rendu                   →  InstancedMesh + aLayer → 1 draw call
```

On échange 15 Mo de VRAM supplémentaires contre la suppression complète d'une chaîne d'outils. C'est le bon marché : la VRAM était budgétée à 150 Mo.

**Piège identifié et corrigé par le spike** : `DataArrayTexture` n'applique pas `UNPACK_FLIP_Y_WEBGL`, contrairement aux textures classiques. Les lignes doivent être retournées à la construction (pas dans le shader, pour que le reste du code l'ignore), faute de quoi **toutes les toiles sont accrochées à l'envers**.

Deux niveaux de détail :
- **loin** — couche de la texture array, 256×128, toujours résidente
- **près (< 10 m)** — WebP 1024×512 chargé à la demande, rendu par un mesh individuel qui masque l'instance correspondante

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

**Limite assumée : on ne cure pas depuis le site déployé.** Le flux est forker → `npm run dev` → curer → commiter → l'Action publie.

Le site déployé **n'embarque aucun code d'éditeur** — la contrainte `import.meta.env.DEV` ci-dessus l'exclut du bundle, il ne peut donc pas y exister de « mode brouillon en production ». Il expose seulement un lien statique « Proposer une correction » vers `https://github.com/<owner>/<repo>/edit/main/curation.json`, qui ouvre l'éditeur web GitHub et déclenche le fork automatiquement. Ce lien n'est pas pré-rempli : le paramètre `value` n'est honoré qu'à la *création* d'un fichier (`/new/<branche>?filename=&value=`), il est ignoré à l'édition d'un fichier existant, et le contenu transiterait en GET. C'est un `<a>` dans le chrome de l'interface, pas dans `editor/` : rien ne rentre dans le bundle ni dans le budget du §9.

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
| **0** | ~~Spike texture array~~ — **fait**, commit `799aebe` | 1 draw call pour 256 couches, 120 im/s, mesuré ; chemin `DataArrayTexture` retenu, KTX2 abandonné |
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
| ~~`KTX2Loader` ne gère pas les array textures compressées~~ | **écarté** | Lot 0 : chemin `DataArrayTexture` validé, aucun encodeur requis |
| Clustering IDF produisant des salles absurdes | moyenne | Overrides de curation ; le nommage se corrige en une ligne de JSON |
| 256 œuvres > budget de draw calls malgré l'instancing | faible | Baies étroites déjà choisies ; culling par étage ; réduire `roomsPerFloor` |
| Quota GitHub dépassé en CI | faible | `GITHUB_TOKEN` = **1000 req/h et 1000 pts/h par dépôt**, pas 5000 ; budget mesuré ~10 pts GraphQL pour 115 dépôts (pages de 25) ; cache ; dégradation gracieuse |
| Poids des médias au-delà des 5 Mo initiaux | moyenne | Array seule au chargement (17 Mo mais unique et compressée) ; WebP par proximité |
| La rampe piège le joueur | faible | Pente 9° ; test automatique < 40° ; garde-corps à collision |

## 15. Hors périmètre

Retirés délibérément : multi-joueurs, authentification, backend, base de données, téléversement de médias depuis le site déployé, éditeur en production (remplacé par le flux de proposition GitHub), génération de modèles 3D par IA, WebXR, lightmaps bakées.

L'Epic 3 (audio) et l'Epic 8 (accessibilité) des user stories existantes restent valables mais sortent de ce spec — ils seront traités après le lot 7.
