/**
 * L'USURE du musée, lue sur sa géométrie : où la pluie coule, où l'on marche.
 *
 * Un bâtiment qui a vécu ne se salit pas au hasard. L'eau tombe des saillies —
 * corniche, bandeau, appuis des fenêtres — et trace sous chacune ses coulures,
 * plus longues sous les plus larges, plus fortes aux deux bouts d'un appui où
 * elle se rassemble ; elle ruisselle aux angles. Le sol s'use là où l'on passe :
 * au milieu des allées, dans l'axe du hall, de l'entrée à l'escalier et aux
 * portes des galeries ; la mousse prend dans les joints où l'on ne marche pas.
 *
 * Ici, les cartes que les matières (`scene/usure.ts`) lisent : la façade
 * dépliée (ses quatre faces, une rangée chacune) et le sol du parc vu du ciel.
 * Le bruit fin — le fil d'une coulure, le grain d'une plaque de mousse — est
 * ajouté par le shader ; l'endroit et la force viennent d'ici.
 *
 * Pur : ni three ni React.
 */
import { champDesAllees } from './allees.ts'
import { facade } from './facade.ts'
import { generateur, type Allee, type Parc } from './park.ts'
import { EXT } from './svg.ts'
import type { Plan } from './types.ts'

// ── La façade : les coulures ─────────────────────────────────────────────

/** La brique de façade est à `EXT` + sa peau de 3 cm hors du mur (`facade.ts`). */
const NU = EXT + 0.03
/**
 * La façade dépliée : `ppm` texels par mètre, `u` le long de la face (x au nord
 * et au sud, z à l'ouest et à l'est) à partir de `u0`, `y` de 0 à `hauteur`.
 * Une rangée par face, dans l'ordre nord, sud, ouest, est.
 */
export const SALISSURE = { ppm: 10, u0: -1.6, largeur: 51.2, hauteur: 11.2 }

export interface CarteDesSalissures {
  /** Texels le long d'une face, et en hauteur pour UNE face (la carte en empile quatre). */
  nu: number
  nv: number
  /**
   * RGBA, 8 bits : R la coulure (sa force, déjà atténuée en descendant), G
   * l'eau des angles, B l'abri sous une saillie, que la pluie ne lave jamais.
   */
  data: Uint8Array
}

/**
 * La face du bâtiment qui regarde le point (x, z) — 0 nord, 1 sud, 2 ouest,
 * 3 est — et sa coordonnée le long d'elle ; `null` dedans. Aux angles, la face
 * dont on est le plus loin. Le shader refait le même calcul (`scene/usure.ts`).
 */
export function faceDeFacade(plan: Plan, x: number, z: number): { face: number; u: number } | null {
  const d = [-z, z - plan.depth, -x, x - plan.width]
  const m = Math.max(...d)
  if (m < -0.02) return null
  const face = d.indexOf(m)
  return { face, u: face < 2 ? x : z }
}

interface Source {
  face: number
  a: number
  b: number
  /** D'où l'eau tombe. */
  y: number
  force: number
  long: number
  /** Un appui : l'eau se rassemble à ses deux bouts. */
  bouts: boolean
}

/** Un bruit de valeur à une dimension, nœuds tous les `pas` mètres : la même coulure d'un chargement à l'autre. */
function bruit1(graine: string, pas: number): (u: number) => number {
  const alea = generateur(graine)
  const noeuds = new Map<number, number>()
  const n = (k: number) => {
    let v = noeuds.get(k)
    if (v === undefined) noeuds.set(k, (v = alea()))
    return v
  }
  // Les nœuds tirés dans l'ordre, une fois pour toutes : le résultat ne dépend pas de l'ordre des appels.
  for (let k = -20; k <= 400; k++) n(k)
  return (u) => {
    const t = u / pas
    const k = Math.floor(t)
    const f = t - k
    const s = f * f * (3 - 2 * f)
    return n(k) * (1 - s) + n(k + 1) * s
  }
}

/**
 * Les coulures de la façade, dépliée face par face. Chaque boîte de pierre
 * posée en saillie sur la brique — appui, corniche, bandeau, tête de
 * chambranle — lâche l'eau par-dessous : une coulure d'autant plus longue et
 * plus forte que la saillie est large. Le portique, plus profond, la lâche par
 * son arase : elle coule sur la face du linteau et des jambages. Les angles du
 * bâtiment et du portique ruissellent de haut en bas.
 */
