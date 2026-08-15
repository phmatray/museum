# Pièces en volume — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le musée sait exposer un objet 3D posé sur un socle, avec son cartel, déclaré par l'instance dans `museum.config.json` — la première étant `bavette`, un chat endormi dans un fauteuil en osier.

**Architecture:** Le spec est `docs/superpowers/specs/2026-08-15-sculptures-design.md`. Le découpage du projet est respecté à la lettre : `domain/` décide (pur, sans `three` ni `react`), `builders/` fabrique la géométrie (pur), `scene/` rend et ne décide rien, `tools/blender/` produit l'asset hors CI. La configuration voyage jusqu'à la scène toute seule — `derive()` recopie `config` dans `Museum`, donc `museum.config.sculptures` arrive dans `museum.json` **sans modifier `tools/derive-museum.ts`**.

**Tech Stack:** React 19, R3F 9, three 0.183, Rapier 2, zod 4, zustand 5, vitest 4, TypeScript, Vite 8, Blender 5.2 (hors CI).

## Global Constraints

- **`domain/` et `builders/` n'importent JAMAIS `three` ni `react`.** Exception existante et unique : `builders/` importe `three` (c'est son métier) mais jamais `react`. `domain/` n'importe ni l'un ni l'autre. Tout test tourne sans canvas WebGL.
- **Aucun aléa, aucune horloge** dans `domain/`, `builders/` et `tools/blender/`. Même entrée, même sortie, au flottant près.
- **`ExtrudeGeometry` : toujours `bevelEnabled: false` et indexation explicite.** Sans le premier, 0,25 m d'épaisseur en donne 0,65. Sans la seconde, `geometry.index === null` et le collider trimesh est vide — on traverse le socle.
- **Budget (spec parent §9.5) :** triangles ≤ 1 000 000 sur la vue la plus chère · chargement initial < 5 Mo · lumières ≤ 12 dont ≤ 2 avec ombre. Le juge est `node tools/capture.ts --check`, jamais une estimation.
- **Aucune lumière n'est ajoutée par ce lot.** Le budget de 12 est déjà réparti.
- **Français dans les commentaires et les noms de domaine**, comme tout le dépôt.
- **`.editorconfig` :** LF, UTF-8, 2 espaces pour `.ts`/`.tsx`/`.json`, 4 pour `.py`, newline finale.
- **Commandes :** `npm test` (vitest run) · `npm run lint` · `npm run build` · `npm run derive` (régénère `public/data/museum.json`).

## Préalable

**`node_modules` est absent de ce worktree.** Avant la première tâche :

```bash
npm ci
```

Sans quoi `npm test`, `npm run lint` et `npm run build` échouent tous à la première étape, pour une raison qui n'a rien à voir avec le code écrit.

## Mesures de référence

Elles sont établies et ne sont pas à re-deviner. Source : `~/Downloads/Bavette Catnap Texture.glb`, 80 Mo, générateur `meshy-scene`.

| Grandeur | Valeur |
|---|---|
| Triangles source | 1 954 738 |
| Emprise source | 1,557 × 1,588 × 1,904 unités (Y-up glTF), origine au **centre** |
| Cartes source | 3 × 2048² JPEG |
| Budget retenu | **18 000 triangles**, cartes **1024²** |
| Sortie attendue | GLB Draco ~**340 Ko**, emprise **0,74 × 0,75 × 0,90 m**, origine **au sol** |
| Socle retenu | 1,10 × 1,10 × 0,25 m (débord ≈ 0,18 m) |
| Emplacement | centre de `rdc-honneur`, soit **(0, 0, −10,5)**, face **sud** |

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `src/domain/types.ts` *(modifié)* | `Sculpture`, `SculptureCartel`, `MuseumConfig.sculptures` |
| `src/schema/index.ts` *(modifié)* | `sculptureSchema`, branché dans `museumConfigSchema` |
| `src/domain/sculptures.ts` *(créé)* | décide OÙ : `placeSculptures`, `boiteDeSculpture`, `emprisesDeSculptures`, `sculptureCartelText` |
| `src/domain/props.ts` *(modifié)* | `placeProps` accepte des emprises réservées |
| `src/builders/plinth.ts` *(créé)* | `buildPlinth` → géométrie + collider |
| `tools/blender/build-sculptures.py` *(créé)* | source 80 Mo → GLB commité |
| `public/assets/sculptures/bavette.glb` *(créé, commité)* | l'asset |
| `public/assets/sculptures/SOURCES.md` *(créé)* | provenance + SHA-256 de la source non versionnée |
| `src/scene/sculptureAssets.ts` *(créé)* | chargement GLB mémorisé |
| `src/scene/cartelStyle.ts` *(créé)* | `THEME_INK`, extrait de `Cartel.tsx` |
| `src/scene/SculptureCartel.tsx` *(créé)* | le cartel de socle, autonome |
| `src/scene/SculptureLayer.tsx` *(créé)* | rend pièce + socle + collider |
| `src/scene/MuseumScene.tsx` *(modifié)* | monte `<SculptureLayer>` |
| `museum.config.json` *(modifié)* | l'entrée `bavette` |

⚠️ **`Cartel.tsx` n'est PAS réutilisable pour une sculpture, contrairement à ce qu'annonce le §9 du spec.** `CartelSpec` exige `key: RepoKey`, `wallId`, `u`, `side` : il est ancré sur un mur et indexé par dépôt. Le spec sera corrigé en Task 7.

⚠️ **Pas de découpage par étage, contrairement au §7 du spec.** L'en-tête de `PropsLayer.tsx` documente la mesure : découpés par étage, les props coûtaient 32 draw calls contre 9, sans jamais rien économiser — la boîte d'un plateau inclut le volume balayé par son ombre, et les quatre niveaux sont dans le frustum en même temps depuis presque partout. Une couche unique, comme `CartelLayer` et `PropsLayer`.

---

### Task 1: Le schéma — `sculptures` dans la configuration

**Files:**
- Modify: `src/domain/types.ts` (bloc `MuseumConfig`, ligne 121-144)
- Modify: `src/schema/index.ts` (section « Configuration d'instance », ligne 384-435)
- Test: `src/schema/__tests__/schema.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `Sculpture`, `SculptureCartel` (types), `MuseumConfig.sculptures?: Sculpture[]`, `sculptureSchema`.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à la fin de `src/schema/__tests__/schema.test.ts` :

```ts
describe('parseMuseumConfig — sculptures', () => {
  const base = { schemaVersion: 1, owners: ['phmatray'] }

  it('accepte une config sans sculptures — le cas de tout fork', () => {
    const config = parseMuseumConfig(base)
    expect(config.sculptures).toEqual([])
  })

  it('lit une sculpture complète', () => {
    const config = parseMuseumConfig({
      ...base,
      sculptures: [
        {
          id: 'bavette',
          file: 'bavette.glb',
          height: 0.9,
          facing: 'south',
          plinth: { width: 1.1, depth: 1.1, height: 0.25 },
          cartel: {
            author: 'Philippe Matray',
            title: 'Bavette endormi',
            year: 2026,
            medium: 'Photogrammétrie par IA (Meshy), maillage décimé',
            credit: "Collection de l'artiste",
          },
        },
      ],
    })
    expect(config.sculptures[0].id).toBe('bavette')
    expect(config.sculptures[0].plinth.height).toBe(0.25)
  })

  it('refuse une hauteur nulle ou négative — une pièce plate n’est pas une pièce', () => {
    expect(() =>
      parseMuseumConfig({
        ...base,
        sculptures: [
          {
            id: 'x',
            file: 'x.glb',
            height: 0,
            facing: 'south',
            plinth: { width: 1, depth: 1, height: 0.25 },
            cartel: { title: 'X' },
          },
        ],
      }),
    ).toThrow(/height/)
  })

  it('refuse une orientation inconnue', () => {
    expect(() =>
      parseMuseumConfig({
        ...base,
        sculptures: [
          {
            id: 'x',
            file: 'x.glb',
            height: 1,
            facing: 'nordouest',
            plinth: { width: 1, depth: 1, height: 0.25 },
            cartel: { title: 'X' },
          },
        ],
      }),
    ).toThrow(/facing/)
  })

  it('refuse un cartel sans titre — un socle anonyme n’est pas un cartel', () => {
    expect(() =>
      parseMuseumConfig({
        ...base,
        sculptures: [
          {
            id: 'x',
            file: 'x.glb',
            height: 1,
            facing: 'south',
            plinth: { width: 1, depth: 1, height: 0.25 },
            cartel: {},
          },
        ],
      }),
    ).toThrow(/title/)
  })

  it('refuse deux sculptures de même identifiant — la clé sert de graine et d’index', () => {
    const s = {
      file: 'x.glb',
      height: 1,
      facing: 'south' as const,
      plinth: { width: 1, depth: 1, height: 0.25 },
      cartel: { title: 'X' },
    }
    expect(() =>
      parseMuseumConfig({ ...base, sculptures: [{ ...s, id: 'a' }, { ...s, id: 'a' }] }),
    ).toThrow(/identifiant en double/)
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test -- src/schema/__tests__/schema.test.ts`
Expected: FAIL — `config.sculptures` est `undefined`, et les configs à sculptures sont rejetées par `strictObject` avec « clé inconnue "sculptures" ».

- [ ] **Step 3: Ajouter les types**

Dans `src/domain/types.ts`, juste **avant** `export interface MuseumConfig` (ligne 121) :

```ts
/** Les quatre lignes d'un cartel de sculpture, dans l'ordre où elles se lisent. */
export interface SculptureCartel {
  author?: string
  title: string
  year?: number
  /** Technique. 3ᵉ ligne. */
  medium?: string
  /** Provenance ou appartenance. 4ᵉ ligne. */
  credit?: string
}

/**
 * Une pièce en volume exposée par cette instance.
 *
 * `height` est une DONNÉE et jamais une constante : les générateurs de modèles
 * normalisent leur sortie dans une boîte d'environ deux unités, si bien que
 * l'échelle réelle de l'objet n'est nulle part dans le fichier. La coder en dur
 * donnerait un musée qui ne sait exposer que des objets de cette taille-là.
 *
 * `facing` existe parce qu'une pièce n'est pas forcément lisible sous tous les
 * angles — une reconstruction photogrammétrique ne l'est presque jamais. Sans
 * orientation déclarée, elle serait posée dos au visiteur une fois sur deux.
 *
 * ⚠️ `facing` réutilise `Side` avec un sens DIFFÉRENT de `Room.side`, et les deux
 * se lisent dans ce fichier. `Room.side: 'north'` dit OÙ EST la salle dans
 * l'anneau ; `Sculpture.facing: 'south'` dit VERS OÙ REGARDE la pièce. Une salle
 * au nord reçoit donc une pièce qui regarde au sud : c'est un objet qui fait face
 * à ceux qui entrent, pas une contradiction.
 */
export interface Sculpture {
  /** Slug ; clé stable, et graine de tout déterminisme la concernant. */
  id: string
  /** Nom de fichier, relatif à `public/assets/sculptures/`. */
  file: string
  /** Hauteur réelle visée, en mètres. */
  height: number
  facing: Side
  /**
   * Le socle. C'est une DÉCISION, pas une mesure : l'humain déclare le socle
   * qu'il veut, et un test vérifie que la pièce y tient. L'inverse — déduire le
   * socle de la pièce — obligerait `domain/` à lire un GLB.
   */
  plinth: { width: number; depth: number; height: number }
  /** Identifiant de salle. Absent : la salle d'honneur du niveau 0. */
  room?: string
  cartel: SculptureCartel
}
```

Puis, dans `MuseumConfig`, après le bloc `clustering` (ligne 143) :

```ts
  /** Pièces en volume. Vide sur toute instance qui n'en déclare pas. */
  sculptures: Sculpture[]
```

⚠️ `Side` est déclaré ligne 148, **après** `MuseumConfig`. C'est sans effet : TypeScript ne demande pas qu'un type soit déclaré avant son usage.

- [ ] **Step 4: Ajouter le schéma zod**

Dans `src/schema/index.ts`, importer `MuseumConfig` est déjà fait ; ajouter **avant** `export const museumConfigSchema` (ligne 418) :

```ts
const sideSchema = z.enum(['north', 'east', 'south', 'west'])

const sculptureCartelSchema = z.strictObject({
  author: z.string().min(1).optional(),
  title: z.string().min(1, { error: 'attendu un titre — un socle sans cartel n’expose rien' }),
  year: z.number().int().optional(),
  medium: z.string().min(1).optional(),
  credit: z.string().min(1).optional(),
})

const sculptureSchema = z.strictObject({
  id: z.string().min(1),
  file: z.string().min(1),
  height: z.number().positive({ error: 'attendu une hauteur réelle en mètres, strictement positive' }),
  facing: sideSchema,
  plinth: z.strictObject({
    width: z.number().positive(),
    depth: z.number().positive(),
    height: z.number().nonnegative({ error: 'attendu ≥ 0 ; zéro pose la pièce à même le sol' }),
  }),
  room: z.string().min(1).optional(),
  cartel: sculptureCartelSchema,
})
```

Puis, dans `museumConfigSchema`, après la ligne `clustering: clusteringSchema,` :

```ts
  sculptures: z.array(sculptureSchema).default([]),
```

et remplacer la fermeture `})` du `strictObject` par :

```ts
}).superRefine((config, ctx) => {
  // L'identifiant sert de clé de chargement ET de graine : un doublon ferait
  // charger deux fois le même fichier pour n'en afficher qu'un, sans le dire.
  const vus = new Set<string>()
  config.sculptures.forEach((sculpture, i) => {
    if (vus.has(sculpture.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['sculptures', i, 'id'],
        message: 'identifiant en double — chaque pièce ne peut figurer qu’une fois',
      })
    }
    vus.add(sculpture.id)
  })
})
```

- [ ] **Step 5: Lancer les tests**

Run: `npm test -- src/schema/__tests__/schema.test.ts`
Expected: PASS, toutes.

- [ ] **Step 6: Vérifier que rien d'autre n'a bougé**

Run: `npm test && npm run lint`
Expected: PASS. `museum.config.json` ne déclare pas encore de sculpture et doit continuer à se lire — c'est ce que couvre le premier test.

- [ ] **Step 7: Commit**

```bash
git add src/domain/types.ts src/schema/index.ts src/schema/__tests__/schema.test.ts
git commit -m "feat(schema): une instance peut declarer des pieces en volume

