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
/** Une couche de peinture : assez mince pour passer sous les cadres et les cartels. */
const PEINTURE = 0.002
/** Les bandes du sol suivent les arcs doubleaux de la nef (`tools/blender/build-nef.py`). */
const TRAVEE = 3.5
const BANDE = 0.18
const EP_BANDE = 0.006
const EPS = 1e-6
/** La plinthe : 12 cm de haut, 12 mm devant la pierre ou la peinture. */
const PLINTHE_H = 0.12
const PLINTHE_EP = 0.012

function hallDe(plan: Plan): Rect {
  const hall = plan.levels.flatMap((l) => l.rooms).find((r) => r.kind === 'hall')
  if (!hall) throw new Error('le plan n’a pas de hall')
  return hall
}

/** Le parement des murs et linteaux qui bordent le hall, sur un niveau. */
export function parementDuHall(plan: Plan, levelId: number): Box[] {
  const peau = peauInterieure(plan, levelId, hallDe(plan), PEAU)
  // Les murs d'un niveau s'arrêtent sous la dalle du suivant : sur le hall, là
  // où aucun balcon ne vient s'y appuyer (au-dessus des volées latérales, sous
  // la baie de la salle d'honneur), la tranche de cette dalle restait à nu, en
  // retrait du parement — une bande de parquet de 30 cm en travers de la
  // pierre. La peau monte d'autant, en boîtes à part : celles d'en dessous
  // gardent leur clé, donc leur lumière cuite.
  const level = plan.levels.find((l) => l.id === levelId)
  const dessus = plan.levels.some((l) => level !== undefined && l.elevation > level.elevation)
  if (level === undefined || !dessus) return peau
  const haut = level.elevation + plan.storey - plan.slab
  const tranches = peau
    .filter((b) => Math.abs(b.y + b.h / 2 - haut) < EPS)
    // Arasée 1 mm sous le plancher : le long des balcons, son dessus serait dans le plan de leur dalle.
    .map((b) => ({ ...b, y: haut + (plan.slab - 0.001) / 2, h: plan.slab - 0.001 }))
  return [...peau, ...tranches]
}

/**
 * Les murs de couleur des galeries, comme à Orsay : bordeaux, vert, bleu de
 * Prusse… Une toile blanche sur un mur gris se perd ; sur un mur profond, elle
 * sort. Une couche de peinture de 2 mm sur la face intérieure de chaque galerie,
 * chacune sa couleur (`COULEURS_SALLES`, par rang), la salle d'honneur a son décor.
 */
export const COULEURS_SALLES = ['#5e2a2c', '#2f4a3c', '#2b3b55', '#7a4128', '#46504a', '#4a2f47', '#6b5a2e'] as const

export function peintureDesSalles(plan: Plan, levelId: number): { couleur: string; boites: Box[] }[] {
  const level = plan.levels.find((l) => l.id === levelId)
  if (!level) return []
  const galeries = plan.levels.flatMap((l) => l.rooms.filter((r) => r.kind === 'gallery').map((r) => ({ r, l: l.id })))
  const parCouleur = new Map<string, Box[]>()
  galeries.forEach(({ r, l }, i) => {
    if (l !== levelId) return
    const couleur = COULEURS_SALLES[i % COULEURS_SALLES.length]
    parCouleur.set(couleur, [...(parCouleur.get(couleur) ?? []), ...peauInterieure(plan, levelId, r, PEINTURE)])
  })
  return [...parCouleur].map(([couleur, boites]) => ({ couleur, boites }))
}

/**
 * Les plinthes : au pied de chaque mur, dans les galeries, le hall et le long
 * des balcons, interrompues aux portes (les murs de `meshLevel` y sont déjà
 * coupés). Elles passent devant le parement du hall et la peinture des salles.
 * La salle d'honneur a son propre décor. Dans le hall, granit sombre sur la
 * pierre claire ; dans les salles, pierre claire sur les murs de couleur.
 */
export function plinthes(plan: Plan, levelId: number): { hall: Box[]; salles: Box[] } {
  const level = plan.levels.find((l) => l.id === levelId)
  const pour = (hall: boolean) =>
    (level?.rooms ?? [])
      .filter((r) => r.kind !== 'honneur' && (r.kind === 'hall') === hall)
      .flatMap((r) => peauInterieure(plan, levelId, r, (hall ? PEAU : PEINTURE) + PLINTHE_EP, false))
      .map((b) => ({ ...b, y: (level?.elevation ?? 0) + PLINTHE_H / 2, h: PLINTHE_H }))
  return { hall: pour(true), salles: pour(false) }
}

/** Une peau d'épaisseur `ep` sur la face des murs et linteaux qui regarde l'intérieur de `r`. */
function peauInterieure(plan: Plan, levelId: number, r: Rect, ep: number, linteaux = true): Box[] {
  const [x0, x1, z0, z1] = [r.x, r.x + r.width, r.z, r.z + r.depth]
  const out: Box[] = []
  for (const b of meshLevel(plan, levelId)) {
    if (b.kind !== 'wall' && (b.kind !== 'lintel' || !linteaux)) continue
    const [bx0, bx1, bz0, bz1] = [b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2]
    if (b.d < b.w) {
      // Un mur courant selon x, sur le nord ou le sud du hall.
      const bord = [z0, z1].find((z) => bz0 - EPS <= z && z <= bz1 + EPS)
      const [s, t] = [Math.max(bx0, x0), Math.min(bx1, x1)]
      if (bord === undefined || t - s < EPS) continue
      const face = bord === z0 ? bz1 : bz0
      const z = face + (bord === z0 ? ep / 2 : -ep / 2)
      out.push({ ...b, x: (s + t) / 2, w: t - s, z, d: ep })
    } else {
      const bord = [x0, x1].find((x) => bx0 - EPS <= x && x <= bx1 + EPS)
      const [s, t] = [Math.max(bz0, z0), Math.min(bz1, z1)]
      if (bord === undefined || t - s < EPS) continue
      const face = bord === x0 ? bx1 : bx0
      const x = face + (bord === x0 ? ep / 2 : -ep / 2)
      out.push({ ...b, z: (s + t) / 2, d: t - s, x, w: ep })
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
