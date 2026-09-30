/**
 * Les GRANDS ARBRES du parc : de quoi donner au jardin une ligne d'horizon.
 *
 * Tout le parc tenait sous 5 m — des érables du Japon, des boules, l'étang :
 * vu du portique, un plan d'eau et de pelouse sous un grand ciel, sans rien qui
 * le tienne. Quatre sujets le composent, plantés à dessein (`park.ts`), leurs
 * modèles dans `grands-arbres.glb` (`tools/blender/build-grands-arbres.py`) :
 *
 * - le CÈDRE DU LIBAN, 21 m, seul sur le grand gazon du sud-ouest : on le voit du
 *   portique, à gauche de l'étang, et du belvédère, à gauche de la façade ;
 * - le PIN NOIR taillé en nuages, sur la rive nord-ouest de l'étang, penché sur
 *   l'eau : le premier plan japonais de la vue du portique ;
 * - deux GINKGOS de 16 m : l'un contre le mur sud, qui ferme le jardin au fond,
 *   l'autre sur le gazon ouest ; jaunes d'or à l'automne.
 *
 * Leurs troncs arrêtent la marche (`OBSTACLES_GRANDS_ARBRES`) ; leurs houppiers
 * écartent ce qui pousserait dedans (`DEGAGEMENT`). Pur : ni three ni React.
 */
import type { Rect } from './types.ts'

export type EssenceGrande = 'cedre' | 'ginkgo' | 'pin'

export interface GrandArbre {
  espece: EssenceGrande
  x: number
  z: number
  /** Lacet, en radians. Le pin penche vers son +x local : vers l'eau. */
  lacet: number
  scale: number
}

export const GRANDS_ARBRES: readonly GrandArbre[] = [
  { espece: 'cedre', x: -22, z: 62, lacet: 0.6, scale: 1 },
  // Il penche vers +x : tourné vers le centre de l'étang (46, 65), au sud-est.
  { espece: 'pin', x: 36.5, z: 56.5, lacet: -Math.atan2(65 - 56.5, 46 - 36.5), scale: 1 },
  { espece: 'ginkgo', x: 6, z: 72, lacet: 1.1, scale: 1 },
  { espece: 'ginkgo', x: -30, z: 30, lacet: 2.7, scale: 0.92 },
]

/** Le rayon du tronc au pied, contreforts compris (m) : ce que la marche contourne. */
export const TRONC: Record<EssenceGrande, number> = { cedre: 1.1, ginkgo: 0.55, pin: 0.45 }

/**
 * Sous le houppier, ce qui s'écarte : les érables (qui s'y mêleraient) jusqu'à
 * `grands`, les touffes jusqu'à `petits` (m, depuis le tronc).
 */
export const DEGAGEMENT: Record<EssenceGrande, { grands: number; petits: number }> = {
  cedre: { grands: 8, petits: 2.2 },
  ginkgo: { grands: 4.5, petits: 1.3 },
  pin: { grands: 3, petits: 1.2 },
}

/** Le demi-encombrement du houppier (m), pour le reste du parc. */
export const HOUPPIER: Record<EssenceGrande, number> = { cedre: 8.5, ginkgo: 4.2, pin: 2.6 }

/** Les troncs, en carrés : la marche ne passe pas au travers. */
export const OBSTACLES_GRANDS_ARBRES: Rect[] = GRANDS_ARBRES.map(({ espece, x, z, scale }) => {
  const r = TRONC[espece] * scale
  return { x: x - r, z: z - r, width: 2 * r, depth: 2 * r }
})
