/**
 * LOT 2 — Chargement et validation de `museum.json`.
 *
 * `museum.json` est un fichier GÉNÉRÉ (`tools/derive-museum.ts`), pas écrit à la
 * main. La validation n'est donc pas là pour rattraper une faute de frappe mais
 * pour attraper le décalage : un `museum.json` produit par une version
 * antérieure du dérivateur, un fichier tronqué par un déploiement à moitié
 * copié, un `spawn.floorId` qui ne désigne plus rien après un renommage de
 * niveau. Tout cela se manifesterait autrement par un écran noir ou une chute
 * infinie, deux symptômes qui ne disent rien de leur cause.
 *
 * D'où le parti pris : on valide la GÉOMÉTRIE et les RÉFÉRENCES CROISÉES avec
 * la même sévérité que `src/schema/` applique aux fichiers d'entrée, on tolère
 * les champs inconnus (le fichier est généré : un champ ajouté par une version
 * ultérieure ne doit pas casser un ancien binaire), et on refuse les
 * incohérences qui rendraient la scène injouable.
 *
 * Aucun import de `three`, de `react` ni de `@react-three/*` : ce module est un
 * lecteur de fichier, il tourne dans vitest sans canvas et pourrait tourner dans
 * Node.
 */
import { z } from 'zod'

import type {
  Floor,
  Museum,
  Ramp,
  Room,
  Vec3,
  Wall,
} from '../domain/types'
import { museumConfigSchema, SchemaError } from '../schema'

/** Nom du fichier, pour les messages d'erreur. */
const FICHIER = 'museum.json'

/**
 * Chemin du fichier RELATIF à la base du site. Sur GitHub Pages le site vit
 * sous `/<dépôt>/` : un chemin absolu `/data/museum.json` y donnerait un 404.
 */
export const MUSEUM_PATH = 'data/museum.json'

// ── Briques géométriques ─────────────────────────────────────────────────

/**
 * Un `NaN` ou un `Infinity` dans une coordonnée ne fait pas planter three : il
 * produit une géométrie dont la bounding sphere est `NaN`, ce qui désactive
 * silencieusement le frustum culling et fait disparaître l'objet. On les refuse
 * ici plutôt que de chercher l'objet manquant plus tard.
 */
const nombre = z.number().finite()

const vec2 = z.object({ x: nombre, z: nombre })
const vec3 = z.object({ x: nombre, y: nombre, z: nombre })

const rect = z.object({
  x: nombre,
  z: nombre,
  width: nombre.positive(),
  depth: nombre.positive(),
})

const openingSchema = z.looseObject({
  kind: z.enum(['door', 'bay', 'window']),
  start: nombre,
  end: nombre,
  height: nombre.positive(),
  /**
   * Allège. Facultative à la LECTURE, et c'est délibéré : un `museum.json`
   * produit avant qu'elle n'existe — ou remis par le cache de la CI — doit
   * continuer à s'ouvrir. Absente, elle vaut zéro, c'est-à-dire une ouverture
   * posée au sol, ce qu'étaient toutes les ouvertures avant.
   */
  sill: nombre.min(0).default(0),
})

const placementSchema = z.looseObject({
  key: z.string().min(1),
  u: nombre,
  centerHeight: nombre,
  width: nombre.positive(),
  height: nombre.positive(),
  atlas: z.number().int().min(0),
  layer: z.number().int().min(0),
  pinned: z.boolean(),
})

const wallSchema = z.looseObject({
  id: z.string().min(1),
  a: vec2,
  b: vec2,
  height: nombre.positive(),
  kind: z.enum(['outer', 'side', 'inner']),
  normal: vec2,
  openings: z.array(openingSchema),
  placements: z.array(placementSchema),
})

const roomSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  side: z.enum(['north', 'east', 'south', 'west']),
  footprint: rect,
  theme: z.enum(['classic', 'modern', 'immersive', 'vault']),
  walls: z.array(wallSchema),
  topics: z.array(z.string()),
  keys: z.array(z.string()),
})

const floorSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  level: z.number().int(),
  elevation: nombre,
  ceilingHeight: nombre.positive(),
  rooms: z.array(roomSchema),
  /**
   * Les murs qui ferment le pourtour là où aucune salle ne le fait. Facultatif
   * à la lecture, pour la même raison que `sill` : un fichier d'avant se lit
   * encore, avec un bâtiment simplement moins clos.
   */
  enclosure: z.array(wallSchema).default([]),
  slabHoles: z.array(rect),
  footprint: rect,
})

const rampSchema = z.looseObject({
  id: z.string().min(1),
  fromFloor: z.string().min(1),
  toFloor: z.string().min(1),
  centre: vec2,
  radius: nombre.positive(),
  startAngle: nombre,
  sweep: nombre,
  width: nombre.positive(),
  rise: nombre,
  baseElevation: nombre,
})

/**
 * Les œuvres, redéclarées ici.
 *
 * `src/schema/index.ts` garde son `artworkSchema` privé — il appartient au
 * pipeline d'entrée, pas au bâtiment dérivé. Plutôt que d'élargir l'API d'un
 * module que ce lot ne possède pas, on redit la forme ; si un troisième
 * consommateur apparaît, c'est le moment de la remonter dans `schema/`.
 *
 * Volontairement plus permissif que celui du catalogue (pas de `z.url()`, pas
 * de `z.iso.datetime()`) : ces champs ont DÉJÀ été validés à l'entrée du
 * pipeline, les revalider ne ferait que transformer un catalogue légèrement
 * exotique en musée qui refuse de s'ouvrir.
 */
const artworkSchema = z.looseObject({
  key: z.string().min(1),
  owner: z.string().min(1),
  name: z.string().min(1),
  title: z.string(),
  description: z.string(),
  url: z.string(),
  homepage: z.string().nullable(),
  topics: z.array(z.string()),
  language: z.string().nullable(),
  languages: z.record(z.string(), z.number()),
  stars: z.number().int().min(0),
  forks: z.number().int().min(0),
  openIssues: z.number().int().min(0),
  isFork: z.boolean(),
  isArchived: z.boolean(),
  isTemplate: z.boolean(),
  createdAt: z.string(),
  pushedAt: z.string(),
  license: z.string().nullable(),
  readmeExcerpt: z.string(),
})

// ── Le musée ─────────────────────────────────────────────────────────────

/**
 * Schéma du bâtiment dérivé.
 *
 * `looseObject` partout : le fichier est généré, et une version ultérieure du
 * dérivateur qui ajoute un champ ne doit pas rendre illisibles les musées déjà
 * déployés. C'est l'asymétrie posée par `src/schema/` — généré = tolérant,
 * écrit à la main = strict — appliquée au troisième étage du pipeline.
 */
export const museumSchema = z
  .looseObject({
    config: museumConfigSchema,
    generatedAt: z.string(),
    floors: z
      .array(floorSchema)
      .min(1, { error: 'un musée sans niveau n’a pas de sol : le joueur tomberait au premier pas' }),
    ramps: z.array(rampSchema),
    atrium: rect,
    spawn: z.looseObject({
      floorId: z.string().min(1),
      position: vec3,
      yaw: nombre,
    }),
    artworks: z.record(z.string(), artworkSchema),
    stats: z.looseObject({
      artworkCount: z.number().int().min(0),
      roomCount: z.number().int().min(0),
      floorCount: z.number().int().min(0),
      excludedCount: z.number().int().min(0),
      vaultCount: z.number().int().min(0),
    }),
    warnings: z.array(z.string()),
  })
  .superRefine((museum, ctx) => {
    const niveaux = new Set(museum.floors.map((f) => f.id))

    // Un identifiant de niveau en double casse `floorById` sans le dire : la
    // rampe et le spawn iraient chercher le premier, la scène rendrait les deux.
    const vus = new Set<string>()
    museum.floors.forEach((floor, i) => {
      if (vus.has(floor.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['floors', i, 'id'],
          message: 'identifiant de niveau en double — les références (spawn, rampes) deviennent ambiguës',
        })
      }
      vus.add(floor.id)
    })

    // Sans niveau de départ, le joueur apparaît à l'origine, c'est-à-dire au
    // milieu du vide de l'atrium, et tombe. Symptôme spectaculaire, cause
    // invisible : autant la nommer.
    if (!niveaux.has(museum.spawn.floorId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['spawn', 'floorId'],
        message: `renvoie à un niveau inexistant — niveaux déclarés : ${[...niveaux].join(', ')}`,
      })
    }

    museum.ramps.forEach((ramp, i) => {
      for (const champ of ['fromFloor', 'toFloor'] as const) {
        if (!niveaux.has(ramp[champ])) {
          ctx.addIssue({
            code: 'custom',
            path: ['ramps', i, champ],
            message: `renvoie à un niveau inexistant — la rampe ne relierait rien`,
          })
        }
      }
    })
  })

