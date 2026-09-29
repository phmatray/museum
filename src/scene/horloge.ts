/** L'heure de l'horloge de la nef, sans three : testable seule. */

/**
 * Les angles des aiguilles, en radians depuis midi, dans le sens horaire.
 * L'aiguille des heures avance avec les minutes, celle des minutes avec les secondes.
 */
export function anglesHorloge(d: Date): { heures: number; minutes: number } {
  const minutes = d.getMinutes() + d.getSeconds() / 60
  return { heures: (2 * Math.PI * ((d.getHours() % 12) + minutes / 60)) / 12, minutes: (2 * Math.PI * minutes) / 60 }
}

/** Le nombre de coups à l'heure pile, sur un cadran de douze heures. */
export function coupsDeLHeure(d: Date): number {
  return d.getHours() % 12 || 12
}

/** L'écart entre deux coups de cloche, en secondes. */
export const ENTRE_COUPS = 1.6
const LEVEE = 0.35
const CHUTE = 0.08

/**
 * Le marteau et la cloche, `t` secondes après le début d'un coup : le marteau
 * se lève (angle négatif), retombe, frappe à `LEVEE + CHUTE` ; la cloche vibre
 * ensuite et s'amortit. Hors d'un coup, tout est au repos — y compris avant
 * le tout premier (`t` infini) : `0 × sin(∞)` vaudrait NaN, et une rotation NaN
 * efface la cloche de l'écran.
 */
export function coupDeCloche(t: number): { marteau: number; cloche: number } {
  if (t < 0 || !Number.isFinite(t)) return { marteau: 0, cloche: 0 }
  if (t < LEVEE) return { marteau: -0.7 * Math.sin((t / LEVEE) * (Math.PI / 2)), cloche: 0 }
  if (t < LEVEE + CHUTE) return { marteau: -0.7 * Math.cos(((t - LEVEE) / CHUTE) * (Math.PI / 2)), cloche: 0 }
  const s = t - LEVEE - CHUTE
  return { marteau: 0.05 * Math.exp(-s * 20) * Math.sin(s * 40), cloche: 0.09 * Math.exp(-s * 2.5) * Math.sin(s * 14) }
}
