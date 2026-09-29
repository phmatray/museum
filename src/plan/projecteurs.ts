/**
 * Les projecteurs sur rail des salles : un par toile, au plafond, visé sur elle.
 *
 * Le rail court le long de chaque mur accroché, à 1,60 m de lui — sur le cadre
 * de plâtre du plafond, pas sur le verre du lanterneau (`plafonds.ts`, cadre de
 * 2 m). Une face de cimaise (`cimaises.ts`) a le sien, à 1,60 m d'elle aussi :
 * celui-là passe sous le lanterneau, pendu à sa résille. C'est de là que part la lumière de la toile regardée (`EveilLayer`) :
 * elle a enfin une source qu'on voit.
 *
 * Pur : ni three ni React.
 */
import type { Box } from './mesh.ts'
import type { Accrochage } from './hang.ts'
import { VOUTE } from './plafonds.ts'
import type { Plan } from './types.ts'

/** Du mur au rail. */
export const RECUL = 1.6
/** L'axe de l'étrier, sous le plafond (`tools/blender/build-projecteur.py`). */
const AXE = 0.17
const EP_PLAFOND = 0.02
/** L'écart laissé, dans un angle, entre le bout d'un rail et le rail du mur voisin. */
const GARDE_ANGLE = 0.25
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

/** Sous le plafond de plâtre ; sous la corniche de la voûte en salle d'honneur. */
const plafondDe = (plan: Plan, level: number, salle: string): number =>
  (plan.levels.find((l) => l.id === level)?.elevation ?? 0) + plan.storey - plan.slab +
  (salle === VOUTE.salle ? VOUTE.gorge : -EP_PLAFOND)

export function projecteurs(plan: Plan, accrochage: Accrochage): Projecteur[] {
  return accrochage.rooms.flatMap((r) => {
    const plafond = plafondDe(plan, r.level, r.id)
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

/** Un rail par mur (ou face de cimaise) accroché, de la première à la dernière toile, 50 cm au-delà. */
export function rails(plan: Plan, accrochage: Accrochage): Box[] {
  return accrochage.rooms.flatMap((r) => {
    const plafond = plafondDe(plan, r.level, r.id)
    const parMur = new Map<string, Accrochage['rooms'][number]['placements']>()
    for (const p of r.placements) {
      // Un mur par normale ET par plan : les deux faces d'une cimaise, ou une
      // cimaise parallèle à un mur, ont chacune leur rail (`cimaises.ts`).
      const cle = `${p.normal[0]},${p.normal[1]},${Math.abs(p.normal[1]) > 0.5 ? p.z : p.x}`
      parMur.set(cle, [...(parMur.get(cle) ?? []), p])
    }
    const lignes = [...parMur.values()].map((ps) => {
      const [nx, nz] = ps[0].normal
      const long = Math.abs(nz) > 0.5 // mur nord ou sud : le rail court selon x
      const us = ps.map((p) => (long ? p.x : p.z))
      // Borné par les rails des murs voisins (à RECUL du mur, eux aussi) : sans ça,
      // les rails se croisaient dans les angles (signalé par Philippe).
      const salle = plan.levels.find((l) => l.id === r.level)?.rooms.find((s) => s.id === r.id)
      const [lo, hi] = salle ? (long ? [salle.x, salle.x + salle.width] : [salle.z, salle.z + salle.depth]) : [-Infinity, Infinity]
      return {
        long,
        at: long ? ps[0].z + nz * RECUL : ps[0].x + nx * RECUL,
        a: Math.max(Math.min(...us) - ps[0].width / 2 - RAIL.debord, lo + RECUL + GARDE_ANGLE),
        b: Math.min(Math.max(...us) + ps[0].width / 2 + RAIL.debord, hi - RECUL - GARDE_ANGLE),
        premier: Math.min(...us),
        dernier: Math.max(...us),
      }
    })
    // Dans l'angle rentrant d'une cimaise en équerre (`cimaises.ts`), les rails des
    // deux faces se croiseraient : chacun s'arrête avant l'autre, au-delà de son
    // dernier projecteur.
    for (const h of lignes.filter((l) => l.long))
      for (const v of lignes.filter((l) => !l.long)) {
        if (!(v.at > h.a && v.at < h.b && h.at > v.a && h.at < v.b)) continue
        for (const [l, c] of [[h, v.at], [v, h.at]] as const) {
          if (c > l.dernier) l.b = Math.min(l.b, c - GARDE_ANGLE)
          else if (c < l.premier) l.a = Math.max(l.a, c + GARDE_ANGLE)
        }
      }
    const y = plafond - RAIL.hauteur / 2
    return lignes.map(({ long, at, a, b }): Box => long
      ? { x: (a + b) / 2, y, z: at, w: b - a, h: RAIL.hauteur, d: RAIL.largeur, kind: 'railing' }
      : { x: at, y, z: (a + b) / 2, w: RAIL.largeur, h: RAIL.hauteur, d: b - a, kind: 'railing' })
  })
}
