/**
 * Les projecteurs sur rail des salles : un par toile, au plafond, visé sur elle.
 *
 * Le rail court le long de chaque mur accroché, à 1,60 m de lui — sur le cadre
 * de plâtre du plafond, pas sur le verre du lanterneau (`plafonds.ts`, cadre de
 * 2 m). C'est de là que part la lumière de la toile regardée (`EveilLayer`) :
 * elle a enfin une source qu'on voit.
 *
 * Pur : ni three ni React.
 */
import type { Box } from './mesh.ts'
import type { Accrochage } from './hang.ts'
import type { Plan } from './types.ts'

/** Du mur au rail. */
export const RECUL = 1.6
/** L'axe de l'étrier, sous le plafond (`tools/blender/build-projecteur.py`). */
const AXE = 0.17
const EP_PLAFOND = 0.02
const RAIL = { largeur: 0.035, hauteur: 0.03, debord: 0.5 }

export interface Projecteur {
  key: string
  /** Le point d'accroche au plafond. */
  x: number
  y: number
  z: number
  /** Lacet de la monture : son avant (+Z) regarde le mur. */
  lacet: number
  /** Inclinaison de la tête vers la toile, en radians (positive vers le bas). */
  inclinaison: number
  /** L'axe de l'étrier, d'où part la lumière, et la toile visée. */
  source: [number, number, number]
  cible: [number, number, number]
}

const plafondDe = (plan: Plan, level: number): number =>
  (plan.levels.find((l) => l.id === level)?.elevation ?? 0) + plan.storey - plan.slab - EP_PLAFOND

export function projecteurs(plan: Plan, accrochage: Accrochage): Projecteur[] {
  return accrochage.rooms.flatMap((r) => {
    const plafond = plafondDe(plan, r.level)
    return r.placements.map((p) => {
      const [nx, nz] = p.normal
      const [x, z] = [p.x + nx * RECUL, p.z + nz * RECUL]
      const pivot = plafond - AXE
      return {
        key: p.key,
        x,
        y: plafond,
        z,
        lacet: Math.atan2(-nx, -nz),
        inclinaison: Math.atan2(pivot - p.y, RECUL),
        source: [x, pivot, z] as [number, number, number],
        cible: [p.x, p.y, p.z] as [number, number, number],
      }
    })
  })
}

/** Un rail par mur accroché, de la première à la dernière toile, 50 cm au-delà. */
export function rails(plan: Plan, accrochage: Accrochage): Box[] {
  return accrochage.rooms.flatMap((r) => {
    const plafond = plafondDe(plan, r.level)
    const parMur = new Map<string, Accrochage['rooms'][number]['placements']>()
    for (const p of r.placements) {
      const cle = `${p.normal[0]},${p.normal[1]}`
      parMur.set(cle, [...(parMur.get(cle) ?? []), p])
    }
    return [...parMur.values()].map((ps): Box => {
      const [nx, nz] = ps[0].normal
      const long = Math.abs(nz) > 0.5 // mur nord ou sud : le rail court selon x
      const us = ps.map((p) => (long ? p.x : p.z))
      const [a, b] = [Math.min(...us) - ps[0].width / 2 - RAIL.debord, Math.max(...us) + ps[0].width / 2 + RAIL.debord]
      const at = (long ? ps[0].z + nz * RECUL : ps[0].x + nx * RECUL)
      const y = plafond - RAIL.hauteur / 2
      return long
        ? { x: (a + b) / 2, y, z: at, w: b - a, h: RAIL.hauteur, d: RAIL.largeur, kind: 'railing' }
        : { x: at, y, z: (a + b) / 2, w: RAIL.largeur, h: RAIL.hauteur, d: b - a, kind: 'railing' }
    })
  })
}
