/**
 * Le CHANTIER DU MUSÉE : une baraque de chantier vitrée sur la pelouse
 * sud-ouest, où le journal de chantier (`docs/journal`) s'accroche comme une
 * collection — le musée qui expose sa propre construction.
 *
 * ── Où, et pourquoi là ──
 *
 * Toutes les galeries du plan portent un thème de projets : la salle ne pouvait
 * pas être dedans. Dehors, le jardin japonais tient le sud-est (l'étang, le
 * ruisseau) ; le sud-ouest, lui, n'avait qu'une pelouse, la fontaine et le pied
 * d'une butte. La baraque s'y pose en pendant de l'étang, de l'autre côté de
 * l'axe de l'entrée : on la voit en sortant du portique, sa porte et son
 * enseigne tournées vers l'axe, la fontaine devant. Elle ne coupe ni la
 * ceinture (3 m au nord), ni l'axe (9 m à l'est), ni aucune eau.
 *
 * ── Ce qui se déduit ici ──
 *
 * Les murs que la marche arrête (`OBSTACLES_CHANTIER`, dans les obstacles du
 * rez-de-chaussée comme ceux du jardin), et l'ACCROCHAGE : les étapes en ordre
 * chronologique, en frise de petits cadres sur les deux longs murs, les
 * dernières en grand, de part et d'autre de la porte et sur le pignon du fond.
 *
 * La charpente, le lambris et la verrière sont ceux de
 * `tools/blender/build-chantier.py`, qui lit le même `chantier.json`.
 *
 * Pur : ni three ni React.
 */
import CHANTIER_JSON from './chantier.json' with { type: 'json' }
import type { Rect } from './types.ts'

export const CHANTIER = CHANTIER_JSON as unknown as {
  emprise: Rect
  /** La cote de son plancher : la plate-forme de niveau que lui fait le relief (`relief.ts`). */
  cote: number
  mur: number
  porte: { z: number; largeur: number }
  lambris: number
  egout: number
  faitage: number
  table: { x: number; z: number; largeur: number; profondeur: number; hauteur: number }
}

const { emprise: E, mur: M, porte: P, table: T } = CHANTIER

/** L'emprise au sol de la baraque, murs compris. */
export const EMPRISE_CHANTIER: Rect = E

/** Le centre, et le seuil de la porte, dehors et dedans (le pignon est, face à l'axe). */
export const CENTRE_CHANTIER: [number, number] = [E.x + E.width / 2, E.z + E.depth / 2]
export const SEUIL_CHANTIER = { dehors: [E.x + E.width + 1.2, P.z] as [number, number], dedans: [E.x + E.width - 1.4, P.z] as [number, number] }

/**
 * Les murs et la table sur tréteaux, fermés à la marche. Le pignon est est
 * percé de la porte ; le reste est plein jusqu'au lambris.
 */
export const OBSTACLES_CHANTIER: Rect[] = [
  { x: E.x, z: E.z, width: E.width, depth: M },
  { x: E.x, z: E.z + E.depth - M, width: E.width, depth: M },
  { x: E.x, z: E.z, width: M, depth: E.depth },
  { x: E.x + E.width - M, z: E.z, width: M, depth: P.z - P.largeur / 2 - E.z },
  { x: E.x + E.width - M, z: P.z + P.largeur / 2, width: M, depth: E.z + E.depth - P.z - P.largeur / 2 },
  { x: T.x - T.largeur / 2, z: T.z - T.profondeur / 2, width: T.largeur, depth: T.profondeur },
]

/** Vrai dans l'emprise (élargie de `marge`). */
export const dansLeChantier = (x: number, z: number, marge = 0) =>
  x >= E.x - marge && x <= E.x + E.width + marge && z >= E.z - marge && z <= E.z + E.depth + marge

// ── L'accrochage ────────────────────────────────────────────────────────────

/** Les dernières étapes, en grand : deux de part et d'autre de la porte, trois au fond. */
export const GRANDS = 5
/** La frise : deux rangs par long mur, centrés à ces hauteurs. */
const RANGS = [1.83, 1.3]
const CADRE_MAX = 0.44
/** Le jour entre deux petits cadres. */
const JOUR = 0.06
/** La frise s'arrête à 35 cm des angles. */
const RETRAIT = 0.35
const GRAND = { fond: 1.3, porte: 1.1, y: 1.6 }
/** Le cadre saille du lambris. */
const SAILLIE = 0.02

