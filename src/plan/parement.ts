/**
 * La pierre du hall : le parement des murs et les bandes du sol.
 *
 * À Orsay, la nef est bordée de pierre de taille claire et son dallage est
 * rythmé de bandes sombres. Ici, le parement est une peau de 3 cm posée sur la
 * face des murs qui regarde le hall, dérivée des boîtes de `meshLevel` : les
 * portes y sont donc déjà découpées, et le côté galerie garde son plâtre.
 */
import { meshLevel, type Box } from './mesh.ts'
import type { Plan, Rect } from './types.ts'

const PEAU = 0.03
/** Les bandes du sol suivent les arcs doubleaux de la nef (`tools/blender/build-nef.py`). */
const TRAVEE = 3.5
const BANDE = 0.18
const EP_BANDE = 0.006
const EPS = 1e-6

function hallDe(plan: Plan): Rect {
  const hall = plan.levels.flatMap((l) => l.rooms).find((r) => r.kind === 'hall')
  if (!hall) throw new Error('le plan n’a pas de hall')
  return hall
}

/** Le parement des murs et linteaux qui bordent le hall, sur un niveau. */
export function parementDuHall(plan: Plan, levelId: number): Box[] {
  const h = hallDe(plan)
  const [x0, x1, z0, z1] = [h.x, h.x + h.width, h.z, h.z + h.depth]
  const out: Box[] = []
  for (const b of meshLevel(plan, levelId)) {
    if (b.kind !== 'wall' && b.kind !== 'lintel') continue
    const [bx0, bx1, bz0, bz1] = [b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2]
    if (b.d < b.w) {
      // Un mur courant selon x, sur le nord ou le sud du hall.
      const bord = [z0, z1].find((z) => bz0 - EPS <= z && z <= bz1 + EPS)
      const [s, t] = [Math.max(bx0, x0), Math.min(bx1, x1)]
      if (bord === undefined || t - s < EPS) continue
      const face = bord === z0 ? bz1 : bz0
      const z = face + (bord === z0 ? PEAU / 2 : -PEAU / 2)
      out.push({ ...b, x: (s + t) / 2, w: t - s, z, d: PEAU })
    } else {
      const bord = [x0, x1].find((x) => bx0 - EPS <= x && x <= bx1 + EPS)
      const [s, t] = [Math.max(bz0, z0), Math.min(bz1, z1)]
      if (bord === undefined || t - s < EPS) continue
      const face = bord === x0 ? bx1 : bx0
      const x = face + (bord === x0 ? PEAU / 2 : -PEAU / 2)
      out.push({ ...b, z: (s + t) / 2, d: t - s, x, w: PEAU })
    }
  }
  return out
}

/**
 * Les bandes sombres du dallage : deux filets le long de l'allée centrale, un
 * filet en travers sous chaque arc, du pied de l'escalier à l'entrée.
 */
export function bandesDuSol(plan: Plan): Box[] {
  const h = hallDe(plan)
  const pied = Math.max(...plan.flights.filter((f) => f.bottom === 0).map((f) => f.z + f.depth))
  const [x0, x1, z1] = [h.x, h.x + h.width, h.z + h.depth]
  const bande = (xa: number, xb: number, za: number, zb: number): Box =>
    ({ x: (xa + xb) / 2, y: EP_BANDE / 2, z: (za + zb) / 2, w: xb - xa, h: EP_BANDE, d: zb - za, kind: 'slab' })
  const out: Box[] = []
  const allee = h.width / 4
  for (const x of [x0 + allee, x1 - allee]) out.push(bande(x - BANDE / 2, x + BANDE / 2, pied, z1))
  for (let z = h.z + TRAVEE; z < z1 - EPS; z += TRAVEE) if (z > pied + EPS) out.push(bande(x0, x1, z - BANDE / 2, z + BANDE / 2))
  return out
}
