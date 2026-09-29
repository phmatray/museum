/**
 * Le RELIEF du parc : des pelouses qui ondulent, quelques buttes douces, et le
 * fond du parc (au nord, derrière le musée) qui monte en pente lente.
 *
 * « Un des problèmes du jardin est qu'il est tout plat, ça ne fait pas
 * réaliste » (Philippe). Le relief reste pourtant à ZÉRO, avec un raccord doux,
 * partout où le monde doit être plat : le bâtiment et son parvis, l'axe de
 * l'entrée, et les zones du jardin japonais — leur sol est creusé par Blender
 * (build-jardin.py) et vaut 0 sur leur bord, où la pelouse le rejoint sans
 * fente.
 *
 * Une fonction pure : la marche (`walk.ts`), les plantations (`park.ts`), la
 * pelouse, les allées et l'herbe la lisent, et tombent d'accord au millimètre.
 */
import { JARDIN } from './jardin.ts'
import type { Rect } from './types.ts'

/** L'emprise du musée (`MUSEE`) élargie du parvis de `park.ts` : 5 m. */
const PARVIS: Rect = { x: -5, z: -5, width: 58, depth: 50 }
/** L'axe de l'entrée, du parvis au bord sud du terrain : une allée plate. */
const AXE: Rect = { x: 21.8, z: 45, width: 4.4, depth: 40 }
/** Le plat autour de ce qui doit l'être, puis la pente qui se lève sur `FONDU`. */
const PLAT = 2
const FONDU = 14

/** Distance d'un point à un rectangle : 0 dedans. */
function distanceRect(r: Rect, x: number, z: number): number {
  const dx = Math.max(r.x - x, 0, x - r.x - r.width)
  const dz = Math.max(r.z - z, 0, z - r.z - r.depth)
  return Math.hypot(dx, dz)
}

const lisse = (t: number) => t * t * (3 - 2 * t)

/**
 * Le masque du relief : 0 sur ce qui reste plat, 1 en pleine pelouse, et un
 * raccord en C¹ entre les deux (pas de pli sous le pied).
 */
export function masqueDuRelief(x: number, z: number): number {
  const d = Math.min(distanceRect(PARVIS, x, z), distanceRect(AXE, x, z), ...JARDIN.zones.map((r) => distanceRect(r, x, z)))
  return lisse(Math.min(1, Math.max(0, (d - PLAT) / FONDU)))
}

/** Un entier haché en [0, 1) : la valeur du bruit à un nœud du réseau. */
function noeud(i: number, j: number, graine: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(graine, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Bruit de valeur, interpolé en C¹ : des bosses rondes, sans facettes. */
function bruit(x: number, z: number, graine: number): number {
  const [i, j] = [Math.floor(x), Math.floor(z)]
  const [u, v] = [lisse(x - i), lisse(z - j)]
  const a = noeud(i, j, graine) + (noeud(i + 1, j, graine) - noeud(i, j, graine)) * u
  const b = noeud(i, j + 1, graine) + (noeud(i + 1, j + 1, graine) - noeud(i, j + 1, graine)) * u
  return a + (b - a) * v
}

/** Longueurs d'onde (m) et amplitudes (m) : de grandes ondulations, et des buttes. */
const OCTAVES: [number, number][] = [[26, 1.6], [11, 0.6]]
/**
 * Les buttes du jardin (tsukiyama) : (x, z, rayon, hauteur). Le bruit seul
 * ondule sans rien dire ; une butte se lit, on la contourne ou on la gravit.
 */
const BUTTES: [number, number, number, number][] = [[-24, 64, 13, 2.2], [-27, 20, 10, 1.6], [-18, -26, 12, 1.4], [8, 66, 8, 1.2]]
/** Le fond du parc, au nord : il monte d'autant sur ses 30 derniers mètres. */
const MONTEE_NORD = 1.2

/** Le dessus des dalles du parvis et de l'axe (`ParkLayer`) : 4 cm au-dessus du sol plat, 1 cm au-dessus du gravier. */
export const COTE_DALLAGE = 0.04

/**
 * Le sol sous le pied d'un meuble du dehors : le dessus des dalles sur le
 * parvis, la pelouse ailleurs. Poser à `hauteurDuParc` sur le parvis enfonçait
 * de 4 cm les vélos et les caisses dans le dallage (signalé par Philippe).
 */
export function solDuParc(x: number, z: number): number {
  return distanceRect(PARVIS, x, z) === 0 ? COTE_DALLAGE : hauteurDuParc(x, z)
}

/** La cote de la pelouse en (x, z), en mètres : 0 au parvis, jusqu'à ~3,5 m aux confins. */
export function hauteurDuParc(x: number, z: number): number {
  const m = masqueDuRelief(x, z)
  if (m === 0) return 0
  const ondes = OCTAVES.reduce((s, [l, a], k) => s + a * (bruit(x / l + 7.3 * k, z / l - 3.1 * k, k + 1) - 0.2), 0)
  const nord = MONTEE_NORD * lisse(Math.min(1, Math.max(0, (-10 - z) / 30)))
  const buttes = BUTTES.reduce((s, [bx, bz, r, h]) => s + h * Math.max(0, 1 - ((x - bx) ** 2 + (z - bz) ** 2) / (r * r)) ** 2, 0)
  return m * (ondes + nord + buttes)
}
