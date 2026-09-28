/**
 * La façade, d'après le S.M.A.K. de Gand : un bâtiment de brique, et devant
 * l'entrée un portique de pierre à piliers cannelés, vitré entre les piliers,
 * le nom du musée en lettres de métal au-dessus.
 *
 * Tout est en boîtes, comme le reste du bâtiment : le parement de brique est
 * dérivé des murs de façade de `meshLevel` (l'entrée y est déjà percée), le
 * portique est centré sur l'entrée et large comme la nef qu'il annonce.
 *
 * Les piliers et les jambages du portique sont des OBSTACLES du plan : dehors,
 * dans le parc, on les contourne. `musee.ts` les importe ; ce module ne peut
 * donc pas importer le plan, et le portique est posé en nombres (un test vérifie
 * qu'il tombe bien sur l'entrée du plan).
 *
 * Pur : ni three ni React.
 */
import { meshLevel, type Box } from './mesh.ts'
import { EXT } from './svg.ts'
import type { Plan, Rect } from './types.ts'

/** Le portique : de l'aplomb du hall (x = 16 à 32), en saillie sur la façade sud (z = 40). */
const P = { x0: 16, x1: 32, facade: 40 + EXT, saillie: 1.35, haut: 8.6 }
const JAMBAGE = 1
const PILIER = 0.8
const PILIERS = 4
const LINTEAU = 1.2
/** Les portes vitrées en bas, un bandeau de pierre, les hautes verrières au-dessus. */
const PORTES = 2.9
const BANDEAU = 0.7
/** Le parapet de brique qui cache le toit plat, et sa couvertine de pierre. */
const PARAPET = 1.2
const COUVERTINE = 0.12
const PEAU = 0.03

const baies = (): [number, number][] => {
  const [a, b] = [P.x0 + JAMBAGE, P.x1 - JAMBAGE]
  const l = (b - a - PILIERS * PILIER) / (PILIERS + 1)
  return Array.from({ length: PILIERS + 1 }, (_, i) => [a + i * (l + PILIER), a + i * (l + PILIER) + l])
}

const pave = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, kind: Box['kind'] = 'wall'): Box =>
  ({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, w: x1 - x0, h: y1 - y0, d: z1 - z0, kind })

/** Les jambages et les piliers, au sol : ce que la marche doit contourner dehors. */
export const OBSTACLES_PORTIQUE: Rect[] = (() => {
  const z = P.facade
  const pleins: [number, number][] = [[P.x0, P.x0 + JAMBAGE], [P.x1 - JAMBAGE, P.x1]]
  const b = baies()
  for (let i = 0; i < PILIERS; i++) pleins.push([b[i][1], b[i + 1][0]])
  return pleins.map(([x0, x1]) => ({ x: x0, z, width: x1 - x0, depth: P.saillie }))
})()

export interface Facade {
  /** Le parement de brique des murs de façade et le parapet. */
  brique: Box[]
  /** Jambages, linteau, bandeau et couvertines. */
  pierre: Box[]
  /** Les piliers cannelés. */
  piliers: Box[]
  /** Le verre sombre des baies du portique. */
  vitres: Box[]
  /** Montants et traverses de métal. */
  menuiseries: Box[]
  /** Où poser le nom du musée : le milieu de la ligne de base, sur la brique. */
  enseigne: { x: number; y: number; z: number }
  /** Les deux bannières, de part et d'autre du portique. */
  bannieres: { x: number; y: number; z: number; w: number; h: number }[]
  /** Les mâts des drapeaux, sur le toit, au pied de chaque mât. */
  mats: { x: number; y: number; z: number }[]
}

