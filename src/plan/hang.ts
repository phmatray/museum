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
import type { Artwork } from '../domain/types.ts'
import { capacity } from './rules.ts'
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

/** L'aile d'une salle, lue dans son id : `r-o2` → `o`, `e-e1` → `e`. */
const aile = (id: string) => id.replace(/^[a-z]+-/, '').replace(/\d+$/, '')

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
    groupes.splice(i, 1,
      { name: g.name, artworks: g.artworks.slice(0, moitie) },
      { name: `${g.name} (suite)`, artworks: g.artworks.slice(moitie) })
  }

  galeries.forEach((g, i) => {
    if (groupes[i]) out.set(g.room.id, { name: groupes[i].name, artworks: [...groupes[i].artworks].sort(parEtoiles) })
  })

  // Débordement : l'excédent d'une galerie (ses moins étoilés) passe dans une
  // galerie de la même aile qui a de la place, à défaut dans n'importe laquelle.
  for (const g of galeries) {
    const salle = out.get(g.room.id)!
    while (salle.artworks.length > g.cap) {
      const libre = (h: Exposee) => h !== g && out.get(h.room.id)!.artworks.length < h.cap
      const cible = galeries.find((h) => libre(h) && aile(h.room.id) === aile(g.room.id)) ?? galeries.find(libre)
      // ponytail: collection plus grande que le musée entier — l'excédent reste, hangRoom le laissera tomber.
      if (!cible) break
      const dest = out.get(cible.room.id)!
      dest.artworks = [...dest.artworks, salle.artworks.pop()!].sort(parEtoiles)
    }
  }
  return out
}