height est une donnee et non une constante : un generateur de modeles
normalise sa sortie dans une boite de deux unites, l'echelle reelle n'est
donc nulle part dans le fichier.

facing reutilise Side avec un sens different de Room.side — l'un dit ou est
la salle, l'autre vers ou regarde la piece. Documente sur le type, parce que
les deux se lisent dans le meme fichier."
```

---

### Task 2: `domain/sculptures.ts` — décider où

**Files:**
- Create: `src/domain/sculptures.ts`
- Test: `src/domain/__tests__/sculptures.test.ts`

**Interfaces:**
- Consumes: `Sculpture`, `Museum`, `Room`, `Floor`, `Vec3`, `Side` de `../types` (Task 1) ; `Boite` de `./props`.
- Produces:
  - `interface SculpturePlacement { id: string; file: string; position: Vec3; rotation: number; height: number; plinth: { width: number; depth: number; height: number }; floorId: string; roomId: string; cartel: SculptureCartel }`
  - `placeSculptures(museum: Museum): SculpturePlacement[]`
  - `boiteDeSculpture(p: SculpturePlacement): Boite`
  - `emprisesDeSculptures(placements: readonly SculpturePlacement[]): EmpriseReservee[]`
  - `sculptureCartelText(cartel: SculptureCartel): string`
  - `yawDeFacing(facing: Side): number`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/domain/__tests__/sculptures.test.ts` :

```ts
/**
 * LOT SCULPTURES — la pièce se pose où il faut, et rien ne la traverse.
 *
 * Comme `props.test.ts`, l'épreuve porte sur le VRAI `public/data/museum.json` :
 * ce sont ses cotes qui sont à l'écran.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { croisent } from '../props'
import {
  boiteDeSculpture,
  placeSculptures,
  sculptureCartelText,
  yawDeFacing,
} from '../sculptures'
import type { Museum, Sculpture } from '../types'

const reel = JSON.parse(
  readFileSync(`${process.cwd()}/public/data/museum.json`, 'utf8'),
) as Museum

const BAVETTE: Sculpture = {
  id: 'bavette',
  file: 'bavette.glb',
  height: 0.9,
  facing: 'south',
  plinth: { width: 1.1, depth: 1.1, height: 0.25 },
  cartel: {
    author: 'Philippe Matray',
    title: 'Bavette endormi',
    year: 2026,
    medium: 'Photogrammétrie par IA (Meshy), maillage décimé',
    credit: "Collection de l'artiste",
  },
}

function avec(sculptures: Sculpture[]): Museum {
  return { ...reel, config: { ...reel.config, sculptures } }
}

describe('placeSculptures', () => {
  it('ne pose rien quand rien n’est déclaré', () => {
    expect(placeSculptures(avec([]))).toEqual([])
  })

  it('pose la pièce au centre de la salle d’honneur du rez-de-chaussée', () => {
    const [p] = placeSculptures(avec([BAVETTE]))
    const rdc = reel.floors.find((f) => f.level === 0)!
    const salle = rdc.rooms[0]
    expect(p.roomId).toBe(salle.id)
    expect(p.floorId).toBe(rdc.id)
    expect(p.position.x).toBeCloseTo(salle.footprint.x + salle.footprint.width / 2, 6)
    expect(p.position.z).toBeCloseTo(salle.footprint.z + salle.footprint.depth / 2, 6)
    expect(p.position.y).toBeCloseTo(rdc.elevation, 6)
  })

  it('tourne la pièce selon facing — sud = lacet nul', () => {
    const [sud] = placeSculptures(avec([BAVETTE]))
    expect(sud.rotation).toBeCloseTo(0, 6)
    const [nord] = placeSculptures(avec([{ ...BAVETTE, facing: 'north' }]))
    expect(nord.rotation).toBeCloseTo(Math.PI, 6)
  })

  it('honore une salle explicite', () => {
    const cible = reel.floors[2].rooms[1]
    const [p] = placeSculptures(avec([{ ...BAVETTE, room: cible.id }]))
    expect(p.roomId).toBe(cible.id)
    expect(p.floorId).toBe(reel.floors[2].id)
  })

  it('écarte une salle inconnue plutôt que de poser la pièce n’importe où', () => {
    expect(placeSculptures(avec([{ ...BAVETTE, room: 'salle-qui-n-existe-pas' }]))).toEqual([])
  })

  it('rend la même liste à deux appels', () => {
    expect(placeSculptures(avec([BAVETTE]))).toEqual(placeSculptures(avec([BAVETTE])))
  })
})

describe('boiteDeSculpture', () => {
  it('couvre le socle en plan et le socle plus la pièce en hauteur', () => {
    const [p] = placeSculptures(avec([BAVETTE]))
    const b = boiteDeSculpture(p)
    expect(b.maxX - b.minX).toBeCloseTo(1.1, 6)
    expect(b.maxZ - b.minZ).toBeCloseTo(1.1, 6)
    expect(b.minY).toBeCloseTo(p.position.y, 6)
    expect(b.maxY).toBeCloseTo(p.position.y + 0.25 + 0.9, 6)
  })

  it('ne croise ni mur, ni ouverture, ni trémie de sa salle', () => {
    const [p] = placeSculptures(avec([BAVETTE]))
    const b = boiteDeSculpture(p)
    const rdc = reel.floors.find((f) => f.level === 0)!
    for (const hole of rdc.slabHoles) {
      expect(
        croisent(b, {
          minX: hole.x,
          maxX: hole.x + hole.width,
          minZ: hole.z,
          maxZ: hole.z + hole.depth,
          minY: rdc.elevation,
          maxY: rdc.elevation + rdc.ceilingHeight,
        }),
      ).toBe(false)
    }
    const salle = rdc.rooms[0]
    for (const wall of salle.walls) {
      expect(
        croisent(b, {
          minX: Math.min(wall.a.x, wall.b.x) - 0.45,
          maxX: Math.max(wall.a.x, wall.b.x) + 0.45,
          minZ: Math.min(wall.a.z, wall.b.z) - 0.45,
          maxZ: Math.max(wall.a.z, wall.b.z) + 0.45,
          minY: rdc.elevation,
          maxY: rdc.elevation + wall.height,
        }),
      ).toBe(false)
    }
  })
})

describe('yawDeFacing', () => {
  it('envoie la face avant (+Z du modèle) sur le point cardinal demandé', () => {
    // Une rotation θ autour de Y envoie +Z sur (sin θ, 0, cos θ).
    const cible: Record<string, [number, number]> = {
      south: [0, 1],
      north: [0, -1],
      east: [1, 0],
      west: [-1, 0],
    }
    for (const [facing, [x, z]] of Object.entries(cible)) {
      const t = yawDeFacing(facing as 'south')
      expect(Math.sin(t)).toBeCloseTo(x, 6)
      expect(Math.cos(t)).toBeCloseTo(z, 6)
    }
  })
})

describe('sculptureCartelText', () => {
  it('rédige les quatre lignes dans l’ordre du cartel', () => {
    expect(sculptureCartelText(BAVETTE.cartel)).toBe(
      'Philippe Matray\nBavette endormi, 2026\nPhotogrammétrie par IA (Meshy), maillage décimé\nCollection de l’artiste'.replace(
        '’',
        "'",
      ),
    )
  })

  it('n’écrit pas de ligne vide quand un champ manque', () => {
    expect(sculptureCartelText({ title: 'Sans titre' })).toBe('Sans titre')
  })

  it('colle l’année au titre plutôt que de lui donner sa propre ligne', () => {
    expect(sculptureCartelText({ title: 'X', year: 2026 })).toBe('X, 2026')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/domain/__tests__/sculptures.test.ts`
Expected: FAIL — `Cannot find module '../sculptures'`.

- [ ] **Step 3: Écrire le module**

Créer `src/domain/sculptures.ts` :

