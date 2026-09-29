/**
 * L'éclairage artificiel qui n'est pas cuit : d'où partent les lumières des
 * lampadaires du parc et des spots sous les balcons de la nef.
 *
 * Aucune n'est une vraie lumière de three : trente-deux lampadaires et vingt-cinq
 * spots en temps réel, c'étaient autant de boucles par fragment dans TOUS les
 * matériaux, et des ombres qu'on ne peut pas se payer. Ce sont des points que
 * `scene/lueurs.ts` écrit en constantes dans le shader : chaque fragment de
 * dehors, la nuit, additionne la flaque des lampadaires proches à son ambiance ;
 * chaque fragment sous les balcons, celle des spots. Pas d'ombre portée — la
 * flaque d'un lampadaire de 2,20 m n'en a guère besoin.
 *
 * Pur : ni three ni React.
 */
import { MOBILIER } from './mobilier.ts'

/** Le globe du lampadaire (`build-lampadaire.py`) : à 31 cm de l'axe du fût, sous la crosse, à 1,755 m. */
export const GLOBE = { portee: 0.312, hauteur: 1.755 }

/** Le centre du globe de chaque lampadaire, en coordonnées du plan : [x, y, z]. */
export const SOURCES_LAMPADAIRES: [number, number, number][] = MOBILIER.filter((m) => m.piece === 'Lampadaire').map((m) => [
  m.x + GLOBE.portee * Math.cos(m.lacet),
  m.y + GLOBE.hauteur,
  m.z - GLOBE.portee * Math.sin(m.lacet),
])

/** La sous-face des balcons : dessus du plancher de l'étage (4,80) moins la dalle (0,30). */
export const SOUS_BALCON = 4.8 - 0.3
/** Du parement du mur au spot : un encastré de mur lavé, à 80 cm de la pierre. */
const RECUL = 0.15 + 0.03 + 0.8

/**
 * Les spots encastrés sous les balcons, tous les deux mètres : le long des murs
 * ouest et est de la nef (balcons de x 16–19 et 29–32, z 20–40) et du mur sud
 * (balcon de x 19–29, z 37–40). [x, y, z], à 2 cm sous la dalle.
 */
export const SPOTS_BALCON: [number, number, number][] = (() => {
  const y = SOUS_BALCON - 0.02
  const out: [number, number, number][] = []
  for (let z = 21; z <= 39; z += 2) out.push([16 + RECUL, y, z], [32 - RECUL, y, z])
  for (let x = 20; x <= 28; x += 2) out.push([x, y, 40 - RECUL])
  return out
})()

/**
 * Les projecteurs encastrés au pied de la façade sud, la nuit : ils lèchent la
 * brique de bas en haut, un arc de lumière par travée, et chaque pilier du
 * portique. Pas derrière l'abri à vélos (x 42,5–47), ni au pied des caisses
 * de Versailles qui gardent la porte. [x, y, z], au ras du dallage.
 */
export const PROJECTEURS_FACADE: [number, number, number][] = [
  // La brique des deux ailes, à 50 cm de la façade (z = 40,45).
  ...[3, 8, 13, 35.5, 39.5].map((x): [number, number, number] => [x, 0.1, 40.95]),
  // Les jambages et les deux piliers extérieurs du portique, à 40 cm de leur front (z = 41,80).
  ...[16.5, 19.15, 28.85, 31.5].map((x): [number, number, number] => [x, 0.1, 42.2]),
]
