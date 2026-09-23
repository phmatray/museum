/**
 * L'accrochage du plan : quelle œuvre dans quelle salle.
 *
 * ── Pourquoi le plan d'abord ──
 *
 * L'ancien pipeline fabriquait autant de salles que de clusters, d'où des
 * galeries aveugles. Ici le bâtiment est fixe : treize galeries et une salle
 * d'honneur. C'est donc la collection qui se plie au plan — le clustering est
 * ramené à exactement autant de groupes que de galeries, et aucune salle ne
 * reste vide.
 *
 * Tout est déterministe : même catalogue, même accrochage, octet pour octet.
 */
import { clusterArtworks } from '../domain/clustering.ts'
import { DEFAULT_ASPECT, hangRoom } from '../domain/hanging.ts'
import { WALL_CORNER_MARGIN, type Artwork, type RepoKey, type Room as SalleDomaine, type Wall } from '../domain/types.ts'
import { edges } from './geometry.ts'
import { capacity, NORMES } from './rules.ts'
import { INT as DEMI_MUR } from './svg.ts'
import type { Level, Plan, Room } from './types.ts'

export interface Salle {
  /** Nom du thème ; le nom de travail du plan n'est qu'un repli. */
  name: string
  /** Par étoiles décroissantes, puis par clé. */
  artworks: Artwork[]
}

interface Exposee {
  room: Room
  level: Level
  cap: number
}

const parEtoiles = (a: Artwork, b: Artwork) => b.stars - a.stars || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

/** Les salles qui accrochent, dans l'ordre du plan. */
export function exposedRooms(plan: Plan): { room: Room; level: Level }[] {
  return plan.levels.flatMap((level) =>
    level.rooms.filter((r) => r.kind === 'gallery' || r.kind === 'honneur').map((room) => ({ room, level })))
}

/** L'aile d'une salle sur son niveau, lue dans son id : `r-o2` → `r-o`, `e-e1` → `e-e`. */
const aile = (id: string) => id.replace(/\d+$/, '')

/**
 * Répartit la collection : les plus étoilés en salle d'honneur, le reste en
 * autant de thèmes que de galeries. La carte suit l'ordre du plan.
 */
export function assignRooms(plan: Plan, artworks: Artwork[]): Map<string, Salle> {
  const salles: Exposee[] = exposedRooms(plan).map((e) => ({ ...e, cap: capacity(e.room, e.level) }))
  const out = new Map<string, Salle>(salles.map(({ room }) => [room.id, { name: room.name, artworks: [] }]))

  let reste = [...artworks].sort(parEtoiles)
  for (const { room, cap } of salles.filter((s) => s.room.kind === 'honneur')) {
    out.get(room.id)!.artworks = reste.slice(0, cap)
    reste = reste.slice(cap)
  }

  const galeries = salles.filter((s) => s.room.kind === 'gallery')
  if (galeries.length === 0 || reste.length === 0) return out

  const parCle = new Map(reste.map((a) => [a.key, a]))
  const maxSize = Math.min(...galeries.map((g) => g.cap))
  const groupes = clusterArtworks(reste, { minSize: 1, maxSize })
    .map((c) => ({ name: c.name, artworks: c.keys.map((k) => parCle.get(k)!) }))

  // ponytail: ajustement glouton du nombre de groupes, sans re-clusteriser.
  // L'ordre des clusters suit l'arbre, donc un groupe voisin est un thème voisin :
  // on fusionne le plus petit avec son plus petit voisin, on coupe le plus gros en deux.
  while (groupes.length > galeries.length) {
    const i = groupes.reduce((m, g, j) => (g.artworks.length < groupes[m].artworks.length ? j : m), 0)
    const gauche = groupes[i - 1]?.artworks.length ?? Infinity
    const droite = groupes[i + 1]?.artworks.length ?? Infinity
    const j = gauche <= droite ? i - 1 : i + 1
    const [a, b] = [groupes[i], groupes[j]]
    const fusion = { name: (a.artworks.length > b.artworks.length ? a : b).name, artworks: [...a.artworks, ...b.artworks] }
    groupes.splice(Math.min(i, j), 2, fusion)
  }
  while (groupes.length < galeries.length && groupes.some((g) => g.artworks.length > 1)) {
    const i = groupes.reduce((m, g, j) => (g.artworks.length > groupes[m].artworks.length ? j : m), 0)
    const g = groupes[i]
    const moitie = Math.ceil(g.artworks.length / 2)
    // Même convention que le clustering pour un nom en double : « Thème 2 », « Thème 3 »…
    const base = g.name.replace(/ \d+$/, '')
    const libre = (k: number): string => (groupes.some((h) => h.name === `${base} ${k}`) ? libre(k + 1) : `${base} ${k}`)
    groupes.splice(i, 1,
      { name: g.name, artworks: g.artworks.slice(0, moitie) },
      { name: libre(2), artworks: g.artworks.slice(moitie) })
  }

  galeries.forEach((g, i) => {
    if (groupes[i]) out.set(g.room.id, { name: groupes[i].name, artworks: [...groupes[i].artworks].sort(parEtoiles) })
  })

  // Débordement : l'excédent d'une galerie (ses moins étoilés) passe dans la
  // galerie de la même aile la plus proche qui a de la place. À défaut, dans la
  // plus proche tout court : la capacité d'une salle ne se négocie pas.
  galeries.forEach((g, i) => {
    const salle = out.get(g.room.id)!
    const proches = galeries
      .map((h, j) => ({ h, d: Math.abs(i - j) + (aile(h.room.id) === aile(g.room.id) ? 0 : galeries.length) }))
      .filter(({ h }) => h !== g)
      .sort((a, b) => a.d - b.d)
      .map(({ h }) => h)
    while (salle.artworks.length > g.cap) {
      const cible = proches.find((h) => out.get(h.room.id)!.artworks.length < h.cap)
      // ponytail: collection plus grande que le musée entier — l'excédent reste, hangRoom le laissera tomber.
      if (!cible) break
      const dest = out.get(cible.room.id)!
      dest.artworks = [...dest.artworks, salle.artworks.pop()!].sort(parEtoiles)
    }
  })
  return out
}

