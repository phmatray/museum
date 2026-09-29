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
import { EXT, INT } from './svg.ts'
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
/** La hauteur des portes vitrées de l'entrée, sous le linteau de 2,40 m. */
const PORTE_H = 2.38

/**
 * La baie du milieu est celle de l'entrée : plus large que l'ouverture du mur
 * (3,20 m) et 30 cm de jeu de chaque côté, sinon les piliers se dressent dans
 * l'embrasure. Les quatre autres se partagent le reste.
 */
const BAIE_ENTREE = 3.2 + 2 * 0.3
const baies = (): [number, number][] => {
  const [a, b] = [P.x0 + JAMBAGE, P.x1 - JAMBAGE]
  const l = (b - a - PILIERS * PILIER - BAIE_ENTREE) / PILIERS
  const largeurs = [l, l, BAIE_ENTREE, l, l]
  const out: [number, number][] = []
  let x = a
  for (const w of largeurs) {
    out.push([x, x + w])
    x += w + PILIER
  }
  return out
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

/** L'entrée du plan (`musee.ts` : x 24, z 40, 3,20 m) ; un test vérifie qu'elle n'a pas bougé. */
export const ENTREE = { x: 24, z: 40, width: 3.2 }
/** Les deux battants ouverts : sur leur montant côté mur (x), de la face intérieure du mur (z1) vers le hall (z0). */
const BATTANTS = [ENTREE.x - ENTREE.width / 2 + 0.06, ENTREE.x + ENTREE.width / 2 - 0.06].map((x) => {
  // Les paumelles sont sur la face INTÉRIEURE du mur (−INT), pas l'extérieure
  // (−EXT) : décalés de 0,30 m, les battants flottaient dans le hall, sans
  // attache (signalé par Philippe).
  const z1 = ENTREE.z - INT
  return { x, z0: z1 - (ENTREE.width / 2 - 0.05), z1 }
})
export const OBSTACLES_PORTES_ENTREE: Rect[] = BATTANTS.map((b) => ({ x: b.x - 0.05, z: b.z0, width: 0.1, depth: b.z1 - b.z0 }))

/**
 * Le nom d'un dépôt en lignes courtes, pour le titre d'une bannière : coupé
 * aux tirets et aux majuscules (`TaLibStandard` → `TaLib` / `Standard`), des
 * lignes d'au plus `max` signes. Sur une seule ligne, un nom de treize lettres
 * tombait à 38 cm de corps : illisible depuis le jardin.
 */
export function lignesDeBanniere(nom: string, max = 9): string[] {
  const mots = nom.match(/[^A-Z_-]*(?:[A-Z]+(?![a-z])|[A-Z][^A-Z_-]*)?[_-]?/g)?.filter(Boolean) ?? [nom]
  const lignes: string[] = []
  for (const m of mots) {
    const l = lignes.length - 1
    if (l >= 0 && lignes[l].length + m.length <= max) lignes[l] += m
    else lignes.push(m)
  }
  return lignes
}

export interface Facade {
  /** Le parement de brique des murs de façade et le parapet. */
  brique: Box[]
  /** Jambages, linteau, bandeau et couvertines. */
  pierre: Box[]
  /** Les piliers cannelés. */
  piliers: Box[]
  /** Le verre sombre des baies du portique. */
  vitres: Box[]
  /** Le verre clair des portes de l'entrée. */
  portes: Box[]
  /** Montants et traverses de métal. */
  menuiseries: Box[]
  /** Où poser le nom du musée : le centre de la face avant du linteau du portique. */
  enseigne: { x: number; y: number; z: number }
  /** Les deux bannières, de part et d'autre du portique. */
  bannieres: { x: number; y: number; z: number; w: number; h: number }[]
  /** Les mâts des drapeaux, sur le toit, au pied de chaque mât. */
  mats: { x: number; y: number; z: number }[]
}

/** Le soubassement de pierre, sa saillie ; la corniche sous le parapet ; le bandeau au droit du plancher. */
const SOCLE = { h: 0.7, saillie: 0.16 }
const CORNICHE = { h: 0.38, saillie: 0.22 }
const BANDEAU_ETAGE = { saillie: 0.06 }
/** Les pilastres de brique, au droit des murs de refend, et aux angles. */
const PILASTRE = { l: 0.9, saillie: 0.12 }
/** Une fenêtre aveugle : baie de pierre de 1,4 × 2,4 m, chambranle de 15 cm, appui saillant. */
const AVEUGLE = { l: 1.4, h: 2.4, cadre: 0.15, saillie: 0.05, allege: 1.3 }

/**
 * La modénature des façades : ce qui fait d'une boîte de brique un bâtiment.
 * Un soubassement de pierre et une corniche sur TOUT le pourtour, un bandeau
 * au droit du plancher de l'étage, des pilastres aux angles et au droit des
 * murs de refend, et, entre eux, sur les trois façades sans portique, des
 * fenêtres aveugles à chambranle de pierre — des galeries n'ont pas de
 * fenêtres, un palais de musée en dessine quand même. Côtés, fond : c'étaient
 * trois murs nus, le portique s'arrêtant net à l'angle.
 *
 * Tout va dans les boîtes de brique et de pierre de la façade : pas un appel
 * de dessin de plus.
 */
function modenature(plan: Plan, haut: number, out: Facade): void {
  const [W, D] = [plan.width, plan.depth]
  const f = EXT + PEAU
  // Chaque façade : son axe (le long de x ou de z), sa cote, le sens du dehors, ses refends.
  const refendsX = [...new Set(plan.levels[0].rooms.flatMap((r) => [r.x, r.x + r.width]))].filter((x) => x > 0 && x < W)
  const refendsZ = [...new Set(plan.levels[0].rooms.filter((r) => r.x === 0).flatMap((r) => [r.z, r.z + r.depth]))].filter((z) => z > 0 && z < D)
  const faces = [
    { long: 'x', cote: -f, dehors: -1, refends: refendsX, sud: false },
    { long: 'x', cote: D + f, dehors: 1, refends: refendsX, sud: true },
    { long: 'z', cote: -f, dehors: -1, refends: refendsZ, sud: false },
    { long: 'z', cote: W + f, dehors: 1, refends: refendsZ, sud: false },
  ] as const
  const niveaux = plan.levels.map((l) => l.elevation)
  for (const face of faces) {
    const L = face.long === 'x' ? W : D
    /** Une boîte posée contre la façade : `a`–`b` le long du mur, `y0`–`y1`, de la face jusqu'à `saillie`. */
    const contre = (a: number, b: number, y0: number, y1: number, saillie: number): Box => {
      const [p, q] = face.dehors > 0 ? [face.cote, face.cote + saillie] : [face.cote - saillie, face.cote]
      return face.long === 'x' ? pave(a, b, y0, y1, p, q) : pave(p, q, y0, y1, a, b)
    }
    // Au sud, le portique occupe le milieu : le socle et le bandeau s'arrêtent à ses jambages.
    const pleins: [number, number][] = face.sud ? [[-f, P.x0], [P.x1, L + f]] : [[-f, L + f]]
    // Aux angles, les façades nord et sud prennent le retour : les boîtes des deux
    // autres s'arrêtent à la brique, sans face commune qui scintillerait.
    const retour = (s: number) => (face.long === 'x' ? s : 0)
    for (const [a, b] of pleins) {
      out.pierre.push(contre(a - retour(SOCLE.saillie), b + retour(SOCLE.saillie), 0, SOCLE.h, SOCLE.saillie))
      for (const e of niveaux.filter((e) => e > 0)) out.pierre.push(contre(a, b, e - plan.slab, e, BANDEAU_ETAGE.saillie))
    }
    out.pierre.push(contre(-f - retour(CORNICHE.saillie), L + f + retour(CORNICHE.saillie), haut - CORNICHE.h, haut, CORNICHE.saillie))
    // Les pilastres : aux deux angles, et au droit des refends (sauf derrière le portique).
    const r = retour(PILASTRE.saillie)
    const axes: [number, number][] = [[-f - r, -f + PILASTRE.l], [L + f - PILASTRE.l, L + f + r],
      ...face.refends.filter((u) => !face.sud || u < P.x0 || u > P.x1).map((u): [number, number] => [u - PILASTRE.l / 2, u + PILASTRE.l / 2])]
    for (const [a, b] of axes) out.brique.push(contre(a, b, SOCLE.h, haut - CORNICHE.h, PILASTRE.saillie))
    if (face.sud) continue
    // Les fenêtres aveugles : trois par travée et par niveau, entre les pilastres.
    const bornes = [0, ...face.refends, L]
    for (let t = 0; t + 1 < bornes.length; t++) {
      const [u0, u1] = [bornes[t] + PILASTRE.l, bornes[t + 1] - PILASTRE.l]
      for (let k = 0; k < 3; k++) {
        const c = u0 + ((k + 0.5) * (u1 - u0)) / 3
        const [a, b] = [c - AVEUGLE.l / 2, c + AVEUGLE.l / 2]
        for (const e of niveaux) {
          const [y0, y1] = [e + AVEUGLE.allege, e + AVEUGLE.allege + AVEUGLE.h]
          const k2 = AVEUGLE.cadre
          out.pierre.push(
            contre(a - k2, a, y0, y1, AVEUGLE.saillie),
            contre(b, b + k2, y0, y1, AVEUGLE.saillie),
            contre(a - k2, b + k2, y1, y1 + k2 * 1.4, AVEUGLE.saillie + 0.02),
            // L'appui, plus saillant que le chambranle : il porte la pluie loin du mur.
            contre(a - k2 - 0.08, b + k2 + 0.08, y0 - 0.12, y0, AVEUGLE.saillie + 0.07),
          )
        }
      }
    }
  }
}

export function facade(plan: Plan): Facade {
  const [W, D] = [plan.width, plan.depth]
  const haut = plan.levels.length * plan.storey - plan.slab
  const out: Facade = { brique: [], pierre: [], piliers: [], vitres: [], portes: [], menuiseries: [], enseigne: { x: 0, y: 0, z: 0 }, bannieres: [], mats: [] }

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

  modenature(plan, haut, out)

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

  // Sur la face avant du linteau de pierre, pas sur la brique au-dessus : le
  // linteau avance de 1,35 m et cachait les lettres dès qu'on approchait, et du
  // bronze sur la brique sombre ne se lisait pas.
  // Les portes de l'entrée : deux battants vitrés à cadre de bronze, grands ouverts
  // vers le hall, rabattus à 90°. Un musée sans porte n'existe pas (remarque de
  // Philippe). Verre clair (`portes`), trois paumelles de bronze par battant côté
  // mur ; les battants sont des obstacles (`OBSTACLES_PORTES_ENTREE`) : on ne les
  // traverse plus, ni le visiteur ni Bavette.
  for (const b of BATTANTS) {
    const [a0, a1, zo, zf] = [b.x - 0.025, b.x + 0.025, b.z0, b.z1]
    out.portes.push(pave(a0 + 0.012, a1 - 0.012, 0.18, PORTE_H - 0.1, zo + 0.06, zf - 0.06, 'glass'))
    out.menuiseries.push(
      pave(a0, a1, 0, PORTE_H, zf - 0.06, zf),
      pave(a0, a1, 0, PORTE_H, zo, zo + 0.06),
      pave(a0, a1, PORTE_H - 0.1, PORTE_H, zo, zf),
      pave(a0, a1, 0, 0.18, zo, zf),
      // La barre de tirage, sur les deux faces.
      pave(a0 - 0.05, a0 - 0.02, 0.9, 1.9, zo + 0.1, zo + 0.13),
      pave(a1 + 0.02, a1 + 0.05, 0.9, 1.9, zo + 0.1, zo + 0.13),
    )
    // Les paumelles : trois nœuds de bronze sur le montant côté mur.
    for (const y of [0.3, 1.2, 2.1]) out.menuiseries.push(pave(a0 - 0.01, a1 + 0.01, y, y + 0.12, zf - 0.02, zf + 0.02))
  }
  // Le seuil de pierre, dans l'épaisseur du mur.
  out.pierre.push(pave(ENTREE.x - ENTREE.width / 2, ENTREE.x + ENTREE.width / 2, 0, 0.02, ENTREE.z - EXT, ENTREE.z + EXT))

  out.enseigne = { x: (P.x0 + P.x1) / 2, y: P.haut - LINTEAU / 2, z: P.facade + P.saillie + 0.01 }
  out.bannieres = [P.x0 - 4.5, P.x1 + 4.5].map((x) => ({ x, y: 5.2, z: D + EXT + PEAU + 0.12, w: 3, h: 7 }))
  out.mats = [6, 12, 36, 42].map((x) => ({ x, y: haut, z: D - 1.5 }))
  return out
}
