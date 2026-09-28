/**
 * Des toiles qui s'éveillent : laquelle le visiteur regarde, et depuis quand
 * chaque dépôt n'a pas bougé. Pur : ni three ni React.
 */
import type { Accrochage } from './hang.ts'
import type { Walker } from './walk.ts'

export type Placement = Accrochage['rooms'][number]['placements'][number]

/** À plus de 4 m, on traverse la salle ; on ne regarde pas une toile. */
const PORTEE = 4
/** Le regard tolère 35° de part et d'autre de la toile. */
const CONE = Math.cos((35 * Math.PI) / 180)
const OEIL = 1.62

/**
 * La toile que le visiteur regarde : devant son mur, à portée, à hauteur de son
 * étage, dans l'axe de son regard. La plus proche l'emporte ; `null` sinon.
 */
export function toileRegardee(placements: readonly Placement[], w: Pick<Walker, 'x' | 'y' | 'z' | 'yaw'>): Placement | null {
  // Le regard : yaw 0 regarde vers −z (`walk.ts`).
  const [vx, vz] = [-Math.sin(w.yaw), -Math.cos(w.yaw)]
  let meilleure: Placement | null = null
  let d2min = PORTEE * PORTEE
  for (const p of placements) {
    if (Math.abs(p.y - (w.y + OEIL)) > 1.5) continue
    const [dx, dz] = [p.x - w.x, p.z - w.z]
    const d2 = dx * dx + dz * dz
    if (d2 > d2min || d2 < 1e-6) continue
    // Devant le mur (la normale regarde le visiteur) et dans le cône du regard.
    if (-(dx * p.normal[0] + dz * p.normal[1]) < 0.3) continue
    if ((dx * vx + dz * vz) / Math.sqrt(d2) < CONE) continue
    meilleure = p
    d2min = d2
  }
  return meilleure
}

/**
 * L'éclat d'un dépôt, de 1 (poussé cette semaine) à 0 : il pâlit de moitié
 * tous les trente jours, et s'éteint au bout d'un an.
 */
export function eclat(pushedAt: string, maintenant: Date): number {
  const jours = (maintenant.getTime() - new Date(pushedAt).getTime()) / 86400000
  if (jours <= 7) return 1
  if (jours >= 365) return 0
  return Math.pow(0.5, (jours - 7) / 30)
}

/** « aujourd'hui », « hier », « il y a 3 jours », « il y a 2 mois », « il y a 1 an ». */
export function ilYA(date: string, maintenant: Date): string {
  const jours = Math.floor((maintenant.getTime() - new Date(date).getTime()) / 86400000)
  if (jours <= 0) return 'aujourd’hui'
  if (jours === 1) return 'hier'
  if (jours < 31) return `il y a ${jours} jours`
  const mois = Math.floor(jours / 30.4)
  if (mois < 12) return `il y a ${mois} mois`
  const ans = Math.floor(jours / 365)
  return `il y a ${ans} an${ans > 1 ? 's' : ''}`
}
