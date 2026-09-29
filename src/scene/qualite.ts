/**
 * La qualité de rendu adaptative : ce qui s'en décide sans canvas.
 *
 * ── La règle ──
 *
 * La pleine qualité est la règle, pas un plafond qu'on vise : sur un écran
 * rétina, la densité de pixels reste celle de l'écran (jusqu'à 2), exactement
 * comme avant. On ne descend QUE si la machine ne suit plus (le moniteur de
 * drei voit les images tomber sous son seuil bas), un palier à la fois, et on
 * remonte dès qu'elle suit de nouveau.
 *
 * ── Pourquoi seulement la densité de pixels ──
 *
 * C'est le levier le plus efficace (le coût de toute la chaîne — scène,
 * occlusion, bloom, SMAA — suit le nombre de pixels) et le seul qui ne
 * recompile rien : toucher aux échantillons de N8AO remplacerait son shader,
 * donc un à-coup de compilation au moment précis où la machine peine déjà.
 *
 * ── L'hystérésis ──
 *
 * Descendre vite, remonter prudemment. Le moniteur ne crie à la baisse
 * qu'en dessous de ~40 im/s et à la hausse qu'au rafraîchissement plein : entre
 * les deux, rien ne bouge. Et chaque remontée démentie par une rechute double
 * le nombre de verdicts « ça suit » exigés avant la suivante : une machine à la
 * limite finit par se poser au palier qu'elle tient, sans jamais être privée
 * pour de bon de la pleine qualité.
 */

/** Les densités de pixels essayées, de la pleine qualité vers la plus sobre. */
export const PALIERS_DPR = [2, 1.5, 1.25, 1, 0.75] as const

/** `?qualite=haute` fige la pleine qualité (captures), `basse` fige la plus sobre. */
export type QualiteForcee = 'haute' | 'basse' | null

export function qualiteDemandee(recherche: string): QualiteForcee {
  const q = new URLSearchParams(recherche).get('qualite')
  return q === 'haute' || q === 'basse' ? q : null
}

/** Les paliers utiles sur cet écran : ceux au-dessus de sa densité se confondent avec elle. */
export function paliersPour(dprEcran: number): number[] {
  const plein = Math.min(Math.max(dprEcran, 1), PALIERS_DPR[0])
  return [plein, ...PALIERS_DPR.filter((d) => d < plein)]
}

export interface EtatQualite {
  /** Indice dans les paliers : 0 = pleine qualité. */
  palier: number
  /** Verdicts « ça suit » consécutifs reçus depuis le dernier changement. */
  hausses: number
  /** Verdicts « ça suit » exigés pour remonter d'un palier. */
  exigees: number
  /** Le dernier mouvement était une remontée (une baisse juste après la dément). */
  remonte: boolean
}

export const QUALITE_INITIALE: EtatQualite = { palier: 0, hausses: 0, exigees: 1, remonte: false }

/** Au-delà, une machine qui oscille reste où elle est pour ~40 s de fluidité continue. */
const EXIGENCE_MAX = 16

export function ajusterQualite(e: EtatQualite, verdict: 'baisse' | 'hausse', nbPaliers: number): EtatQualite {
  if (verdict === 'baisse') {
    if (e.palier >= nbPaliers - 1) return { ...e, hausses: 0 }
    const exigees = e.remonte ? Math.min(e.exigees * 2, EXIGENCE_MAX) : e.exigees
    return { palier: e.palier + 1, hausses: 0, exigees, remonte: false }
  }
  if (e.palier === 0) return e
  const hausses = e.hausses + 1
  if (hausses < e.exigees) return { ...e, hausses }
  return { palier: e.palier - 1, hausses: 0, exigees: e.exigees, remonte: true }
}
