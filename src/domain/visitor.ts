/**
 * LOT 3 — Où se trouve le visiteur.
 *
 * Un point du monde → un niveau et une salle. C'est ce que le plan surligne, ce
 * qui alimente `gameStore.currentRoomId`, et ce sur quoi le culling par salle du
 * spec §9.3 s'appuiera.
 *
 * Ce module est PUR — aucun `three`, aucun `react`, aucune horloge — parce que
 * la question « dans quelle salle suis-je ? » se répond avec deux rectangles et
 * une altitude, et qu'une réponse fausse (la salle voisine, le mauvais étage)
 * est indétectable à l'œil dans une scène 3D mais triviale à cerner dans un
 * test.
 *
 * ── Le niveau se déduit de l'altitude, pas de la salle ──
 *
 * Deux salles d'étages différents ont EXACTEMENT la même emprise au sol : le
 * plan en anneau est le même à tous les niveaux. Chercher la salle avant le
 * niveau donnerait donc systématiquement celle du rez-de-chaussée. On tranche
 * d'abord en `y`, ensuite seulement en `x`/`z`.
 */
import type { Floor, Museum, Rect, Vec3 } from './types'

export interface VisitorLocation {
  floorId: string
  /** `null` dans l'atrium, sur une rampe, ou dans un couloir : pas de salle. */
  roomId: string | null
}

/**
 * Tolérance verticale sous le plancher.
 *
 * Le contrôleur cinématique laisse le joueur s'enfoncer de quelques millimètres
 * dans la dalle, et l'œil de la caméra est calé sur la capsule, pas sur le sol.
 * Sans cette marge, marcher normalement ferait clignoter le niveau courant entre
 * l'étage et celui du dessous.
 */
export const FLOOR_TOLERANCE = 0.5

/**
 * Marge au-dessus du plafond du dernier niveau avant de se déclarer dehors.
 *
 * La toiture est percée de la trémie de l'atrium (spec §9.2) : on peut donc
 * légitimement se trouver au-dessus du plafond nominal en haut de la dernière
 * rampe. Trop serrée, cette marge ferait « sortir du bâtiment » une caméra de
 * visite qui monte ; trop large, elle prétendrait qu'un survol à 30 m est encore
 * dedans.
 */
export const ROOF_MARGIN = 2

/**
 * Localise un point du monde.
 *
 * Renvoie `null` hors du bâtiment : au-delà de l'emprise de la dalle, sous le
 * niveau le plus bas, ou au-dessus de la toiture. « Hors du bâtiment » et « dans
 * le bâtiment mais dans aucune salle » sont deux réponses différentes, et les
 * confondre ferait disparaître le plan dès qu'on met un pied dans l'atrium.
 */
export function locateVisitor(museum: Museum, point: Vec3): VisitorLocation | null {
  const floor = floorAt(museum, point.y)
  if (floor === null) return null
  if (!contains(floor.footprint, point.x, point.z)) return null

  for (const room of floor.rooms) {
    if (contains(room.footprint, point.x, point.z)) {
      return { floorId: floor.id, roomId: room.id }
    }
  }
  return { floorId: floor.id, roomId: null }
}

/**
 * La salle seule, pour l'appelant qui ne veut qu'elle (`currentRoomId`).
 *
 * `null` couvre les deux cas — hors bâtiment et hors salle — parce que du point
 * de vue d'un surlignage de plan, ils reviennent au même : rien à surligner.
 */
export function roomAt(museum: Museum, point: Vec3): string | null {
  return locateVisitor(museum, point)?.roomId ?? null
}

/**
 * Le niveau dont le plancher porte l'altitude `y`.
 *
 * On prend le niveau LE PLUS HAUT dont le plancher est sous les pieds. Sur une
 * rampe, cela rattache le visiteur au niveau qu'il vient de quitter jusqu'à ce
 * qu'il pose le pied sur le suivant — c'est le comportement voulu : on n'est pas
 * encore à l'étage tant qu'on n'y est pas arrivé.
 */
export function floorAt(museum: Museum, y: number): Floor | null {
  let candidat: Floor | null = null
  let plafond = -Infinity

  for (const floor of museum.floors) {
    if (floor.elevation > y + FLOOR_TOLERANCE) continue
    if (candidat === null || floor.elevation > candidat.elevation) candidat = floor
    plafond = Math.max(plafond, floor.elevation + floor.ceilingHeight)
  }
  if (candidat === null) return null

  // Au-dessus de la toiture du dernier niveau : on survole, on n'est plus dans
  // le bâtiment. Le plafond retenu est le plus haut de TOUS les niveaux sous
  // `y`, ce qui revient à celui du dernier — ils sont empilés.
  if (y > plafond + ROOF_MARGIN) return null
  return candidat
}

/**
 * Point dans un rectangle, bord inclus.
 *
 * Bords inclus des DEUX côtés : les emprises de salles voisines partagent leur
 * frontière exacte (spec §7.2, l'anneau est une partition), et exclure le bord
 * haut créerait une bande morte d'un micromètre entre deux salles où le plan ne
 * surlignerait rien. Le doublon éventuel est tranché par l'ordre de `rooms`,
 * qui est stable.
 */
function contains(rect: Rect, x: number, z: number): boolean {
  return (
    x >= rect.x && x <= rect.x + rect.width && z >= rect.z && z <= rect.z + rect.depth
  )
}