// ── Sur les murs ─────────────────────────────────────────────────────────

/** Ce qu'écrit `npm run accrocher` et que lit la scène : des toiles en coordonnées monde. */
export interface Accrochage {
  generatedAt: string
  rooms: {
    id: string
    level: number
    name: string
    placements: { key: RepoKey; x: number; y: number; z: number; normal: [number, number]; width: number }[]
  }[]
}

/** Hauteur d'axe des toiles, au-dessus du plancher du niveau. */
export const AXE_TOILES = 1.55
const EPS = 1e-6
const mm = (v: number) => Math.round(v * 1000) / 1000

/**
 * Les quatre murs d'une salle, posés sur leur FACE intérieure, avec chaque
 * ouverture de la salle élargie de son dégagement — les mêmes règles que
 * `capacity()`. `hangRoom` laisse `WALL_CORNER_MARGIN` dans chaque angle : on
 * raccourcit le mur du reste pour retrouver le mètre libre de `NORMES.angle`.
 */
function murs(room: Room, level: Level, hauteur: number): Wall[] {
  const cx = room.x + room.width / 2
  const cz = room.z + room.depth / 2
  const ouvertures = level.openings.filter((o) => o.a === room.id || o.b === room.id)
  const retrait = DEMI_MUR + NORMES.angle - WALL_CORNER_MARGIN
  return edges(room).map((e, i) => {
    // Normale vers l'intérieur de la salle ; `le_long` projette sur l'arête.
    const n = e.axis === 'x' ? { x: 0, z: Math.sign(cz - e.at) } : { x: Math.sign(cx - e.at), z: 0 }
    const face = e.at + DEMI_MUR * (e.axis === 'x' ? n.z : n.x)
    const [s0, s1] = [e.span[0] + retrait, e.span[1] - retrait]
    const point = (u: number) => (e.axis === 'x' ? { x: u, z: face } : { x: face, z: u })
    return {
      id: `${room.id}-${i}`,
      a: point(s0),
      b: point(s1),
      height: hauteur,
      kind: 'inner',
      normal: n,
      openings: ouvertures
        .filter((o) => Math.abs((e.axis === 'x' ? o.z : o.x) - e.at) < EPS)
        .map((o) => {
          const c = (e.axis === 'x' ? o.x : o.z) - s0
          const demi = o.width / 2 + NORMES.dégagement
          return { kind: o.kind === 'bay' ? 'bay' : 'door', start: c - demi, end: c + demi, height: hauteur, sill: 0 }
        }),
      placements: [],
    }
  })
}

/**
 * Accroche chaque salle sur ses murs avec `hangRoom`. `generatedAt` vient du
 * catalogue, jamais de l'horloge : même catalogue, même fichier.
 */
export function hangPlan(plan: Plan, salles: Map<string, Salle>, generatedAt: string): Accrochage {
  const hauteur = plan.storey - plan.slab
  const rooms = exposedRooms(plan).map(({ room, level }) => {
    const salle = salles.get(room.id) ?? { name: room.name, artworks: [] }
    const domaine: SalleDomaine = {
      id: room.id,
      name: salle.name,
      side: 'north',
      footprint: { x: room.x, z: room.z, width: room.width, depth: room.depth },
      theme: 'classic',
      walls: murs(room, level, hauteur),
      topics: [],
      keys: salle.artworks.map((a) => a.key),
    }
    const entrees = salle.artworks.map((a) => ({ key: a.key, stars: a.stars, aspect: DEFAULT_ASPECT, atlas: 0, layer: 0 }))
    const accrochee = hangRoom(domaine, entrees, { centerHeight: AXE_TOILES })
    return {
      id: room.id,
      level: level.id,
      name: salle.name,
      placements: accrochee.walls.flatMap((w) => {
        const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z)
        const [dx, dz] = [(w.b.x - w.a.x) / len, (w.b.z - w.a.z) / len]
        return w.placements.map((p) => ({
          key: p.key,
          x: mm(w.a.x + dx * p.u),
          y: mm(level.elevation + p.centerHeight),
          z: mm(w.a.z + dz * p.u),
          normal: [w.normal.x, w.normal.z] as [number, number],
          width: mm(p.width),
        }))
      }),
    }
  })
  return { generatedAt, rooms }
}