export function facade(plan: Plan): Facade {
  const [W, D] = [plan.width, plan.depth]
  const haut = plan.levels.length * plan.storey - plan.slab
  const out: Facade = { brique: [], pierre: [], piliers: [], vitres: [], menuiseries: [], enseigne: { x: 0, y: 0, z: 0 }, bannieres: [], mats: [] }

  // La brique : une peau sur la face extérieure de chaque mur ou linteau de façade.
  for (const level of plan.levels)
    for (const b of meshLevel(plan, level.id)) {
      if (b.kind !== 'wall' && b.kind !== 'lintel') continue
      const [x0, x1, z0, z1] = [b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2]
      const [y0, y1] = [b.y - b.h / 2, b.y + b.h / 2]
      if (Math.abs(z0 + EXT) < 1e-6) out.brique.push(pave(x0, x1, y0, y1, -EXT - PEAU, -EXT))
      if (Math.abs(z1 - D - EXT) < 1e-6) out.brique.push(pave(x0, x1, y0, y1, D + EXT, D + EXT + PEAU))
      if (Math.abs(x0 + EXT) < 1e-6) out.brique.push(pave(-EXT - PEAU, -EXT, y0, y1, z0, z1))
      if (Math.abs(x1 - W - EXT) < 1e-6) out.brique.push(pave(W + EXT, W + EXT + PEAU, y0, y1, z0, z1))
    }
  // La brique passe aussi devant la tranche des dalles d'étage, entre deux murs.
  for (const level of plan.levels.filter((l) => l.elevation > 0)) {
    const [y0, y1] = [level.elevation - plan.slab, level.elevation]
    const [xa, xb, za, zb] = [-EXT - PEAU, W + EXT + PEAU, -EXT - PEAU, D + EXT + PEAU]
    out.brique.push(pave(xa, xb, y0, y1, za, za + PEAU), pave(xa, xb, y0, y1, zb - PEAU, zb), pave(xa, xa + PEAU, y0, y1, za, zb), pave(xb - PEAU, xb, y0, y1, za, zb))
  }
  // Le parapet sur tout le pourtour, couvert de pierre.
  const [a, b] = [-EXT - PEAU, W + EXT + PEAU]
  const [c, d] = [-EXT - PEAU, D + EXT + PEAU]
  const e = EXT + PEAU
  for (const [x0, x1, z0, z1] of [[a, b, c, c + e], [a, b, d - e, d], [a, a + e, c + e, d - e], [b - e, b, c + e, d - e]]) {
    out.brique.push(pave(x0, x1, haut, haut + PARAPET, z0, z1))
    out.pierre.push(pave(x0 - 0.04, x1 + 0.04, haut + PARAPET, haut + PARAPET + COUVERTINE, z0 - 0.04, z1 + 0.04))
  }

  // Le portique.
  const [zf, zs] = [P.facade + PEAU, P.facade + P.saillie]
  out.pierre.push(pave(P.x0, P.x0 + JAMBAGE, 0, P.haut, zf, zs), pave(P.x1 - JAMBAGE, P.x1, 0, P.haut, zf, zs))
  out.pierre.push(pave(P.x0, P.x1, P.haut - LINTEAU, P.haut, zf, zs))
  const bs = baies()
  for (let i = 0; i < PILIERS; i++) out.piliers.push(pave(bs[i][1], bs[i + 1][0], 0, P.haut - LINTEAU, zf, zs - 0.1))
  const zv = zf + 0.25
  const centre = Math.floor(bs.length / 2)
  bs.forEach(([x0, x1], i) => {
    // Le bandeau de pierre entre portes et verrières, et les hautes verrières.
    out.pierre.push(pave(x0, x1, PORTES, PORTES + BANDEAU, zf, zv + 0.1))
    out.vitres.push(pave(x0, x1, PORTES + BANDEAU, P.haut - LINTEAU, zv, zv + 0.02, 'glass'))
    for (const u of [x0 + (x1 - x0) / 3, x0 + (2 * (x1 - x0)) / 3])
      out.menuiseries.push(pave(u - 0.03, u + 0.03, PORTES + BANDEAU, P.haut - LINTEAU, zv + 0.02, zv + 0.07))
    for (const h of [4.7, 6.1]) out.menuiseries.push(pave(x0, x1, h - 0.03, h + 0.03, zv + 0.02, zv + 0.07))
    // Les portes : vitrées, sauf celle du milieu, qui est l'entrée ouverte.
    out.menuiseries.push(pave(x0, x1, PORTES - 0.08, PORTES, zv, zv + 0.08))
    if (i === centre) return
    out.vitres.push(pave(x0, x1, 0, PORTES - 0.08, zv, zv + 0.02, 'glass'))
    for (const u of [x0 + 0.04, (x0 + x1) / 2, x1 - 0.04]) out.menuiseries.push(pave(u - 0.04, u + 0.04, 0, PORTES - 0.08, zv + 0.02, zv + 0.08))
  })

  out.enseigne = { x: (P.x0 + P.x1) / 2, y: P.haut + 0.2, z: P.facade + PEAU + 0.01 }
  out.bannieres = [P.x0 - 4.5, P.x1 + 4.5].map((x) => ({ x, y: 5.2, z: D + EXT + PEAU + 0.12, w: 3, h: 7 }))
  out.mats = [6, 12, 36, 42, 24].map((x) => ({ x, y: haut, z: D - 1.5 }))
  return out
}