```ts
/**
 * LOT SCULPTURES — où se posent les pièces en volume (spec 2026-08-15).
 *
 * Ce module DÉCIDE. Il ne dessine rien : `scene/SculptureLayer.tsx` prend la
 * liste et la rend. Comme tout ce qui vit dans `domain/`, il n'importe ni
 * `three` ni `react`, et tourne donc dans un test sans canvas.
 *
 * ── Pourquoi une sculpture n'est pas un prop ──
 *
 * `props.ts` sème du mobilier par dizaines, avec un générateur à graine, en
 * acceptant qu'un candidat refusé soit simplement abandonné — « on préfère une
 * salle un peu vide à une salle impraticable ». Une sculpture est l'inverse de
 * ça : elle est unique, elle est voulue à un endroit précis, et si elle ne peut
 * pas y aller il faut le SAVOIR plutôt que la voir disparaître. D'où un module
 * séparé, sans aléa du tout, et un placement qui échoue bruyamment.
 *
 * ── L'ordre compte, et il est structurel ──
 *
 * `placeSculptures` doit tourner AVANT `placeProps`, dont les emprises réservées
 * viennent d'ici. Sans ça, `poserLeBanc` pose son banc face au mur le plus
 * garni, à 2,60 m de ce mur — soit à moins de deux mètres de la pièce dans la
 * salle d'honneur du musée réel.
 */
import type { Boite, EmpriseReservee } from './props'
import type { Floor, Museum, Room, Sculpture, SculptureCartel, Side, Vec3 } from './types'

// ── Contrat public ───────────────────────────────────────────────────────

export interface SculpturePlacement {
  id: string
  file: string
  /**
   * Position MONDE du point d'ancrage : le centre du socle, POSÉ SUR LA DALLE.
   * `position.y` intègre déjà l'élévation du niveau, comme `PropPlacement`.
   */
  position: Vec3
  /** Lacet, en radians, autour de Y. */
  rotation: number
  /** Hauteur réelle de la pièce seule, socle non compris. */
  height: number
  plinth: { width: number; depth: number; height: number }
  floorId: string
  roomId: string
  cartel: SculptureCartel
}

// ── Orientation ──────────────────────────────────────────────────────────

/**
 * Lacet qui met la face avant de la pièce vers le point cardinal demandé.
 *
 * Convention : le modèle exporté regarde +Z, et le nord du musée est −Z (le cap
 * 0 du point d'apparition, `derive.ts`). Une rotation θ autour de Y envoie +Z
 * sur (sin θ, 0, cos θ), d'où la table.
 *
 * `tools/blender/build-sculptures.py` est ce qui GARANTIT la convention : il
 * oriente chaque pièce pour que sa face avant regarde +Z avant d'exporter.
 */
export function yawDeFacing(facing: Side): number {
  switch (facing) {
    case 'south':
      return 0
    case 'east':
      return Math.PI / 2
    case 'north':
      return Math.PI
    case 'west':
      return -Math.PI / 2
  }
}

// ── Placement ────────────────────────────────────────────────────────────

/**
 * Pose les pièces déclarées par l'instance.
 *
 * Pur : même musée, même liste, dans l'ordre de `config.sculptures`.
 *
 * Une pièce dont la salle est introuvable est ÉCARTÉE, pas repliée sur une
 * salle par défaut : un identifiant fautif doit produire une absence visible,
 * pas une pièce silencieusement déplacée à l'autre bout du bâtiment.
 */
export function placeSculptures(museum: Museum): SculpturePlacement[] {
  const placements: SculpturePlacement[] = []

  for (const sculpture of museum.config.sculptures ?? []) {
    const hote = trouverSalle(museum, sculpture)
    if (hote === null) continue
    const { floor, room } = hote

    placements.push({
      id: sculpture.id,
      file: sculpture.file,
      position: {
        x: room.footprint.x + room.footprint.width / 2,
        y: floor.elevation,
        z: room.footprint.z + room.footprint.depth / 2,
      },
      rotation: yawDeFacing(sculpture.facing),
      height: sculpture.height,
      plinth: sculpture.plinth,
      floorId: floor.id,
      roomId: room.id,
      cartel: sculpture.cartel,
    })
  }

  return placements
}

/**
 * La salle qui reçoit la pièce.
 *
 * Sans `room`, c'est la PREMIÈRE salle du niveau 0 — la salle d'honneur, seule
 * salle réelle de ce niveau (les côtés vides reçoivent des galeries aveugles,
 * qui n'y figurent pas). C'est le lieu qui dit « ceci est la collection ».
 */
function trouverSalle(
  museum: Museum,
  sculpture: Sculpture,
): { floor: Floor; room: Room } | null {
  if (sculpture.room !== undefined) {
    for (const floor of museum.floors) {
      const room = floor.rooms.find((r) => r.id === sculpture.room)
      if (room !== undefined) return { floor, room }
    }
    return null
  }

  const rdc = museum.floors.find((f) => f.level === 0)
  if (rdc === undefined || rdc.rooms.length === 0) return null
  return { floor: rdc, room: rdc.rooms[0] }
}

// ── Emprise ──────────────────────────────────────────────────────────────

/**
 * L'emprise de la pièce posée.
 *
 * En plan, c'est le SOCLE et non la pièce : le socle la contient par
 * construction (un test le vérifie sur le GLB réel), et c'est lui qu'on ne doit
 * pas heurter du pied. En hauteur, socle plus pièce.
 */
export function boiteDeSculpture(p: SculpturePlacement): Boite {
  return {
    minX: p.position.x - p.plinth.width / 2,
    maxX: p.position.x + p.plinth.width / 2,
    minZ: p.position.z - p.plinth.depth / 2,
    maxZ: p.position.z + p.plinth.depth / 2,
    minY: p.position.y,
    maxY: p.position.y + p.plinth.height + p.height,
  }
}

/** Ce que `placeProps` doit réserver avant de semer quoi que ce soit. */
export function emprisesDeSculptures(
  placements: readonly SculpturePlacement[],
): EmpriseReservee[] {
  return placements.map((p) => ({ floorId: p.floorId, boite: boiteDeSculpture(p) }))
}

// ── Cartel ───────────────────────────────────────────────────────────────

/**
 * Les quatre lignes d'un cartel de musée.
 *
 * L'année rejoint le TITRE plutôt que d'occuper sa ligne : c'est la convention
 * muséographique, et une ligne « 2026 » seule sur un cartel de socle se lit
 * comme une erreur de mise en page.
 */
export function sculptureCartelText(cartel: SculptureCartel): string {
  const titre = cartel.year === undefined ? cartel.title : `${cartel.title}, ${cartel.year}`
  return [cartel.author, titre, cartel.medium, cartel.credit]
    .filter((ligne): ligne is string => ligne !== undefined && ligne !== '')
    .join('\n')
}
```

- [ ] **Step 4: Lancer le test**

Run: `npm test -- src/domain/__tests__/sculptures.test.ts`
Expected: FAIL sur `EmpriseReservee`, qui n'existe pas encore dans `props.ts` (Task 3). Les autres tests passent.

⚠️ **Ne pas créer `EmpriseReservee` ici pour débloquer.** Elle appartient à `props.ts`, qui la consomme ; la déclarer des deux côtés en ferait deux types qui divergent. Enchaîner directement sur la Task 3, qui la crée.

- [ ] **Step 5: Commit (partiel, assumé)**

```bash
git add src/domain/sculptures.ts src/domain/__tests__/sculptures.test.ts
git commit -m "feat(domain): decider ou se pose une piece en volume

Module separe de props.ts, et pas une extension : props seme du mobilier par
dizaines en acceptant qu'un candidat refuse disparaisse. Une sculpture est
unique et voulue a un endroit precis — si elle ne peut pas y aller, il faut le
savoir. D'ou zero alea, et une salle introuvable qui ecarte au lieu de replier
sur un defaut.

La suite ne compile pas encore : EmpriseReservee appartient a props.ts, qui la
consomme, et la declarer des deux cotes en ferait deux types qui divergent."
```

---

### Task 3: `placeProps` réserve les emprises de sculpture

**Files:**
- Modify: `src/domain/props.ts` (contrat public ligne 49-100, `placeProps` ligne 375-408)
- Test: `src/domain/__tests__/props.test.ts`

**Interfaces:**
- Consumes: `Boite` (existe déjà, ligne 293).
- Produces: `interface EmpriseReservee { floorId: string; boite: Boite }` · `placeProps(museum: Museum, reservees?: readonly EmpriseReservee[]): PropPlacement[]`.

⚠️ Le second paramètre a une valeur par défaut : **tous les appels existants restent valides**, y compris `placeProps(museum)` dans `PropsLayer.tsx` et les 20 tests de `props.test.ts`.

⚠️ `props.ts` n'importe PAS `sculptures.ts`. La dépendance va dans l'autre sens : `sculptures.ts` importe le type `EmpriseReservee`. Un import croisé rendrait les deux modules inséparables.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `src/domain/__tests__/props.test.ts`. Ajouter d'abord aux imports existants :

```ts
import { placeSculptures, emprisesDeSculptures, boiteDeSculpture } from '../sculptures'
import type { Sculpture } from '../types'
```

puis à la fin du fichier :

```ts
describe('placeProps — les emprises réservées', () => {
  const BAVETTE: Sculpture = {
    id: 'bavette',
    file: 'bavette.glb',
    height: 0.9,
    facing: 'south',
    plinth: { width: 1.1, depth: 1.1, height: 0.25 },
    cartel: { title: 'Bavette endormi' },
  }
  const avecPiece = { ...museum, config: { ...museum.config, sculptures: [BAVETTE] } }
  const sculptures = placeSculptures(avecPiece)
  const reservees = emprisesDeSculptures(sculptures)
  const propsAvecPiece = placeProps(avecPiece, reservees)

  it('la sculpture est bien posée, sinon ce test ne prouve rien', () => {
    expect(sculptures).toHaveLength(1)
  })

  it('AUCUN prop ne croise l’emprise de la sculpture', () => {
    const boite = boiteDeSculpture(sculptures[0])
    const fautifs = propsAvecPiece
      .filter((p) => p.floorId === sculptures[0].floorId)
      .filter((p) => croisent(boiteDuProp(p), boite))
      .map((p) => `${p.id} en (${p.position.x.toFixed(2)}, ${p.position.z.toFixed(2)})`)
    expect(fautifs).toEqual([])
  })

  it('sans réservation, le mobilier ENVAHIT la place — sinon le test n’a pas de dents', () => {
    const boite = boiteDeSculpture(sculptures[0])
    const sansReservation = placeProps(avecPiece)
      .filter((p) => p.floorId === sculptures[0].floorId)
      .filter((p) => croisent(boiteDuProp(p), boite))
    expect(sansReservation.length).toBeGreaterThan(0)
  })

  it('ne réserve que sur le niveau concerné', () => {
    const autresNiveaux = placeProps(avecPiece, reservees).filter(
      (p) => p.floorId !== sculptures[0].floorId,
    )
    expect(autresNiveaux).toEqual(
      placeProps(museum).filter((p) => p.floorId !== sculptures[0].floorId),
    )
  })
})
```

⚠️ Le troisième test est le seul qui donne du sens aux deux premiers : si le mobilier ne tombait de toute façon jamais là, réserver ne prouverait rien. **S'il échoue, ne pas le supprimer** — il signifie que le placement a changé et que l'invariant n'est plus mis à l'épreuve ; il faut alors trouver un autre point de contact, pas baisser la garde.

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/domain/__tests__/props.test.ts`
Expected: FAIL — `placeProps` n'accepte qu'un argument, et `emprisesDeSculptures` n'est pas résolu.

- [ ] **Step 3: Ajouter le type et le paramètre**

Dans `src/domain/props.ts`, ajouter après la déclaration de `Boite` (après la ligne 300) :

```ts
/**
 * Une emprise que le placement doit contourner, déjà occupée par autre chose.
 *
 * Elle existe pour les pièces en volume (`domain/sculptures.ts`), mais son type
 * ne les nomme pas : ce module n'a pas à savoir CE QUI occupe la place, seulement
 * qu'elle est prise. C'est aussi ce qui évite un import croisé entre les deux
 * modules — la dépendance ne va que dans un sens.
 */