export function carteDesSalissures(plan: Plan): CarteDesSalissures {
  const F = facade(plan)
  const [W, D] = [plan.width, plan.depth]
  const haut = plan.levels.length * plan.storey - plan.slab
  const { ppm, u0, largeur, hauteur } = SALISSURE
  const [nu, nv] = [Math.round(largeur * ppm), Math.round(hauteur * ppm)]
  const data = new Uint8Array(nu * nv * 4 * 4)
  const sources: Source[] = []

  // La couvertine du parapet : la plus haute pierre ; elle fait le tour.
  const couvertine = Math.max(...F.pierre.map((b) => b.y - b.h / 2))
  for (let face = 0; face < 4; face++) {
    const L = face < 2 ? W : D
    sources.push({ face, a: -NU - 0.1, b: L + NU + 0.1, y: couvertine, force: 0.75, long: 1.1, bouts: false })
  }
  for (const b of F.pierre) {
    const [x0, x1, z0, z1] = [b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2]
    const [bas, dessus] = [b.y - b.h / 2, b.y + b.h / 2]
    const f = z1 <= 1e-3 ? { face: 0, a: x0, b: x1, saillie: -NU - z0 }
      : z0 >= D - 1e-3 ? { face: 1, a: x0, b: x1, saillie: z1 - D - NU }
        : x1 <= 1e-3 ? { face: 2, a: z0, b: z1, saillie: -NU - x0 }
          : x0 >= W - 1e-3 ? { face: 3, a: z0, b: z1, saillie: x1 - W - NU } : null
    if (f === null || bas >= couvertine - 1e-6) continue
    if (f.saillie > 0.5) {
      // Le portique : l'eau déborde de son arase et descend sa face avant.
      if (dessus < haut - 1) sources.push({ face: f.face, a: f.a, b: f.b, y: dessus, force: 0.55, long: 3.2, bouts: false })
      continue
    }
    // Ni le soubassement (il est au sol), ni les montants d'un chambranle (debout).
    if (bas < 0.5 || b.h > 1.5 || f.saillie < 0.02) continue
    const long = 0.6 + 12 * f.saillie
    sources.push({ face: f.face, a: f.a, b: f.b, y: bas, force: Math.min(1, 0.45 + 5 * f.saillie), long, bouts: f.b - f.a < 2.5 })
  }

  const longueur = [0, 1, 2, 3].map((face) => bruit1(`usure:long:${face}`, 0.35))
  const intensite = [0, 1, 2, 3].map((face) => bruit1(`usure:force:${face}`, 0.22))
  const texel = (face: number, i: number, j: number) => ((face * nv + j) * nu + i) * 4
  const ecrire = (k: number, v: number) => { data[k] = Math.max(data[k], Math.round(Math.min(1, v) * 255)) }
  for (const s of sources) {
    const [i0, i1] = [Math.max(0, Math.ceil((s.a - u0) * ppm - 0.5)), Math.min(nu - 1, Math.floor((s.b - u0) * ppm - 0.5))]
    for (let i = i0; i <= i1; i++) {
      const u = u0 + (i + 0.5) / ppm
      const L = s.long * (0.3 + 0.7 * longueur[s.face](u + s.y * 7.3))
      const bout = s.bouts ? 0.3 + 0.7 * Math.exp(-Math.min(u - s.a, s.b - u) / 0.15) : 1
      const force = s.force * bout * (0.35 + 0.65 * intensite[s.face](u + s.y * 3.1))
      const jHaut = Math.min(nv - 1, Math.floor(s.y * ppm - 0.5))
      for (let j = jHaut; j >= 0; j--) {
        const sous = s.y - (j + 0.5) / ppm
        if (sous > Math.max(L, 0.3)) break
        const k = texel(s.face, i, j)
        if (sous < L) ecrire(k, force * (1 - sous / L) ** 1.3 * Math.min(1, sous / 0.04))
        if (sous < 0.3) ecrire(k + 2, s.force * (1 - sous / 0.3))
      }
    }
  }

  // Les angles : l'eau des deux corniches se rejoint et descend l'arête ; ceux du portique aussi.
  const angles = (face: number) => {
    const L = face < 2 ? W : D
    const a = [{ u: -NU - 0.12, y: haut, force: 1 }, { u: L + NU + 0.12, y: haut, force: 1 }]
    if (face === 1) a.push({ u: 16, y: 8.6, force: 0.6 }, { u: 32, y: 8.6, force: 0.6 })
    return a
  }
  for (let face = 0; face < 4; face++)
    for (const c of angles(face))
      for (let i = 0; i < nu; i++) {
        const du = Math.abs(u0 + (i + 0.5) / ppm - c.u)
        if (du > 1.2) continue
        for (let j = 0; j < nv; j++) {
          const y = (j + 0.5) / ppm
          if (y > c.y) break
          ecrire(texel(face, i, j) + 1, c.force * Math.exp(-du / 0.3) * (0.35 + 0.65 * (y / c.y)))
        }
      }
  for (let k = 3; k < data.length; k += 4) data[k] = 255
  return { nu, nv, data }
}

// ── Le hall : les lignes de passage ──────────────────────────────────────

/**
 * Les lignes où l'on marche dans le hall, en segments [x0, z0, x1, z1] : de
 * l'entrée au pied de l'escalier, dans l'axe, et de l'axe à chaque porte des
 * galeries. Le terrazzo s'y ternit un peu — on l'entretient, on ne l'efface pas.
 */
