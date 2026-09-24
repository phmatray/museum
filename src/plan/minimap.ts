/**
 * Ce que la minimap montre du visiteur (#31) : son niveau, la salle où il se
 * tient, et son point et son cap dans le repère du plan dessiné par `svg.ts`.
 *
 * Pur : (plan, visiteur) → données. Le dessin du niveau lui-même est
 * `renderLevel`, le même que `docs/plan` ; le composant ne fait que superposer.
 */
import { S, cadre } from './svg.ts'
import type { Plan, Room } from './types.ts'
import type { Walker } from './walk.ts'

export interface MinimapView {
  level: number
  /** `null` sur un palier ou une volée : on n'y est dans aucune salle. */
  room: Room | null
  /** Coordonnées du plan dessiné ; `yaw` 0 regarde vers le nord (le haut). */
  player: { x: number; y: number; yaw: number }
  viewBox: [number, number, number, number]
}

export function projectForMinimap(plan: Plan, w: Walker): MinimapView {
  const [niveau, id] = w.surface.split(':')
  const room = niveau === String(w.level)
    ? plan.levels.find((l) => l.id === w.level)?.rooms.find((r) => r.id === id) ?? null
    : null
  return { level: w.level, room, player: { x: w.x * S, y: w.z * S, yaw: w.yaw }, viewBox: cadre(plan) }
}
