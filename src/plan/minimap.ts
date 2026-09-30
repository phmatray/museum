/**
 * Ce que la minimap montre du visiteur (#31) : son niveau, la salle où il se
 * tient, et son point et son cap dans le repère du plan dessiné par `svg.ts`.
 *
 * Pur : (plan, visiteur) → données. Le dessin du niveau lui-même est
 * `renderLevel`, le même que `docs/plan` ; le composant ne fait que superposer.
 */
import { PARC } from './rules.ts'
import { S, cadre, cadreDehors } from './svg.ts'
import type { Plan, Room } from './types.ts'
import type { Walker } from './walk.ts'

export interface MinimapView {
  level: number
  /** `null` sur un palier ou une volée : on n'y est dans aucune salle. */
  room: Room | null
  /** Coordonnées du plan dessiné ; `yaw` 0 regarde vers le nord (le haut). */
  player: { x: number; y: number; yaw: number }
  viewBox: [number, number, number, number]
  /** Dehors, le plan s'élargit jusqu'à la baraque du chantier (`svg.ts`, `renderDehors`). */
  dehors: boolean
}

export function projectForMinimap(plan: Plan, w: Walker): MinimapView {
  const [niveau, id] = w.surface.split(':')
  const room = niveau === String(w.level)
    ? plan.levels.find((l) => l.id === w.level)?.rooms.find((r) => r.id === id) ?? null
    : null
  const dehors = w.surface === PARC
  return { level: w.level, room, player: { x: w.x * S, y: w.z * S, yaw: w.yaw }, viewBox: dehors ? cadreDehors(plan) : cadre(plan), dehors }
}

/** Le grossissement du plan ouvert, de sa taille d'écran à six fois. */
const ZOOM_MAX = 6

export interface Cadrage { k: number; x: number; y: number }

/**
 * Grossit le cadrage d'un facteur autour d'un point de l'écran, qui reste
 * sous le doigt (ou le curseur) ; le grossissement est borné à [1, ZOOM_MAX].
 */
export function zoomer(c: Cadrage, facteur: number, px: number, py: number): Cadrage {
  const k = Math.min(ZOOM_MAX, Math.max(1, c.k * facteur))
  const r = k / c.k
  return { k, x: px - (px - c.x) * r, y: py - (py - c.y) * r }
}
