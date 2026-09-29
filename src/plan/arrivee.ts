/**
 * L'arrivée devant une toile (`?p=<repo>`, `domain/lien.ts`) : où poser le
 * visiteur pour qu'il ouvre les yeux face au tableau qu'on lui a envoyé.
 *
 * À trois mètres environ, dans l'axe de la normale du mur, sur le plancher de
 * la salle de la toile, et là où la marche le laisse tel quel — ni banc, ni
 * socle, ni cimaise à moins d'un rayon. Pour une vitrine de la salle d'honneur,
 * la borne est entre lui et le panneau : il la consulte déjà.
 *
 * Pur : ni three ni React.
 */
import type { Accrochage } from './hang.ts'
import { surfaceAt } from './rules.ts'
import type { Plan } from './types.ts'
import { SALLE_VITRINES, VITRINES } from './vitrines.ts'
import { step, type Walker } from './walk.ts'

const OEIL = 1.62
/** Du plus naturel au moins : trois mètres, puis plus près ou plus loin. */
const RECULS = [2.8, 3.1, 2.5, 3.4, 2.2, 3.8, 2]
/** Puis de biais, si l'axe est pris (un banc, un socle). */
const DECALAGES = [0, 0.5, -0.5, 1, -1]

export interface Cible {
  x: number
  y: number
  z: number
  /** La normale du mur, vers la salle. */
  normal: [number, number]
  /** La salle de la toile : le visiteur doit s'y tenir, pas derrière la cloison. */
  salle: string
}

/** Le visiteur à l'arrivée, et l'inclinaison de son regard (radians, > 0 vers le haut). */
export type Arrivee = Walker & { pitch: number }

/** La toile d'un projet : sur un mur de l'accrochage, ou dans une des vitrines (`vitrines` : leurs clés, par rang). */
export function cibleDe(cle: string, accrochage: Accrochage, vitrines: readonly string[]): Cible | null {
  const rang = vitrines.indexOf(cle)
  if (rang >= 0 && VITRINES[rang]) return { ...VITRINES[rang].toile, normal: [0, 1], salle: SALLE_VITRINES }
  for (const r of accrochage.rooms) {
    const p = r.placements.find((p) => p.key === cle)
    if (p) return { x: p.x, y: p.y, z: p.z, normal: p.normal, salle: r.id }
  }
  return null
}

/** Où se tenir devant `c` : le premier point praticable, tourné vers la toile ; `null` s'il n'y en a pas. */
export function arriveeDevant(plan: Plan, c: Cible): Arrivee | null {
  const level = plan.levels.find((l) => l.rooms.some((r) => r.id === c.salle))
  if (!level) return null
  const surface = `${level.id}:${c.salle}`
  const [nx, nz] = c.normal
  for (const recul of RECULS)
    for (const d of DECALAGES) {
      // Le long du mur : la normale tournée d'un quart de tour.
      const x = c.x + nx * recul - nz * d
      const z = c.z + nz * recul + nx * d
      if (surfaceAt(plan, x, z, level.elevation) !== surface) continue
      // Le regard vers la toile : yaw 0 regarde −z (`walk.ts`).
      const yaw = Math.atan2(-(c.x - x), -(c.z - z))
      const w: Walker = { level: level.id, surface, x, z, y: level.elevation, yaw }
      // Praticable : un pas immobile ne le repousse d'aucun mur ni obstacle.
      const apres = step(plan, w, { forward: 0, strafe: 0, yaw }, 0)
      if (Math.hypot(apres.x - x, apres.z - z) > 1e-9 || apres.surface !== surface) continue
      return { ...w, pitch: Math.atan2(c.y - (level.elevation + OEIL), Math.hypot(c.x - x, c.z - z)) }
    }
  return null
}