// ── Messages ─────────────────────────────────────────────────────────────

/** `floors[2].rooms[0].footprint.width`, `(racine)`. */
function formaterChemin(chemin: readonly PropertyKey[]): string {
  if (chemin.length === 0) return '(racine)'
  let sortie = ''
  for (const segment of chemin) {
    if (typeof segment === 'number') sortie += `[${segment}]`
    else if (typeof segment === 'string' && /^[A-Za-z_$][\w$]*$/.test(segment)) {
      sortie += sortie === '' ? segment : `.${segment}`
    } else sortie += `[${JSON.stringify(String(segment))}]`
  }
  return sortie
}

/**
 * Anomalie zod → une ligne lisible.
 *
 * Bien plus court que le traducteur de `src/schema/`, et c'est délibéré : ce
 * fichier n'est pas édité à la main, personne n'a de ligne à reprendre. Ce qu'on
 * veut savoir c'est QUEL champ a lâché, pour savoir quel étage du pipeline
 * relancer.
 */
function expliquer(anomalie: z.core.$ZodIssue): string {
  return `${formaterChemin(anomalie.path)} — ${anomalie.message}`
}

// ── API ──────────────────────────────────────────────────────────────────

/**
 * Valide un `museum.json` déjà désérialisé.
 *
 * Lève une `SchemaError` — la même que `src/schema/` — plutôt que de renvoyer
 * un musée partiel : une scène à moitié construite est plus difficile à
 * diagnostiquer qu'une scène qui refuse de se construire.
 */
export function parseMuseum(raw: unknown): Museum {
  const resultat = museumSchema.safeParse(raw)
  if (!resultat.success) {
    throw new SchemaError(FICHIER, resultat.error.issues.map(expliquer))
  }
  // `looseObject` garde les champs inconnus, donc la valeur validée est un
  // SURENSEMBLE de `Museum` : la conversion est sûre dans ce sens-là.
  return resultat.data as unknown as Museum
}

/**
 * Va chercher `museum.json` et le valide.
 *
 * L'URL par défaut est relative à `import.meta.env.BASE_URL` : sur GitHub Pages
 * le site est servi sous `/<dépôt>/`, où un chemin absolu donnerait un 404 que
 * seule la console révélerait.
 */
export async function loadMuseum(url?: string): Promise<Museum> {
  const cible = url ?? `${import.meta.env.BASE_URL}${MUSEUM_PATH}`
  const reponse = await fetch(cible)
  if (!reponse.ok) {
    throw new SchemaError(FICHIER, [
      `${cible} — le serveur a répondu ${reponse.status} ${reponse.statusText} ; le fichier a-t-il été généré (npm run derive) ?`,
    ])
  }

  let brut: unknown
  try {
    brut = await reponse.json()
  } catch (cause) {
    throw new SchemaError(FICHIER, [
      `${cible} — réponse illisible en JSON (${cause instanceof Error ? cause.message : String(cause)})`,
    ])
  }

  return parseMuseum(brut)
}

/**
 * Le chargement, mémorisé.
 *
 * React 19 `use()` resuspend à chaque promesse NOUVELLE : construire la
 * promesse dans le rendu relancerait un `fetch` à chaque tentative et
 * boucle­rait indéfiniment. On la construit donc une fois, et plusieurs
 * composants (`App` pour le spawn, `MuseumScene` pour le bâtiment) peuvent la
 * consommer sans provoquer deux requêtes.
 *
 * En cas d'échec la promesse est OUBLIÉE, pour qu'un remontage puisse
 * réessayer — sans quoi une coupure réseau d'une seconde condamnerait la page.
 */