export interface EmpriseReservee {
  floorId: string
  boite: Boite
}
```

Puis remplacer la signature et l'initialisation de `poses` dans `placeProps` (ligne 375 et ligne 385) :

```ts
export function placeProps(
  museum: Museum,
  reservees: readonly EmpriseReservee[] = [],
): PropPlacement[] {
  const resultat: PropPlacement[] = []

  for (const floor of museum.floors) {
    const obstacles = obstaclesDuNiveau(museum, floor)
    // Les props déjà posés deviennent à leur tour des obstacles : sans ça, deux
    // salles adjacentes peuvent poser chacune une jardinière de part et d'autre
    // d'une cloison mince et les faire se chevaucher au travers.
    //
    // Les emprises RÉSERVÉES sont semées ici, avant tout le reste : une pièce en
    // volume est posée par un autre module, et le mobilier doit la contourner
    // exactement comme il contourne un banc déjà placé. Les semer dans `poses`
    // plutôt que dans `obstacles` n'est pas un détail — c'est ce qui leur donne
    // le jeu de `ENTRE_PROPS`, c'est-à-dire de quoi passer devant.
    const poses: Boite[] = reservees
      .filter((r) => r.floorId === floor.id)
      .map((r) => r.boite)
```

Le reste du corps de `placeProps` est inchangé.

- [ ] **Step 4: Lancer les tests**

Run: `npm test -- src/domain/__tests__/props.test.ts src/domain/__tests__/sculptures.test.ts`
Expected: PASS, y compris les 20 tests existants de `props.test.ts` (le paramètre est optionnel).

- [ ] **Step 5: Lancer toute la suite**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/props.ts src/domain/__tests__/props.test.ts
git commit -m "feat(domain): le mobilier contourne les emprises reservees

placeProps accepte des emprises deja occupees, semees dans `poses` et non dans
`obstacles` : c'est ce qui leur donne le jeu d'ENTRE_PROPS, donc de quoi passer
devant plutot que de raser la piece.

Le type ne nomme pas les sculptures. props.ts n'a pas a savoir CE QUI occupe la
place, seulement qu'elle est prise — et la dependance ne va ainsi que dans un
sens.

Le test 'sans reservation, le mobilier ENVAHIT la place' est ce qui donne des
dents aux deux autres : sans lui, ils passeraient meme si rien ne tombait
jamais la."
```

---

### Task 4: `builders/plinth.ts` — le socle

**Files:**
- Create: `src/builders/plinth.ts`
- Test: `src/builders/__tests__/plinth.test.ts`

**Interfaces:**
- Consumes: `TrimeshCollider` de `./slab` (exporté ligne 39).
- Produces: `interface PlinthResult { geometry: THREE.BufferGeometry; collider: TrimeshCollider }` · `buildPlinth(width: number, depth: number, height: number): PlinthResult`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/builders/__tests__/plinth.test.ts` :

```ts
/**
 * LOT SCULPTURES — le socle a les cotes demandées, et il est solide.
 *
 * Les deux épreuves visent les deux pièges d'`ExtrudeGeometry` documentés au §8
 * du spec parent, qui échouent tous deux EN SILENCE : le biseau, que seule une
 * bounding box 3D détecte, et l'absence d'index, qui vide le collider.
 */
import { describe, expect, it } from 'vitest'

import { buildPlinth } from '../plinth'

describe('buildPlinth', () => {
  it('a exactement les cotes demandées — le biseau est le piège', () => {
    const { geometry } = buildPlinth(1.1, 1.1, 0.25)
    geometry.computeBoundingBox()
    const b = geometry.boundingBox!
    expect(b.max.x - b.min.x).toBeCloseTo(1.1, 6)
    expect(b.max.z - b.min.z).toBeCloseTo(1.1, 6)
    // 0,25 et non 0,65 : sans `bevelEnabled: false`, le chanfrein s'ajoute sur
    // les deux faces et l'épaisseur demandée sort au plus du double.
    expect(b.max.y - b.min.y).toBeCloseTo(0.25, 6)
  })

  it('pose sa base en y = 0 et son dessus à la hauteur demandée', () => {
    const { geometry } = buildPlinth(1.1, 1.1, 0.25)
    geometry.computeBoundingBox()
    expect(geometry.boundingBox!.min.y).toBeCloseTo(0, 6)
    expect(geometry.boundingBox!.max.y).toBeCloseTo(0.25, 6)
  })

  it('est centré sur son origine en plan', () => {
    const { geometry } = buildPlinth(1.1, 0.8, 0.25)
    geometry.computeBoundingBox()
    const b = geometry.boundingBox!
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(0, 6)
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(0, 6)
  })

  it('rend une géométrie INDEXÉE — sans quoi le collider est vide', () => {
    const { geometry } = buildPlinth(1.1, 1.1, 0.25)
    expect(geometry.getIndex()).not.toBeNull()
  })

  it('rend un collider non vide, en Uint32Array', () => {
    const { collider } = buildPlinth(1.1, 1.1, 0.25)
    expect(collider.indices).toBeInstanceOf(Uint32Array)
    expect(collider.indices.length).toBeGreaterThan(0)
    expect(collider.vertices.length).toBeGreaterThan(0)
    expect(collider.indices.length % 3).toBe(0)
    // Les huit coins d'une boîte, une fois soudés.
    expect(collider.vertices.length / 3).toBe(8)
  })

  it('refuse une cote non positive plutôt que de rendre un socle dégénéré', () => {
    expect(() => buildPlinth(0, 1.1, 0.25)).toThrow(RangeError)
    expect(() => buildPlinth(1.1, 1.1, 0)).toThrow(RangeError)
    expect(() => buildPlinth(1.1, -1, 0.25)).toThrow(RangeError)
  })

  it('est déterministe, sommet pour sommet', () => {
    const a = buildPlinth(1.1, 1.1, 0.25).geometry.getAttribute('position').array
    const b = buildPlinth(1.1, 1.1, 0.25).geometry.getAttribute('position').array
    expect(Array.from(a)).toEqual(Array.from(b))
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/builders/__tests__/plinth.test.ts`
Expected: FAIL — `Cannot find module '../plinth'`.

- [ ] **Step 3: Écrire le constructeur**

Créer `src/builders/plinth.ts` :

```ts
/**
 * LOT SCULPTURES — le socle d'une pièce en volume (spec 2026-08-15 §7).
 *
 * Un prisme droit, centré sur son origine en plan, base en y = 0 : le point
 * d'ancrage que `domain/sculptures.ts` calcule est donc directement le centre du
 * socle posé sur la dalle, et la scène n'a rien à corriger.
 *
 * ── Pourquoi une BoxGeometry et pas une ExtrudeGeometry ──
 *
 * `buildSlab` extrude parce qu'une dalle est un rectangle TROUÉ, ce qu'une boîte
 * ne sait pas être. Un socle n'a pas de trou. La boîte évite donc d'un seul coup
 * les deux pièges du §8 — pas de biseau à désactiver, et `BoxGeometry` est déjà
 * indexée. Ce fichier les teste quand même : le jour où quelqu'un donnera un
 * chanfrein au socle, il basculera sur `ExtrudeGeometry` et les tests seront là.
 *
 * Aucun aléa, aucune horloge.
 */
import * as THREE from 'three'

import type { TrimeshCollider } from './slab'

export interface PlinthResult {
  geometry: THREE.BufferGeometry
  collider: TrimeshCollider
}

/** Quantum de soudure des sommets, identique à `builders/slab.ts`. */
const WELD_QUANTUM = 1e-4

/**
 * Construit un socle de `width` × `depth` × `height`, centré en plan sur
 * l'origine, sa base en y = 0.
 */
export function buildPlinth(width: number, depth: number, height: number): PlinthResult {
  if (width <= 0 || depth <= 0 || height <= 0) {
    throw new RangeError(`buildPlinth: cote non positive (${width}×${depth}×${height})`)
  }

  const geometry = new THREE.BoxGeometry(width, height, depth)
  // `BoxGeometry` est centrée sur son origine dans les trois axes : on la remonte
  // d'une demi-hauteur pour que sa base repose sur le plan de la dalle.
  geometry.translate(0, height / 2, 0)

  return { geometry, collider: toTrimesh(geometry) }
}

/**
 * Maillage de collision, sommets coïncidents soudés.
 *
 * Rapier n'utilise que les positions : les 24 sommets de `BoxGeometry` — trois
 * par coin, un par face, pour que les normales des arêtes vives restent
 * distinctes — se ramènent aux 8 coins réels.
 */
function toTrimesh(geometry: THREE.BufferGeometry): TrimeshCollider {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const source = index
    ? Array.from({ length: index.count }, (_, i) => index.getX(i))
    : Array.from({ length: position.count }, (_, i) => i)

  const vertices: number[] = []
  const indices: number[] = []
  const vus = new Map<string, number>()

  for (const sommet of source) {
    const x = position.getX(sommet)
    const y = position.getY(sommet)
    const z = position.getZ(sommet)
    const cle = `${quantise(x)}|${quantise(y)}|${quantise(z)}`
    let soude = vus.get(cle)
    if (soude === undefined) {
      soude = vertices.length / 3
      vus.set(cle, soude)
      vertices.push(x, y, z)
    }
    indices.push(soude)
  }

  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) }
}

function quantise(valeur: number): number {
  // `+ 0` neutralise le −0, qui donnerait une clé distincte de celle de 0.
  return Math.round(valeur / WELD_QUANTUM) + 0
}
```

- [ ] **Step 4: Lancer le test**

Run: `npm test -- src/builders/__tests__/plinth.test.ts`
Expected: PASS, les 7.

- [ ] **Step 5: Commit**

```bash
git add src/builders/plinth.ts src/builders/__tests__/plinth.test.ts
git commit -m "feat(builders): un socle aux cotes demandees

Une BoxGeometry et non une ExtrudeGeometry : un socle n'a pas de trou, donc les
deux pieges du §8 — le biseau et l'index absent — ne se posent pas. Les tests
les verifient quand meme : le jour ou le socle recevra un chanfrein, il faudra
extruder, et la garde sera deja la."
```

---

### Task 5: L'asset — Blender, le GLB commité, et la provenance

**Files:**
- Create: `tools/blender/build-sculptures.py`
- Create: `public/assets/sculptures/bavette.glb` *(binaire, commité)*
- Create: `public/assets/sculptures/SOURCES.md`
- Modify: `.gitignore`
- Modify: `public/assets/CREDITS.md`

**Interfaces:**
- Consumes: `~/Downloads/Bavette Catnap Texture.glb` (hors dépôt).
- Produces: `public/assets/sculptures/bavette.glb` — 18 000 triangles, 0,74 × 0,75 × 0,90 m, origine au sol, face avant vers +Z.

⚠️ **Ce lot n'a pas de test rouge d'abord** : il produit un binaire, pas du code. Sa vérification est la Task 6, qui MESURE le fichier produit. Ne pas passer à la Task 6 avant que ce lot soit fini.

- [ ] **Step 1: Ouvrir le `.gitignore` aux sculptures**

Dans `.gitignore`, après le bloc des trois exceptions Blender (après la ligne `!public/assets/plants/park-lod.glb`), ajouter :

```gitignore
# QUATRIÈME exception, même raison que les trois précédentes : produite par
# `tools/blender/build-sculptures.py`, et la CI n'a pas Blender.
#
# Différence avec les trois autres, et elle compte : leur SOURCE se retélécharge
# (`node tools/fetch-assets.ts`), celle-ci non — c'est un fichier personnel de
# 80 Mo qui n'a pas sa place dans un dépôt public. La reproductibilité est donc
# conditionnelle, et `SOURCES.md` dit de quoi.
!public/assets/sculptures/
public/assets/sculptures/*
!public/assets/sculptures/bavette.glb
!public/assets/sculptures/SOURCES.md
```

- [ ] **Step 2: Écrire le script Blender**

Créer `tools/blender/build-sculptures.py` :

```python
"""
Ramène une pièce en volume aux cotes et au budget du musée.

    blender --background --python tools/blender/build-sculptures.py -- \
        bavette "/chemin/vers/Bavette Catnap Texture.glb"

Produit `public/assets/sculptures/<id>.glb`.

── Pourquoi ──

Un générateur de modèles 3D produit du maillage de RENDU : la source de Bavette
pèse 1 954 738 triangles et 6,5 Mo de cartes 2048², pour un objet vu entre 1,5 et
21 m. Le budget géométrique du musée entier est de 1 000 000 (spec parent §9.5),
et la vue la plus chère en consomme déjà ~938 000 : posée brute, cette seule
pièce doublerait le budget de la scène.

18 000 est un chiffre REGARDÉ, pas estimé — trois décimations rendues de face à
2 m, œil à 1,62 m. À 8 000 le plaid et la lisse du fauteuil montrent des facettes
franches ; à 40 000 l'écart avec 18 000 est invisible pour 2,2 fois le coût.

Même méthode et même leçon que `decimate-plants.py` : « 6 000 était BEAUCOUP trop
bas, et le défaut ne se voyait pas dans les chiffres — l'arbre sort en
SQUELETTE ». Un budget de triangles ne se choisit pas dans un tableur.

── Ce que le script GARANTIT, et dont le reste du code dépend ──

  1. l'échelle est RÉELLE — la source est normalisée dans une boîte de deux
     unités, donc son échelle ne veut rien dire ;
  2. l'origine est AU SOL et centrée en plan — c'est le point d'ancrage que
     `domain/sculptures.ts` calcule, la convention du kit de props ;
  3. la face avant regarde +Z — c'est la convention de `yawDeFacing()`.

Déterministe : aucun aléa, aucune horloge.
"""

import sys
from pathlib import Path

import bpy
import mathutils

ROOT = Path(__file__).resolve().parents[2]
SORTIE = ROOT / "public" / "assets" / "sculptures"

# Budget de triangles, cote maximale des cartes, hauteur réelle et rotation de
# mise en face, PAR PIÈCE.
#
# `front_yaw` est en degrés autour de Z (l'axe vertical de Blender), appliqué
# AVANT l'export. Il amène la face avant de la pièce sur −Y de Blender, qui
# devient +Z après l'export Y-up — la convention de `yawDeFacing()`. Zéro quand
# la source est déjà dans le bon sens, ce qui est le cas de Bavette : vérifié en
# rendant les quatre quarts de tour de la source.
PIECES = {
    "bavette": {
        "triangles": 18_000,
        "textures": 1024,
        "hauteur": 0.90,
        "front_yaw": 0.0,
    },
}

# En dessous, décimer abîme plus qu'il n'allège : un maillage déjà économe n'a
# pas d'arêtes courtes à effondrer, et le collapse attaque directement sa forme.
PLANCHER = 1_200


def triangles(obj) -> int:
    """Triangles réels, quads compris : une face de n côtés en vaut n − 2."""
    return sum(max(0, len(p.vertices) - 2) for p in obj.data.polygons)


def emprise(objets):
    """Bornes monde, transformations de nœud comprises. Blender est Z-up."""
    xs, ys, zs = [], [], []
    for o in objets:
        for coin in o.bound_box:
            p = o.matrix_world @ mathutils.Vector(coin)
            xs.append(p.x)
            ys.append(p.y)
            zs.append(p.z)
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))


def redimensionner_textures(cote: int) -> None:
    """
    Ramène chaque carte à `cote` pixels de côté au plus.

    2048² pour une pièce d'un mètre vue à 1,5 m est un déséquilibre : à ce
    cadrage la carte est échantillonnée bien en dessous, et le reste n'est que
    de la VRAM et du temps de téléchargement. 1024 et non 512 — le réglage des
    plantes — parce que celle-ci se regarde de près, et que c'est tout l'objet
    d'une pièce exposée.
    """
    for img in bpy.data.images:
        if max(img.size) <= cote:
            continue
        avant = tuple(img.size)
        facteur = cote / max(avant)
        img.scale(max(1, int(avant[0] * facteur)), max(1, int(avant[1] * facteur)))
        print(f"SCULPT_TEX {img.name:22} {avant[0]}×{avant[1]} -> {img.size[0]}×{img.size[1]}")


def construire(identifiant: str, source: Path) -> None:
    reglage = PIECES.get(identifiant)
    if reglage is None:
        print(f"SCULPT_INCONNUE {identifiant} — ajoute-la à PIECES")
        sys.exit(1)
    if not source.exists():
        print(f"SCULPT_MANQUANTE {source}")
        sys.exit(1)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    objets = [o for o in bpy.data.objects if o.type == "MESH"]
    if not objets:
        print("SCULPT_VIDE aucun maillage importé")
        sys.exit(1)

    depart = sum(triangles(o) for o in objets)

    # 3. LA MISE EN FACE, d'abord : elle change l'emprise, donc elle doit
    #    précéder le recentrage.
    if reglage["front_yaw"] != 0.0:
        for o in objets:
            o.rotation_euler.rotate_axis("Z", reglage["front_yaw"] * 3.14159265358979 / 180)
    bpy.context.view_layer.update()

    # 1. L'ÉCHELLE RÉELLE. Z est la verticale de Blender.
    (_, _), (_, _), (z0, z1) = emprise(objets)
    facteur = reglage["hauteur"] / (z1 - z0)
    for o in objets:
        o.scale = (facteur, facteur, facteur)
    bpy.context.view_layer.update()

    # 2. L'ANCRAGE : centré en X et Y, base posée sur Z = 0.
    (x0, x1), (y0, y1), (z0, z1) = emprise(objets)
    for o in objets:
        o.location = (
            o.location.x - (x0 + x1) / 2,
            o.location.y - (y0 + y1) / 2,
            o.location.z - z0,
        )
    bpy.context.view_layer.update()

    # LA DÉCIMATION. Un budget par PIÈCE et non par objet : la pièce est ce
    # qu'on expose, et c'est son total qui compte dans le budget de la scène.
    for o in objets:
        depart_obj = triangles(o)
        if depart_obj <= reglage["triangles"]:
            continue
        part = max(PLANCHER, int(reglage["triangles"] * depart_obj / depart))
        bpy.context.view_layer.objects.active = o
        mod = o.modifiers.new(name="Allegement", type="DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = part / depart_obj
        bpy.ops.object.modifier_apply(modifier=mod.name)

    redimensionner_textures(reglage["textures"])

    SORTIE.mkdir(parents=True, exist_ok=True)
    fichier = SORTIE / f"{identifiant}.glb"
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(fichier),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_yup=True,
    )

    arrive = sum(triangles(o) for o in objets)
    (x0, x1), (y0, y1), (z0, z1) = emprise(objets)
    print(
        f"SCULPT {identifiant} : {depart} -> {arrive} tri "
        f"({100 * arrive / depart:.2f} %) · {fichier.stat().st_size / 1024:.0f} Ko · "
        f"emprise {x1 - x0:.3f}×{y1 - y0:.3f}×{z1 - z0:.3f} m"
    )


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :]
    if len(argv) != 2:
        print("usage: … -- <identifiant> <chemin/vers/source.glb>")
        sys.exit(1)
    construire(argv[0], Path(argv[1]))


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Produire le GLB**

Run:
```bash
blender --background --python tools/blender/build-sculptures.py -- \
  bavette "$HOME/Downloads/Bavette Catnap Texture.glb" 2>&1 | grep -E "SCULPT"
```
Expected: une ligne `SCULPT bavette : 1954738 -> 18000 tri (0.92 %) · ~340 Ko · emprise 0.740×0.750×0.900 m`. Les cotes peuvent varier de ±0,02 m ; la hauteur, non — elle est imposée.

- [ ] **Step 4: Vérifier l'orientation À L'ŒIL, pas au raisonnement**

La convention « face avant vers +Z » est ce dont dépend `yawDeFacing()`. Un raisonnement sur les repères Blender/glTF est exactement le genre de chose qui se trompe d'un signe sans que rien ne le dise.

Écrire `/tmp/verif-face.py` :

```python
import sys, math, bpy, mathutils
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])
objets = [o for o in bpy.data.objects if o.type == "MESH"]
xs, ys, zs = [], [], []
for o in objets:
    for c in o.bound_box:
        p = o.matrix_world @ mathutils.Vector(c)
        xs.append(p.x); ys.append(p.y); zs.append(p.z)
cx, cz = (min(xs)+max(xs))/2, (min(zs)+max(zs))/2
taille = max(max(xs)-min(xs), max(ys)-min(ys), max(zs)-min(zs))
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = scene.render.resolution_y = 512
w = bpy.data.worlds.new("W"); scene.world = w
w.use_nodes = True; w.node_tree.nodes["Background"].inputs[1].default_value = 1.3
cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
scene.collection.objects.link(cam); scene.camera = cam
# Le +Z de glTF est le −Y de Blender après import : on se place DEVANT.
cam.location = (cx, min(ys) - taille * 2.0, cz + taille * 0.35)
cible = mathutils.Vector((cx, (min(ys)+max(ys))/2, cz))
cam.rotation_euler = (cible - cam.location).to_track_quat("-Z", "Y").to_euler()
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", type="SUN"))
sun.data.energy = 3.5; sun.rotation_euler = (math.radians(55), 0, math.radians(35))
scene.collection.objects.link(sun)
scene.render.filepath = argv[1]
bpy.ops.render.render(write_still=True)
```

Run:
```bash
blender --background --python /tmp/verif-face.py -- \
  "$PWD/public/assets/sculptures/bavette.glb" /tmp/face.png 2>&1 | tail -1
```

Puis **ouvrir `/tmp/face.png` et regarder**. Attendu : le fauteuil de face, Bavette endormi visible dans l'assise, le plaid rose sur le devant.

Si on voit le panneau d'osier fermé, la pièce est à l'envers : poser `"front_yaw": 180.0` dans `PIECES["bavette"]`, relancer l'étape 3, et re-vérifier. Un quart de tour se corrige par 90 ou −90.

- [ ] **Step 5: Écrire la provenance**

Run: `shasum -a 256 "$HOME/Downloads/Bavette Catnap Texture.glb"`

Créer `public/assets/sculptures/SOURCES.md` en y reportant le hash obtenu :

```markdown
# Sources des pièces en volume

Les GLB de ce dossier sont **commités** : ils sont produits par
`tools/blender/build-sculptures.py`, et la CI n'a pas Blender. C'est la même
exception que le kit de props et les LOD de végétation.

Leurs SOURCES, en revanche, ne sont pas versionnées. Le dépôt est public et
elles pèsent des dizaines de mégaoctets. La reproductibilité est donc
**conditionnelle** : rejouable à condition de disposer du fichier source, et ce
tableau dit exactement lequel.

| Pièce | Fichier source | SHA-256 | Provenance | Licence |
|---|---|---|---|---|
| `bavette.glb` | `Bavette Catnap Texture.glb` (80 Mo) | `<HASH>` | Meshy (`meshy-scene`), à partir d'une photographie de Philippe Matray | © Philippe Matray — tous droits réservés |

## Reconstruire

```bash
blender --background --python tools/blender/build-sculptures.py -- \
  bavette "/chemin/vers/Bavette Catnap Texture.glb"
```

Le budget de triangles et la cote des cartes vivent dans `PIECES`, en tête du
script, avec la mesure qui les justifie.
```

- [ ] **Step 6: Corriger l'en-tête de CREDITS.md**

`public/assets/CREDITS.md` ouvre sur « Tous en CC0 (domaine public) », ce qui devient faux dès ce commit. Remplacer les trois premières lignes du fichier par :

```markdown
# Assets

Les assets **récupérés** — matières, HDRI, végétation — sont tous en CC0
(domaine public). Aucune attribution n'est requise ; elle est donnée par
correction et pour documenter la provenance.

Les **pièces en volume** de `sculptures/` n'en font pas partie : ce sont des
œuvres de l'auteur du musée, tous droits réservés. Leur provenance et leur
licence sont dans `sculptures/SOURCES.md`.
```

Puis ajouter en fin de tableau :

```markdown
| bavette | Meshy, d'après une photo de l'auteur | © tous droits réservés | pièce en volume, salle d'honneur |
```

- [ ] **Step 7: Vérifier que git suit bien le GLB**

Run: `git status --porcelain public/assets/sculptures/`
Expected: trois lignes `??` — `bavette.glb`, `SOURCES.md`. Si `bavette.glb` n'apparaît pas, l'exception du `.gitignore` est mal écrite : vérifier avec `git check-ignore -v public/assets/sculptures/bavette.glb`.

- [ ] **Step 8: Commit**

```bash
git add .gitignore public/assets/CREDITS.md public/assets/sculptures/
git commit -m "feat(assets): Bavette, ramene de 1 954 738 triangles a 18 000

La source pese deux fois le budget geometrique de TOUTE la scene. 18 000 est un
chiffre regarde et non estime : trois decimations rendues de face a 2 m, oeil a
1,62 m. A 8 000 le plaid et la lisse du fauteuil facettent ; a 40 000 l'ecart
avec 18 000 est invisible pour 2,2 fois le cout.

Le script garantit trois choses dont le reste du code depend : echelle reelle
(la source est normalisee dans une boite de deux unites), origine au sol et
centree en plan, face avant vers +Z.

Quatrieme exception au .gitignore, meme raison que les trois autres — la CI n'a
pas Blender. Difference qui compte : leur source se retelecharge, celle-ci non.
SOURCES.md porte le SHA-256 de la source non versionnee.

CREDITS.md n'affirme plus que tout est CC0 : ce fichier-ci ne l'est pas."
```

---

### Task 6: `scene/sculptureAssets.ts` — charger, et prouver ce qu'on a commité

**Files:**
- Create: `src/scene/sculptureAssets.ts`
- Test: `src/scene/__tests__/sculptureAssets.test.ts`

**Interfaces:**
- Consumes: `bavette.glb` (Task 5) ; `lireGltf`, `bornesDuNoeud` de `../../domain/__tests__/glbBounds` (test seulement).
- Produces: `type SculptureAssets = ReadonlyMap<string, THREE.Object3D>` · `sculptureAssetsResource(fichiers: readonly string[], base?: string): Promise<SculptureAssets>` · `SCULPTURE_DIR = 'assets/sculptures/'` · `SCULPTURE_BUDGET_TRIANGLES = 18_000`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/scene/__tests__/sculptureAssets.test.ts` :

```ts
/**
 * Le GLB COMMITÉ tient ses cotes et son budget.
 *
 * Même parti que `propAssets.test.ts` pour `PROP_METRICS` : le budget de
 * triangles et l'échelle réelle sont écrits en commentaire dans le script
 * Blender, et rien ne les maintiendrait vrais. Une pièce reconstruite avec un
 * autre réglage passerait tous les tests de placement — qui ne lisent que le
 * JSON — tout en doublant le budget de la scène ou en sortant à la mauvaise
 * taille. Le commentaire devient donc une épreuve.
 *
 * Aucun décodage : les positions sont compressées en Draco, mais la
 * spécification glTF EXIGE que l'accesseur POSITION porte ses `min` et `max`.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { bornesDuNoeud, lireGltf } from '../../domain/__tests__/glbBounds'
import { SCULPTURE_BUDGET_TRIANGLES } from '../sculptureAssets'

const CHEMIN = `${process.cwd()}/public/assets/sculptures/bavette.glb`
const gltf = lireGltf(CHEMIN)

/** Le socle déclaré dans `museum.config.json`, que la pièce doit habiter. */
const SOCLE = { width: 1.1, depth: 1.1 }

/** La hauteur déclarée dans `museum.config.json`. */
const HAUTEUR = 0.9

describe('bavette.glb', () => {
  it('ne dépasse pas le budget de triangles', () => {
    let total = 0
    for (const mesh of gltf.meshes ?? []) {
      for (const prim of mesh.primitives) {
        // Draco stocke le compte dans l'extension ; à défaut, l'accesseur
        // d'index ou de position le porte.
        const p = prim as unknown as { indices?: number; attributes: Record<string, number> }
        const acc =
          p.indices !== undefined
            ? gltf.accessors?.[p.indices]
            : gltf.accessors?.[p.attributes.POSITION]
        total += Math.floor(((acc as { count?: number })?.count ?? 0) / 3)
      }
    }
    expect(total).toBeGreaterThan(0)
    expect(total).toBeLessThanOrEqual(SCULPTURE_BUDGET_TRIANGLES)
  })

  it('fait exactement la hauteur déclarée par la configuration', () => {
    const b = bornesDuNoeud(gltf, nomDuNoeud())!
    expect(b.max[1] - b.min[1]).toBeCloseTo(HAUTEUR, 2)
  })

  it('a son origine AU SOL — c’est le point d’ancrage que domain/ calcule', () => {
    const b = bornesDuNoeud(gltf, nomDuNoeud())!
    expect(b.min[1]).toBeCloseTo(0, 2)
  })

  it('est centrée en plan sur son origine', () => {
    const b = bornesDuNoeud(gltf, nomDuNoeud())!
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(0, 2)
    expect((b.min[2] + b.max[2]) / 2).toBeCloseTo(0, 2)
  })

  it('TIENT SUR SON SOCLE — c’est ce qui justifie que l’emprise soit celle du socle', () => {
    const b = bornesDuNoeud(gltf, nomDuNoeud())!
    expect(b.max[0] - b.min[0]).toBeLessThanOrEqual(SOCLE.width)
    expect(b.max[2] - b.min[2]).toBeLessThanOrEqual(SOCLE.depth)
  })

  it('pèse moins que le budget de chargement qu’on lui accorde', () => {
    expect(readFileSync(CHEMIN).byteLength).toBeLessThan(600 * 1024)
  })
})

/** Le nœud racine du fichier, quel que soit le nom que Blender lui a donné. */
function nomDuNoeud(): string {
  const nom = (gltf.nodes ?? []).find((n) => n.name !== undefined)?.name
  if (nom === undefined) throw new Error('bavette.glb : aucun nœud nommé')
  return nom
}
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/scene/__tests__/sculptureAssets.test.ts`
Expected: FAIL — `Cannot find module '../sculptureAssets'`.

- [ ] **Step 3: Écrire le chargeur**

Créer `src/scene/sculptureAssets.ts` :

```ts
/**
 * LOT SCULPTURES — le chargement des pièces en volume.
 *
 * `domain/sculptures.ts` a décidé OÙ. Ce module dit AVEC QUOI : il ramène les
 * GLB commités et les rend tels quels.
 *
 * ── Pourquoi on ne réduit rien, contrairement à `propAssets.ts` ──
 *
 * `propAssets` fusionne les primitives d'un prop en une géométrie à couleurs de
 * sommet, parce qu'un banc est instancié vingt fois et que chaque matière de
 * plus coûte un lot d'instances. Une sculpture est UNIQUE : il n'y a rien à
 * instancier, donc rien à gagner à fusionner — et beaucoup à perdre, puisque la
 * fusion jette les cartes, c'est-à-dire tout ce qui fait exister une
 * reconstruction photogrammétrique.
 *
 * Le fichier arrive déjà à la bonne échelle, ancré au sol et orienté : c'est
 * `tools/blender/build-sculptures.py` qui le garantit, et
 * `__tests__/sculptureAssets.test.ts` qui le vérifie sur le fichier réel.
 */
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/** Les pièces chargées, indexées par nom de fichier. Vide si tout a échoué. */
export type SculptureAssets = ReadonlyMap<string, THREE.Object3D>

export const SCULPTURE_DIR = 'assets/sculptures/'
export const DRACO_PATH = 'draco/'

/**
 * Budget de triangles d'une pièce, et le chiffre que le test fait respecter.
 *
 * Regardé et non estimé : trois décimations rendues de face à 2 m, œil à
 * 1,62 m. À 8 000 le plaid et la lisse du fauteuil facettent ; à 40 000 l'écart
 * avec 18 000 est invisible pour 2,2 fois le coût.
 */
export const SCULPTURE_BUDGET_TRIANGLES = 18_000

const cache = new Map<string, Promise<SculptureAssets>>()

/**
 * Charge les pièces demandées, une fois par jeu de fichiers.
 *
 * Mémorisé comme `propAssetsResource()` : sans ça, un remontage du calque
 * retéléchargerait le fichier.
 */
export function sculptureAssetsResource(
  fichiers: readonly string[],
  base: string = import.meta.env.BASE_URL,
): Promise<SculptureAssets> {
  const cle = `${base}|${[...fichiers].sort().join(',')}`
  let promesse = cache.get(cle)
  if (promesse === undefined) {
    promesse = charger(fichiers, base).catch((erreur: unknown) => {
      // Le musée reste visitable sans ses sculptures : on le signale, on ne fait
      // pas tomber la scène. Même parti que l'atlas des œuvres et le mobilier.
      console.error('sculptures indisponibles', erreur)
      return new Map<string, THREE.Object3D>()
    })
    cache.set(cle, promesse)
  }
  return promesse
}

async function charger(
  fichiers: readonly string[],
  base: string,
): Promise<SculptureAssets> {
  const gltf = new GLTFLoader()
  const draco = new DRACOLoader()
  draco.setDecoderPath(`${base}${DRACO_PATH}`)
  gltf.setDRACOLoader(draco)

  const pieces = new Map<string, THREE.Object3D>()
  for (const fichier of fichiers) {
    try {
      const charge = await gltf.loadAsync(`${base}${SCULPTURE_DIR}${fichier}`)
      // Les pièces ne projettent pas d'ombre — la seule shadow map du bâtiment
      // est celle de la verrière (§9.2) — mais elles en REÇOIVENT, sans quoi une
      // pièce posée dans le puits de lumière brillerait à travers l'ombre de la
      // dalle. Même réglage que les props.
      charge.scene.traverse((objet) => {
        if (objet instanceof THREE.Mesh) {
          objet.castShadow = false
          objet.receiveShadow = true
        }
      })
      pieces.set(fichier, charge.scene)
    } catch (erreur) {
      // Une pièce manquante ne doit pas emporter les autres : elles sont
      // indépendantes, et une config qui en déclare trois doit en montrer deux.
      console.warn(`sculpture « ${fichier} » introuvable`, erreur)
    }
  }

  // Le décodeur garde un worker vivant tant qu'on ne le libère pas.
  draco.dispose()
  return pieces
}
```

- [ ] **Step 4: Lancer le test**

Run: `npm test -- src/scene/__tests__/sculptureAssets.test.ts`
Expected: PASS, les 6.

Si « TIENT SUR SON SOCLE » échoue, c'est que l'emprise réelle dépasse 1,10 m : **élargir le socle dans `museum.config.json` et dans le test**, ne jamais rétrécir la pièce — le socle est la variable libre, la pièce ne l'est pas.

- [ ] **Step 5: Lancer toute la suite**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scene/sculptureAssets.ts src/scene/__tests__/sculptureAssets.test.ts
git commit -m "feat(scene): charger les pieces, et prouver ce qu'on a commite

Aucune fusion de primitives, contrairement a propAssets : une piece est unique,
il n'y a rien a instancier donc rien a gagner — et la fusion jetterait les
cartes, c'est-a-dire tout ce qui fait exister une reconstruction
photogrammetrique.

Le test mesure le GLB REEL : budget de triangles, hauteur, ancrage au sol,
centrage, et surtout qu'il tient sur le socle declare. Sans lui, une piece
reconstruite avec un autre reglage passerait tous les tests de placement — qui
ne lisent que le JSON — en doublant le budget de la scene."
```

---

### Task 7: Le cartel de socle

**Files:**
- Create: `src/scene/cartelStyle.ts`
- Create: `src/scene/SculptureCartel.tsx`
- Modify: `src/scene/Cartel.tsx` (supprimer `THEME_INK`, l'importer)
- Modify: `docs/superpowers/specs/2026-08-15-sculptures-design.md` (§9)

**Interfaces:**
- Consumes: `sculptureCartelText` de `../domain/sculptures` (Task 2) · `CARTEL_MAX_DISTANCE`, `CARTEL_WIDTH` de `../domain/cartels` · `SculpturePlacement` (Task 2).
- Produces: `THEME_INK: Record<ThemeId, string>` (dans `cartelStyle.ts`) · `<SculptureCartel placement={…} theme={…} />`.

⚠️ **`THEME_INK` déménage dans un `.ts` et non dans un `.tsx`.** La règle eslint `react-refresh/only-export-components` interdit d'exporter autre chose qu'un composant depuis un `.tsx` — `propAssets.ts` documente déjà exactement cette contrainte.

- [ ] **Step 1: Extraire `THEME_INK`**

Créer `src/scene/cartelStyle.ts` :

```ts
/**
 * La couleur d'encre des cartels, par thème de salle.
 *
 * Dans un `.ts` et non dans le `.tsx` du composant : eslint interdit d'exporter
 * autre chose qu'un composant depuis un fichier `.tsx` (`react-refresh`), et
 * cette table est désormais lue par DEUX composants — le cartel d'œuvre, ancré
 * sur un mur, et le cartel de socle, qui ne l'est pas.
 */
import type { ThemeId } from '../domain/types'

export const THEME_INK: Record<ThemeId, string> = {
  // Recopier ici, à l'identique, le contenu du THEME_INK actuel de Cartel.tsx
  // (ligne 64). Ne rien changer : ce lot déplace, il ne redécore pas.
}
```

Puis, dans `src/scene/Cartel.tsx` : supprimer la déclaration `const THEME_INK` (ligne 64 et suivantes) et ajouter aux imports `import { THEME_INK } from './cartelStyle'`.

- [ ] **Step 2: Vérifier que rien n'a bougé à l'écran**

Run: `npm test && npm run lint && npm run build`
Expected: PASS. Aucun test ne devrait changer de résultat — c'est un déplacement pur.

- [ ] **Step 3: Écrire le cartel de socle**

Créer `src/scene/SculptureCartel.tsx` :

```tsx
/**
 * LOT SCULPTURES — le cartel posé sur un socle.
 *
 * ── Pourquoi il ne réutilise pas `Cartel.tsx` ──
 *
 * `CartelSpec` exige `key: RepoKey`, `wallId`, `u` et `side` : il est ancré sur
 * un MUR et indexé par DÉPÔT. Une pièce en volume n'a ni l'un ni l'autre. Le
 * spec annonçait une réutilisation directe ; c'était faux, et le forcer aurait
 * demandé une clé factice dans un index de dépôts — exactement l'option écartée
 * au §3 du spec pour la curation.
 *
 * Ce qui EST réutilisé, c'est ce qui doit l'être : la table d'encre
 * (`cartelStyle.ts`) et le seuil de distance de `domain/cartels.ts`. Deux
 * cartels du même bâtiment ne peuvent pas avoir deux couleurs ni deux portées.
 *
 * ── Pourquoi aucun pool ──
 *
 * `CartelLayer` gère seize cases parce qu'il y a cent œuvres. Il y a UNE pièce.
 * Un pool, une hystérésis et une cadence d'évaluation à 10 Hz seraient trois
 * mécanismes pour arbitrer entre un seul candidat et lui-même.
 */
import { useMemo, useRef } from 'react'
import { Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { CARTEL_MAX_DISTANCE, CARTEL_WIDTH } from '../domain/cartels'
import type { SculpturePlacement } from '../domain/sculptures'
import { sculptureCartelText } from '../domain/sculptures'
import type { ThemeId } from '../domain/types'
import { THEME_INK } from './cartelStyle'

/**
 * Corps du texte, en mètres. Plus gros que le cartel mural (0,026) : celui-ci
 * se lit debout, en plongée, depuis un mètre et demi — pas le nez sur un mur.
 */
const TAILLE = 0.032

const INTERLIGNE = 1.35

/** Retrait du cartel par rapport à l'arête avant du socle, en mètres. */
const RETRAIT = 0.06

/** Relief du texte au-dessus du dessus du socle. */
const RELIEF = 0.004

export interface SculptureCartelProps {
  placement: SculpturePlacement
  theme: ThemeId
}

/**
 * Le cartel, couché sur le dessus du socle, devant la pièce.
 *
 * Couché et non vertical : un socle de 25 cm n'a pas de joue assez haute pour
 * porter un texte lisible, et c'est de toute façon ainsi qu'on pose un cartel
 * sur un socle bas — à plat, au bord, du côté d'où l'on regarde.
 */
export function SculptureCartel({ placement, theme }: SculptureCartelProps) {
  const groupe = useRef<THREE.Group>(null)
  const texte = useMemo(() => sculptureCartelText(placement.cartel), [placement.cartel])

  // Le cartel s'éteint au-delà du seuil des cartels d'œuvre. Ce n'est pas une
  // économie de draw call — il n'y en a qu'un — c'est de la cohérence : deux
  // étiquettes du même bâtiment ne doivent pas apparaître à deux distances.
  useFrame(({ camera }) => {
    const noeud = groupe.current
    if (noeud === null) return
    const d = camera.position.distanceTo(noeud.getWorldPosition(new THREE.Vector3()))
    noeud.visible = d <= CARTEL_MAX_DISTANCE
  })

  return (
    <group
      ref={groupe}
      position={[placement.position.x, placement.position.y + placement.plinth.height + RELIEF, placement.position.z]}
      rotation={[0, placement.rotation, 0]}
    >
      <Text
        // Couché sur le socle, tête vers la pièce : on le lit en baissant les
        // yeux depuis le bord du socle.
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, placement.plinth.depth / 2 - RETRAIT]}
        fontSize={TAILLE}
        lineHeight={INTERLIGNE}
        maxWidth={CARTEL_WIDTH * 2}
        anchorX="center"
        anchorY="bottom"
        textAlign="center"
        color={THEME_INK[theme]}
      >
        {texte}
      </Text>
    </group>
  )
}
```

- [ ] **Step 4: Corriger le spec, qui annonçait l'inverse**

Dans `docs/superpowers/specs/2026-08-15-sculptures-design.md`, remplacer la première phrase du §9 par :

```markdown
Le cartel de sculpture est un composant AUTONOME, `scene/SculptureCartel.tsx`,
couché sur le dessus du socle du côté `facing`.

⚠️ Une première rédaction de ce spec annonçait « `Cartel.tsx` est réutilisé tel
quel ». C'était faux : `CartelSpec` exige `key: RepoKey`, `wallId`, `u` et
`side` — il est ancré sur un mur et indexé par dépôt, et une pièce en volume n'a
ni l'un ni l'autre. Le forcer aurait demandé une clé factice dans un index de
dépôts, c'est-à-dire exactement l'option écartée au §3 pour la curation. Ce qui
est réellement partagé, c'est la table d'encre (`scene/cartelStyle.ts`, extraite
pour l'occasion) et le seuil de distance de `domain/cartels.ts` : deux cartels
du même bâtiment ne peuvent avoir ni deux couleurs ni deux portées.
```

- [ ] **Step 5: Vérifier**

Run: `npm test && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scene/cartelStyle.ts src/scene/Cartel.tsx src/scene/SculptureCartel.tsx docs/superpowers/specs/2026-08-15-sculptures-design.md
git commit -m "feat(scene): le cartel d'un socle n'est pas celui d'un mur

CartelSpec exige key: RepoKey, wallId, u et side — il est ancre sur un mur et
indexe par depot. Une piece en volume n'a ni l'un ni l'autre, et le forcer
aurait demande une cle factice dans un index de depots : exactement l'option
que le spec ecarte pour la curation.

Ce qui est partage l'est vraiment : la table d'encre, extraite dans un .ts parce
qu'eslint interdit d'exporter autre chose qu'un composant depuis un .tsx, et le
seuil de distance. Deux cartels du meme batiment ne peuvent pas avoir deux
couleurs ni deux portees.

Aucun pool : CartelLayer arbitre entre cent oeuvres et seize cases, il y a ici
une piece.

Le spec annoncait la reutilisation directe. Corrige sur place plutot que
propage."
```

---

### Task 8: `SculptureLayer` — la voir, et ne pas la traverser

**Files:**
- Create: `src/scene/SculptureLayer.tsx`
- Modify: `src/scene/MuseumScene.tsx` (imports, et montage après `<PropsLayer>` ligne 473)
- Modify: `src/scene/PropsLayer.tsx` (passer les emprises réservées à `placeProps`)

**Interfaces:**
- Consumes: `placeSculptures`, `emprisesDeSculptures` de `../domain/sculptures` · `sculptureAssetsResource` de `./sculptureAssets` · `buildPlinth` de `../builders/plinth` · `SculptureCartel` de `./SculptureCartel` · `matiereDeDalle`, `useMatiere` de `./materials`.
- Produces: `<SculptureLayer museum={museum} />`.

- [ ] **Step 1: Écrire le calque**

Créer `src/scene/SculptureLayer.tsx` :

```tsx
/**
 * LOT SCULPTURES — les pièces en volume à l'écran.
 *
 * Ce composant NE DÉCIDE RIEN : `domain/sculptures.ts` a posé chaque pièce,
 * `builders/plinth.ts` a fabriqué son socle, `sculptureAssets.ts` a chargé son
 * modèle.
 *
 * ── UNE couche, pas une par étage ──
 *
 * Même parti que `CartelLayer` et `PropsLayer`, et pour la raison MESURÉE que
 * l'en-tête de `PropsLayer` documente : découpés par étage, les props coûtaient
 * 32 draw calls contre 9 sans jamais rien économiser, parce que la boîte d'un
 * plateau inclut le volume balayé par son ombre et que les quatre niveaux sont
 * dans le frustum en même temps depuis presque partout. Ici la question ne se
 * pose même pas — il y a une pièce.
 *
 * ── Le collider, une rupture assumée ──
 *
 * `PropsLayer` n'en pose AUCUN : on traverse les bancs, les socles et les
 * plantes du musée. Cette pièce-ci en reçoit un, et c'est délibéré — c'est la
 * seule chose du bâtiment que le visiteur est explicitement invité à approcher
 * et à contourner, et la traverser serait le défaut le plus visible du musée.
 * Un cuboïde sur l'emprise du socle : une boîte convexe, ce que le contrôleur
 * cinématique gère le mieux.
 *
 * Poser des colliders sur les props existants est une décision qui les concerne
 * TOUS et qui se prendra pour eux — pas dans le sillage d'une pièce.
 */
import { useEffect, useMemo, useState } from 'react'
import { CuboidCollider, RigidBody } from '@react-three/rapier'

import { buildPlinth } from '../builders/plinth'
import { placeSculptures } from '../domain/sculptures'
import type { SculpturePlacement } from '../domain/sculptures'
import type { Museum, ThemeId } from '../domain/types'
import { SculptureCartel } from './SculptureCartel'
import { matiereDeDalle, useMatiere } from './materials'
import type { SculptureAssets } from './sculptureAssets'
import { sculptureAssetsResource } from './sculptureAssets'

export interface SculptureLayerProps {
  museum: Museum
}

export function SculptureLayer({ museum }: SculptureLayerProps) {
  const placements = useMemo(() => placeSculptures(museum), [museum])
  const fichiers = useMemo(() => placements.map((p) => p.file), [placements])
  const assets = useSculptureAssets(fichiers)

  if (placements.length === 0) return null

  return (
    <group name="sculptures">
      {placements.map((placement) => (
        <UneSculpture
          key={placement.id}
          placement={placement}
          objet={assets?.get(placement.file) ?? null}
          theme={themeDeSalle(museum, placement)}
        />
      ))}
    </group>
  )
}

interface UneSculptureProps {
  placement: SculpturePlacement
  objet: import('three').Object3D | null
  theme: ThemeId
}

function UneSculpture({ placement, objet, theme }: UneSculptureProps) {
  const { plinth } = placement
  const socle = useMemo(
    () => buildPlinth(plinth.width, plinth.depth, plinth.height),
    [plinth.width, plinth.depth, plinth.height],
  )
  // Le socle porte la matière du sol du rez-de-chaussée — terrazzo. Un socle de
  // musée est du même matériau que le lieu : c'est ce qui le fait lire comme un
  // élément du bâtiment et non comme un meuble posé là.
  const matiere = useMatiere(matiereDeDalle(0))

  // La géométrie du socle est allouée par ce composant : sans libération, chaque
  // rechargement à chaud en laisse une en VRAM.
  useEffect(() => () => socle.geometry.dispose(), [socle])

  const { x, y, z } = placement.position

  return (
    <group position={[x, y, z]}>
      <mesh geometry={socle.geometry} material={matiere} castShadow={false} receiveShadow />

      {/*
        La pièce est déjà à l'échelle, ancrée au sol et orientée vers +Z : c'est
        `build-sculptures.py` qui le garantit et `sculptureAssets.test.ts` qui le
        vérifie sur le fichier réel. Il ne reste qu'à la monter sur son socle et
        à lui donner son lacet.
      */}
      {objet !== null && (
        <group position={[0, plinth.height, 0]} rotation={[0, placement.rotation, 0]}>
          <primitive object={objet} />
        </group>
      )}

      {/*
        Le collider couvre le socle ET la pièce : `CuboidCollider` prend des
        DEMI-dimensions, et son origine est son centre — d'où le décalage d'une
        demi-hauteur.
      */}
      <RigidBody type="fixed" colliders={false} name={`sculpture:${placement.id}`}>
        <CuboidCollider
          args={[
            plinth.width / 2,
            (plinth.height + placement.height) / 2,
            plinth.depth / 2,
          ]}
          position={[0, (plinth.height + placement.height) / 2, 0]}
        />
      </RigidBody>

      <SculptureCartel placement={{ ...placement, position: { x: 0, y: 0, z: 0 } }} theme={theme} />
    </group>
  )
}

/** Le thème de la salle qui accueille la pièce ; `classic` si elle a disparu. */
function themeDeSalle(museum: Museum, placement: SculpturePlacement): ThemeId {
  for (const floor of museum.floors) {
    const room = floor.rooms.find((r) => r.id === placement.roomId)
    if (room !== undefined) return room.theme
  }
  return 'classic'
}

/**
 * Les modèles, sans suspendre.
 *
 * Même parti que `usePropAssets` : `use()` resuspendrait l'arbre ENTIER sous le
 * `<Suspense>` du canvas — physique et joueur compris — après que le musée est
 * déjà affiché. Le bâtiment apparaît d'abord, la pièce ensuite.
 */
function useSculptureAssets(fichiers: readonly string[]): SculptureAssets | null {
  const [assets, setAssets] = useState<SculptureAssets | null>(null)
  const cle = fichiers.join(',')

  useEffect(() => {
    let vivant = true
    void sculptureAssetsResource(cle === '' ? [] : cle.split(',')).then((charges) => {
      if (vivant) setAssets(charges)
    })
    return () => {
      vivant = false
    }
  }, [cle])

  return assets
}
```

⚠️ Le `placement` passé à `<SculptureCartel>` a sa position remise à zéro : le cartel est monté DANS le groupe déjà translaté, ses coordonnées y sont donc locales. Sans ça la pièce serait décalée deux fois.

⚠️ **`CuboidCollider` n'a PAS pu être vérifié contre le paquet** — `node_modules` était absent du worktree au moment d'écrire ce plan. Ce qui est établi : `RoomMesh.tsx:31` importe `TrimeshCollider` de `@react-three/rapier`, donc la famille des composants collider existe bien dans cette version. `CuboidCollider` en est un export standard de la v2, mais **le confirmer à la première compilation** plutôt que de le supposer. S'il n'existe pas sous ce nom, l'équivalent est `<RigidBody type="fixed" colliders="cuboid">` enveloppant un maillage aux dimensions voulues — c'est ce que fait `ParkLayer.tsx:97`.

- [ ] **Step 2: Réserver les emprises dans `PropsLayer`**

Dans `src/scene/PropsLayer.tsx`, ajouter aux imports :

```tsx
import { emprisesDeSculptures, placeSculptures } from '../domain/sculptures'
```

et remplacer la ligne 63 :

```tsx
  // Les emprises des pièces en volume sont réservées AVANT que quoi que ce soit
  // ne soit semé : sans ça, `poserLeBanc` pose son banc face au mur le plus
  // garni, à 2,60 m de ce mur — soit à moins de deux mètres de la pièce dans la
  // salle d'honneur du musée réel. L'ordre est un invariant du spec, pas une
  // commodité, et `props.test.ts` le tient.
  const parType = useMemo(
    () => grouperParType(placeProps(museum, emprisesDeSculptures(placeSculptures(museum)))),
    [museum],
  )
```

- [ ] **Step 3: Monter le calque**

Dans `src/scene/MuseumScene.tsx`, ajouter aux imports (après `import { PropsLayer } from './PropsLayer'`, ligne 71) :

```tsx
import { SculptureLayer } from './SculptureLayer'
```

et, juste **après** `<PropsLayer museum={museum} />` (ligne 473) :

```tsx
      {/*
        Les pièces en volume déclarées par l'instance (spec 2026-08-15).

        APRÈS les props dans le JSX, mais leur emprise est réservée AVANT dans le
        calcul : `PropsLayer` sème son mobilier en contournant ce que
        `placeSculptures` a posé. L'ordre du JSX, lui, n'a aucune incidence — il
        n'y a pas de tri de transparence ici.

        C'est le seul objet du bâtiment qui porte un collider sans être du
        bâtiment : on ne traverse pas une pièce qu'on est venu regarder.
      */}
      <SculptureLayer museum={museum} />
```

- [ ] **Step 4: Vérifier que tout compile et que les tests tiennent**

Run: `npm test && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scene/SculptureLayer.tsx src/scene/PropsLayer.tsx src/scene/MuseumScene.tsx
git commit -m "feat(scene): la piece est a l'ecran, et on ne la traverse pas

Un collider la, aucun sur les props : c'est une incoherence assumee. On traverse
les bancs du musee, et c'est sans consequence — personne ne va les inspecter.
Cette piece-ci est la seule que le visiteur est explicitement invite a approcher
et a contourner ; la traverser serait le defaut le plus visible du batiment,
pour le prix d'une boite convexe.

PropsLayer reserve les emprises avant de semer : sinon poserLeBanc met son banc
a moins de deux metres de la piece, dans la salle d'honneur du musee reel."
```

---

### Task 9: Déclarer Bavette, et mesurer le budget

**Files:**
- Modify: `museum.config.json`
- Modify: `public/data/museum.json` *(régénéré)*

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: le musée publié, avec sa pièce.

- [ ] **Step 1: Déclarer la pièce**

Dans `museum.config.json`, ajouter après le bloc `clustering` :

```json
  "sculptures": [
    {
      "id": "bavette",
      "file": "bavette.glb",
      "height": 0.9,
      "facing": "south",
      "plinth": { "width": 1.1, "depth": 1.1, "height": 0.25 },
      "cartel": {
        "author": "Philippe Matray",
        "title": "Bavette endormi",
        "year": 2026,
        "medium": "Photogrammétrie par IA (Meshy), maillage décimé",
        "credit": "Collection de l'artiste"
      }
    }
  ]
```

- [ ] **Step 2: Régénérer le musée**

Run: `npm run derive`
Expected: le compte de niveaux et de salles est INCHANGÉ — une sculpture ne modifie pas la disposition. Vérifier ensuite :

```bash
node -e "const m=require('./public/data/museum.json'); console.log(JSON.stringify(m.config.sculptures))"
```
Expected: l'entrée `bavette`. C'est ce qui prouve que la config traverse `derive()` sans que `tools/derive-museum.ts` ait été touché.

- [ ] **Step 3: Lancer toute la suite sur le musée régénéré**

Run: `npm test`
Expected: PASS. `props.test.ts` et `sculptures.test.ts` lisent le `museum.json` réel, qui contient désormais la pièce.

⚠️ Si `props.test.ts` échoue maintenant sur un test ANTÉRIEUR à ce lot, c'est le signal utile : le mobilier de la salle d'honneur a bougé pour faire place. Vérifier que le déplacement est légitime (aucun prop dans un mur) avant d'ajuster quoi que ce soit.

- [ ] **Step 4: Mesurer le budget — le seul juge**

Run: `node tools/capture.ts --check`
Expected: sortie 0. Le §12 du spec parent le rappelle : « une mesure manquante vaut `Infinity` et non zéro » — lire la sortie et vérifier que les lignes triangles ET draw calls portent bien un chiffre, pas une absence.

Si les triangles dépassent 1 000 000 : redescendre `PIECES["bavette"]["triangles"]` à 12 000 dans `tools/blender/build-sculptures.py`, relancer la Task 5 étape 3, **re-regarder le rendu** comme au premier choix de budget, puis rejouer cette étape. Ne pas relever le plafond.

- [ ] **Step 5: Regarder le résultat**

Run: `npm run dev`, puis, dans la console du navigateur :

```js
__MUSEUM__.survol(0, 2.4, -6, 0, 1.2, -10.5)   // depuis la baie, vers la pièce
await __MUSEUM__.mesure()
```

Vérifier de ses yeux les quatre choses que seul l'écran peut dire :
1. le fauteuil est **de face** — on voit Bavette dans l'assise, pas un panneau d'osier ;
2. il est **posé** sur le socle, ni enfoncé ni flottant ;
3. le cartel est **lisible** et ne déborde pas du socle ;
4. depuis le point d'apparition (`__MUSEUM__.survol(0, 1.62, 10.5, 0, 1.2, -10.5)`), la pièce est **cadrée par la baie**.

Puis, à pied — c'est ce qui prouve le collider :

```js
__MUSEUM__.demarrer()
```
Marcher jusqu'à la pièce et vérifier qu'on **bute** dessus au lieu de la traverser.

- [ ] **Step 6: Commit**

```bash
git add museum.config.json public/data/museum.json
git commit -m "feat: Bavette endormi entre en salle d'honneur

Au centre de (0, -10,5), face au sud : cadree par la baie depuis le point
d'apparition, a 21 m, puis grossissant a mesure qu'on contourne le vide. La mise
en scene n'est pas inventee, elle est lue dans le batiment — le cap 0 du spawn
et le centre de la baie a x = 0 la dessinaient deja.

La config traverse derive() sans que tools/derive-museum.ts soit touche : Museum
recopie config, donc museum.config.sculptures arrive tout seul jusqu'a la scene.

Budget verifie par tools/capture.ts --check, pas estime."
```

---

## Auto-revue du plan

**Couverture du spec** — chaque section a sa tâche :

| Spec | Tâche |
|---|---|
| §4 modèle de données | Task 1 |
| §5.1 socle bas | Tasks 4, 9 (la cote vit dans la config) |
| §5.2 emplacement et axe | Task 2, vérifié Task 9 étape 5 |
| §5.3 ordre de placement | Task 3 (le test), Task 8 (le câblage) |
| §6 chaîne d'asset, budget, source | Task 5 |
| §7 modules | Tasks 2, 4, 6, 7, 8 |
| §8 collider | Task 8 |
| §9 cartel | Task 7 |
| §10 budget | Task 9 étape 4 |
| §11 tests | Tasks 1, 2, 3, 4, 6 |
| §12 hors périmètre | rien n'y touche |

**Deux écarts au spec, corrigés dans le plan plutôt que propagés :**
1. Le §9 annonçait « `Cartel.tsx` réutilisé tel quel » — faux, `CartelSpec` est ancré sur un mur et indexé par dépôt. Task 7 corrige le composant **et le spec**.
2. Le §7 annonçait un groupement par étage « pour hériter du culling » — le culling par étage a été mesuré inutile (`PropsLayer.tsx`). Une couche unique, comme les deux autres.

**Un écart de conception assumé :** le spec parlait d'une emprise dérivée de la pièce ; le plan fait déclarer le socle par l'humain et **prouve par un test que la pièce y tient** (Task 6). L'inverse obligerait `domain/` à lire un GLB.

**Cohérence des types** — vérifiée de bout en bout : `Sculpture` (Task 1) → `SculpturePlacement` (Task 2) → `EmpriseReservee` (Task 3) → `PlinthResult` (Task 4) → `SculptureAssets` (Task 6). `placeProps(museum, reservees?)` garde sa signature à un argument pour les 20 tests existants et pour tout appel non modifié.
