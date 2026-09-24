/**
 * Les sculptures du plan : où poser chaque pièce de `museum.config.json`.
 *
 * ── Sous les volées latérales, et pas au milieu du hall ──
 *
 * La marche (`walk.ts`) ne connaît que les murs, les obstacles et les
 * garde-corps du plan. Un socle posé au milieu du hall serait traversé — c'est
 * ce que l'ancien bâtiment évitait avec un collider Rapier, qui n'existe plus.
 * Le dessous d'une volée qui part du palier est, lui, déjà un OBSTACLE déclaré
 * (trop bas pour y passer) : un socle posé là est contourné sans rien ajouter à
 * la marche ni au plan. Et la niche s'ouvre sur le hall, côté haut de la
 * volée, là où il reste la hauteur d'une pièce d'un mètre.
 *
 * Une pièce par niche, dans l'ordre de la config ; au-delà, les pièces restent
 * en réserve.
 */
import config from '../../museum.config.json'
import { flightEnds } from './rules.ts'
import type { Direction, Plan } from './types.ts'

export interface SculpturePlacement {
  id: string
  file: string
  /** Centre du socle, posé sur le plancher, en coordonnées monde. */
  x: number
  y: number
  z: number
  /** Lacet, en radians : le modèle exporté regarde +Z. */
  rotation: number
  /** Hauteur de la pièce seule, socle non compris. */
  height: number
  plinth: { width: number; depth: number; height: number }
  cartel: { author: string; title: string; year: number; medium: string; credit: string }
}

type Sculpture = Omit<SculpturePlacement, 'x' | 'y' | 'z' | 'rotation'> & { facing: string }

/** Jeu entre le socle et le bord de la niche : il reste dans l'obstacle. */
const JEU = 0.2

/** +Z vers le point cardinal : une rotation θ envoie +Z sur (sin θ, cos θ). */
const LACET: Record<Direction, number> = { south: 0, east: Math.PI / 2, north: Math.PI, west: -Math.PI / 2 }

export function sculpturePlacements(plan: Plan, sculptures: readonly Sculpture[] = config.sculptures): SculpturePlacement[] {
  const rdc = plan.levels.reduce((a, b) => (b.elevation < a.elevation ? b : a))
  // Les niches : une volée qui démarre au-dessus du plancher, dont l'emprise est un obstacle.
  const niches = plan.flights.filter((f) =>
    f.bottom > rdc.elevation && rdc.obstacles.some((o) => o.x === f.x && o.z === f.z && o.width === f.width && o.depth === f.depth))
  return sculptures.slice(0, niches.length).map(({ facing, ...s }, i) => {
    const f = niches[i]
    const [tx, tz] = flightEnds(f).top
    // Du bout haut de la volée, on rentre dans la niche d'un demi-socle et du jeu.
    const nordSud = f.direction === 'north' || f.direction === 'south'
    const vers = f.direction === 'south' || f.direction === 'east' ? -1 : 1
    const recul = (nordSud ? s.plinth.depth : s.plinth.width) / 2 + JEU
    return {
      ...s,
      x: nordSud ? tx : tx + vers * recul,
      y: rdc.elevation,
      z: nordSud ? tz + vers * recul : tz,
      rotation: LACET[facing as Direction] ?? 0,
    }
  })
}