export function passagesDuHall(plan: Plan): [number, number, number, number][] {
  const niveau = plan.levels.find((l) => l.elevation === 0) ?? plan.levels[0]
  const hall = niveau.rooms.find((r) => r.kind === 'hall')
  const entree = niveau.openings.find((o) => o.kind === 'entrance')
  if (!hall || !entree) return []
  const dans = (x: number, z: number) => x >= hall.x && x <= hall.x + hall.width && z >= hall.z && z <= hall.z + hall.depth
  // Le pied de la volée qui part du sol, dans le hall ; sinon le fond du hall.
  const volee = plan.flights.find((f) => f.bottom === 0 && dans(f.x + f.width / 2, f.z + f.depth / 2))
  const pied = volee
    ? { x: volee.x + volee.width / 2, z: volee.direction === 'north' ? volee.z + volee.depth : volee.direction === 'south' ? volee.z : volee.z + volee.depth / 2 }
    : { x: entree.x, z: hall.z + 1 }
  const segments: [number, number, number, number][] = [[entree.x, entree.z, entree.x, pied.z]]
  for (const o of niveau.openings)
    if (o.kind === 'door' && (o.a === hall.id || o.b === hall.id)) segments.push([o.x, o.z, entree.x, o.z])
  return segments
}

// ── Le parc : où l'on marche, où la mousse prend ─────────────────────────

/** Un texel de la carte des allées, en mètres. */
export const TEXEL_PASSAGE = 1 / 3

export interface CarteDesPassages {
  nx: number
  nz: number
  /** RG, 8 bits : R le piétinement (le milieu des allées), G la mousse (les bords, l'ombre du musée). */
  data: Uint8Array
}

const smooth = (x: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function distanceAuSegment(s: Allee, x: number, z: number): number {
  const [dx, dz] = [s.b.x - s.a.x, s.b.z - s.a.z]
  const l2 = dx * dx + dz * dz
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - s.a.x) * dx + (z - s.a.z) * dz) / l2))
  return Math.hypot(x - s.a.x - t * dx, z - s.a.z - t * dz)
}

/**
 * Le sol du parc vu du ciel, sur tout le terrain : l'usure au milieu de chaque
 * allée (et de l'axe dallé jusque sous le portique), la mousse sur les bords
 * qu'on ne foule pas, plus drue au nord du musée, dans son ombre, et au pied de
 * ses murs.
 */
export function carteDesPassages(parc: Parc, plan: Plan): CarteDesPassages {
  const { terrain, parvis } = parc
  const [nx, nz] = [Math.round(terrain.width / TEXEL_PASSAGE), Math.round(terrain.depth / TEXEL_PASSAGE)]
  const data = new Uint8Array(nx * nz * 2)
  const { reseau } = champDesAllees(parc)
  // L'axe dallé continue sur le parvis jusqu'au seuil : c'est là qu'on marche le plus.
  const axe = parc.allees.find((a) => a.sol === 'dalles')
  const allees = axe ? [...parc.allees, { ...axe, a: { x: axe.a.x, z: plan.depth + 0.5 }, b: axe.a }] : parc.allees
  const CASE = 4
  const cases = new Map<number, Allee[]>()
  const cle = (i: number, j: number) => (i + 500) * 1000 + (j + 500)
  for (const s of allees) {
    const m = s.largeur / 2 + 1
    for (let i = Math.floor((Math.min(s.a.x, s.b.x) - m) / CASE); i <= Math.floor((Math.max(s.a.x, s.b.x) + m) / CASE); i++)
      for (let j = Math.floor((Math.min(s.a.z, s.b.z) - m) / CASE); j <= Math.floor((Math.max(s.a.z, s.b.z) + m) / CASE); j++)
        cases.set(cle(i, j), [...(cases.get(cle(i, j)) ?? []), s])
  }
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const [x, z] = [terrain.x + (i + 0.5) * TEXEL_PASSAGE, terrain.z + (j + 0.5) * TEXEL_PASSAGE]
      const s = reseau(x, z)
      if (s > 0.3) continue
      let pas = 0
      for (const a of cases.get(cle(Math.floor(x / CASE), Math.floor(z / CASE))) ?? []) {
        const demi = a.largeur / 2
        const p = (a.sol === 'dalles' ? 1 : 0.85) * (1 - smooth(distanceAuSegment(a, x, z), 0.08 * demi + 0.05, 0.32 * demi + 0.15))
        pas = Math.max(pas, p)
      }
      // L'ombre du musée (son côté nord) et le pied de ses murs, qui boit l'eau de pluie.
      const [dx, dz] = [Math.max(-x, x - plan.width, 0), Math.max(-z, z - plan.depth, 0)]
      const pied = 1 - smooth(Math.hypot(dx, dz), 0.5, 2)
      const nord = z < 0 && x > parvis.x && x < parvis.x + parvis.width ? 1 - smooth(-z, 4, 10) : 0
      const bord = smooth(s, -0.7, 0)
      const mousse = (1 - pas) * Math.min(1, 0.2 + 0.6 * bord + 0.45 * nord + 0.35 * pied)
      data[(j * nx + i) * 2] = Math.round(pas * 255)
      data[(j * nx + i) * 2 + 1] = Math.round(mousse * 255)
    }
  return { nx, nz, data }
}
