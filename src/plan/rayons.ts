/**
 * Les rayons de soleil sous la verrière de la nef, la signature d'Orsay : où
 * sont les vitres par où la lumière entre, et combien il en entre.
 *
 * La verrière est celle de `tools/blender/build-nef.py` : un berceau plein
 * cintre posé sur les murs et l'attique du hall, vitré entre 52° et 128°, coupé
 * tous les 3,50 m par un arc doubleau. Chaque travée donne cinq panneaux,
 * séparés par les pannes de fonte : autant de faisceaux, qui gardent l'ombre
 * de la résille entre eux.
 *
 * Pur : des mètres et des degrés entrent, des rectangles et une force sortent.
 */
import type { Position } from '../domain/soleil.ts'
import type { Meteo } from '../domain/meteo.ts'
import type { Plan, Rect } from './types.ts'

/** Les cotes de la nef, relevées dans `build-nef.py` (MURS, ATTIQUE, TRAVEE, ARC_L, CAISSONS). */
const ATTIQUE = 3.3
const TRAVEE = 3.5
const ARC_L = 0.7
const VITRAGE = (52 * Math.PI) / 180
const PANNEAUX = 5
/** La largeur d'une panne de fonte, entre deux panneaux. */
const PANNE = 0.3

export interface Vitre {
  x0: number
  x1: number
  z0: number
  z1: number
  /** La cote du vitrage au milieu du panneau. */
  y: number
}

/** Le volume intérieur de la nef : le hall sur toute sa hauteur, jusqu'à la clé de voûte. */
export interface Nef extends Rect {
  naissance: number
  rayon: number
}

export function nefDuPlan(plan: Plan): Nef {
  const hall = plan.levels.flatMap((l) => l.rooms).find((r) => r.kind === 'hall')
  if (!hall) throw new Error('le plan n\'a pas de hall')
  const murs = 2 * plan.storey - plan.slab
  return { ...hall, naissance: murs + ATTIQUE, rayon: hall.width / 2 }
}

/** Les panneaux vitrés de la verrière, travée par travée, d'est en ouest. */
export function vitres(nef: Nef): Vitre[] {
  const cx = nef.x + nef.width / 2
  const demi = nef.rayon * Math.cos(VITRAGE)
  const large = (2 * demi - (PANNEAUX - 1) * PANNE) / PANNEAUX
  const out: Vitre[] = []
  for (let za = nef.z; za + TRAVEE <= nef.z + nef.depth + 1e-6; za += TRAVEE) {
    for (let i = 0; i < PANNEAUX; i++) {
      const x0 = cx - demi + i * (large + PANNE)
      const xm = x0 + large / 2
      out.push({ x0, x1: x0 + large, z0: za + ARC_L / 2, z1: za + TRAVEE - ARC_L / 2, y: nef.naissance + Math.sqrt(nef.rayon ** 2 - (xm - cx) ** 2) })
    }
  }
  return out
}

const lisse = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * La force des rayons, de 0 à 1 : il faut du jour, un soleil assez haut pour
 * passer par-dessus l'attique et tomber dans la nef, et un ciel dégagé — sous
 * les nuages ou dans le brouillard, la lumière est diffuse et les rayons
 * s'effacent.
 */
export function forceDesRayons(soleil: Position & { jour: number }, meteo: Pick<Meteo, 'nuages' | 'brouillard'>): number {
  const haut = lisse(12, 24, soleil.elevation)
  // Quelques nuages laissent passer le soleil entre eux ; un ciel couvert, jamais.
  const ciel = (1 - lisse(0.3, 0.95, meteo.nuages)) * (1 - lisse(0, 0.6, meteo.brouillard))
  return haut * soleil.jour * ciel
}