export interface CadreChantier {
  /** L'étape, par son rang chronologique dans le journal. */
  etape: number
  x: number
  y: number
  z: number
  /** La normale du mur, vers la salle. */
  normal: [number, number]
  /** Le cadre est carré : son côté. */
  cote: number
  grand: boolean
  /** Sa case dans l'atlas de sa taille (petits ou grands). */
  case: number
}

/**
 * L'accrochage de `n` étapes, dans l'ordre chronologique. La frise part de la
 * porte : le long mur sud, lu de gauche à droite face à lui (d'est en ouest),
 * rang du haut puis du bas ; puis le long mur nord, d'ouest en est. Les grands
 * cadres finissent la visite : de part et d'autre de la porte, puis les trois
 * dernières étapes sur le pignon du fond, face à qui entre.
 */
export function accrocherChantier(n: number): CadreChantier[] {
  const grands = Math.min(GRANDS, n)
  const frise = n - grands
  const [xo, xe] = [E.x + M + RETRAIT, E.x + E.width - M - RETRAIT]
  const parRang = Math.max(1, Math.ceil(frise / 4))
  const pas = (xe - xo) / parRang
  const cote = Math.min(CADRE_MAX, pas - JOUR)
  const out: CadreChantier[] = []
  const murs: { z: number; nz: number; x: (k: number) => number }[] = [
    { z: E.z + E.depth - M - SAILLIE, nz: -1, x: (k) => xe - (k + 0.5) * pas },
    { z: E.z + M + SAILLIE, nz: 1, x: (k) => xo + (k + 0.5) * pas },
  ]
  for (let i = 0; i < frise; i++) {
    const mur = murs[Math.floor(i / (2 * parRang))]
    const k = i % parRang
    out.push({ etape: i, x: mur.x(k), y: CHANTIER.cote + RANGS[Math.floor(i / parRang) % 2], z: mur.z, normal: [0, mur.nz], cote, grand: false, case: i })
  }
  const xPorte = E.x + E.width - M - SAILLIE
  const xFond = E.x + M + SAILLIE
  const [z0, z1] = [E.z + M, E.z + E.depth - M]
  const [pa, pb] = [P.z - P.largeur / 2, P.z + P.largeur / 2]
  const places: [number, number, number, number][] = [
    // Face à la porte, dos au jardin : le nord à gauche, le sud à droite.
    [xPorte, (z0 + pa) / 2, -1, GRAND.porte],
    [xPorte, (pb + z1) / 2, -1, GRAND.porte],
    // Le fond, lu face à lui : du sud au nord.
    ...[5 / 6, 1 / 2, 1 / 6].map((t): [number, number, number, number] => [xFond, z0 + t * (z1 - z0), 1, GRAND.fond]),
  ]
  for (let j = 0; j < grands; j++) {
    const [x, z, nx, c] = places[places.length - grands + j]
    out.push({ etape: frise + j, x, y: CHANTIER.cote + GRAND.y, z, normal: [nx, 0], cote: c, grand: true, case: j })
  }
  return out
}

/** À plus de 3,5 m, on traverse la baraque ; on ne lit pas un cartel. */
const PORTEE = 3.5
/** Le regard vise un petit cadre à 9° près, un grand à 14° près : la frise est serrée. */
const VISEE = { petit: Math.cos((9 * Math.PI) / 180), grand: Math.cos((14 * Math.PI) / 180) }

/**
 * Le cadre que le visiteur regarde : devant lui, à portée, du bon côté du mur,
 * le mieux dans l'axe de son regard — en hauteur aussi, la frise a deux rangs.
 * `regard` est unitaire. `null` si aucun.
 */
export function cadreVise(cadres: readonly CadreChantier[], oeil: { x: number; y: number; z: number }, regard: { x: number; y: number; z: number }): CadreChantier | null {
  let meilleur: CadreChantier | null = null
  let cosMax = -1
  for (const c of cadres) {
    const [dx, dy, dz] = [c.x - oeil.x, c.y - oeil.y, c.z - oeil.z]
    const d = Math.hypot(dx, dy, dz)
    if (d > PORTEE || d < 1e-6) continue
    // Devant le mur : la normale regarde le visiteur.
    if (dx * c.normal[0] + dz * c.normal[1] > -0.2) continue
    const cos = (dx * regard.x + dy * regard.y + dz * regard.z) / d
    if (cos >= (c.grand ? VISEE.grand : VISEE.petit) && cos > cosMax) [meilleur, cosMax] = [c, cos]
  }
  return meilleur
}