let enCours: Promise<Museum> | null = null

export function museumResource(): Promise<Museum> {
  if (enCours === null) {
    enCours = loadMuseum().catch((erreur: unknown) => {
      enCours = null
      throw erreur
    })
  }
  return enCours
}

/** Oublie le musée mémorisé. Réservé aux tests et au rechargement à chaud. */
export function resetMuseumResource(): void {
  enCours = null
}

// ── Accès dérivés ────────────────────────────────────────────────────────

export function floorById(museum: Museum, id: string): Floor | undefined {
  return museum.floors.find((floor) => floor.id === id)
}

/** Tous les murs d'un niveau, salles confondues. */
export function floorWalls(floor: Floor): Wall[] {
  return floor.rooms.flatMap((room: Room) => room.walls)
}

export interface ResolvedSpawn {
  /** Point du SOL, en coordonnées monde. Le joueur pose ses pieds ici. */
  position: Vec3
  yaw: number
}

/**
 * Le spawn, remonté à l'élévation de son niveau.
 *
 * `museum.spawn.position` est exprimé DANS le niveau (`y` = hauteur au-dessus
 * du plancher, presque toujours 0) : le poser tel quel dans le monde ferait
 * apparaître le joueur au rez-de-chaussée quel que soit le niveau demandé, ce
 * qui, pour un spawn en réserve, veut dire trois mètres sous le plancher.
 *
 * Un `floorId` inconnu est déjà refusé par `parseMuseum` ; on retombe malgré
 * tout sur le niveau le plus bas plutôt que de lever, parce qu'un helper de
 * lecture ne doit pas être le seul endroit qui plante.
 */
export function resolveSpawn(museum: Museum): ResolvedSpawn {
  const floor = floorById(museum, museum.spawn.floorId) ?? lowestFloor(museum)
  return {
    position: {
      x: museum.spawn.position.x,
      y: floor.elevation + museum.spawn.position.y,
      z: museum.spawn.position.z,
    },
    yaw: museum.spawn.yaw,
  }
}

function lowestFloor(museum: Museum): Floor {
  return museum.floors.reduce((bas, f) => (f.elevation < bas.elevation ? f : bas))
}

/**
 * Altitude sous laquelle le joueur n'est plus dans le bâtiment.
 *
 * L'enveloppe n'est pas encore fermée sur tous les côtés (spec §7.2, invariant
 * d'enveloppe : le rez-de-chaussée n'a qu'une salle d'honneur et ses trois
 * autres côtés sont des bords de dalle nus). Tomber là n'est pas un bug de ce
 * lot, mais tomber INDÉFINIMENT en est un : sans plancher plus bas, rien
 * n'arrête la chute et la partie est perdue sans message. Cette altitude sert
 * de filet au joueur, qui est remis au spawn.
 *
 * La marge de 20 m est plus grande que la plus haute chute possible d'un étage
 * à l'autre : on ne veut surtout pas téléporter quelqu'un qui saute une marche.
 */
export const VOID_MARGIN = 20

export function voidFloorY(museum: Museum): number {
  return lowestFloor(museum).elevation - VOID_MARGIN
}

/**
 * Le niveau au-dessus de `floor`, s'il existe.
 *
 * Sert à la scène pour savoir si le plafond d'un niveau est déjà assuré par la
 * dalle du dessus : au dernier niveau il ne l'est pas, il faut une toiture.
 */
export function floorAbove(museum: Museum, floor: Floor): Floor | undefined {
  let candidat: Floor | undefined
  for (const autre of museum.floors) {
    if (autre.elevation <= floor.elevation) continue
    if (candidat === undefined || autre.elevation < candidat.elevation) candidat = autre
  }
  return candidat
}

/**
 * Rampes desservant un niveau donné, dans un ordre stable.
 *
 * Une rampe appartient géométriquement au VIDE entre deux dalles ; on la
 * rattache au niveau de départ pour que le culling par étage du lot 3 ait une
 * règle à appliquer.
 */
export function rampsFrom(museum: Museum, floorId: string): Ramp[] {
  return museum.ramps.filter((ramp) => ramp.fromFloor === floorId)
}
