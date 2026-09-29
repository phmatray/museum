/**
 * Les cimaises modulables : des panneaux d'exposition autoportants, à la
 * manière du système Novo (promuseum.eu), posés au milieu des galeries les plus
 * chargées pour leur donner du mur sans leur retirer d'espace.
 *
 * ── Le système ──
 *
 * Des modules de 1 m de large, 2,50 m de haut, 40 mm d'épaisseur : une âme
 * alvéolaire sous un stratifié blanc mat, sans démarcation. Les modules
 * s'emboîtent par des jonctions d'aluminium, un profilé fin visible à chaque
 * joint et à chaque bout, et reposent sur des pieds d'aluminium posés en
 * travers, derrière une plinthe en retrait. Chaque face est un mur : on y
 * accroche comme ailleurs (`hang.ts`), avec les mêmes écarts et un cartel par
 * toile, et le projecteur de chaque toile vise sa face (`projecteurs.ts`).
 *
 * ── Où ──
 *
 * Seulement dans les galeries de 16 × 13 ou 14 m qui accrochaient le plus serré,
 * et jamais dans un passage : deux panneaux parallèles de 4 m par salle, à plus
 * de 2 m des murs, hors des lignes de porte à porte et de porte au centre (où
 * mènent la visite et Bavette), la banquette entre les deux. De la porte, on les
 * voit par la tranche, et le mur du fond reste lisible entre eux.
 *
 * Le plan reste la seule source : les emprises sont des obstacles du niveau
 * (`musee.ts`) que `step()` arrête et que les chemins contournent (`mobilier.ts`).
 *
 * Pur : ni three ni React.
 */
import type { Box } from './mesh.ts'
import type { Plan, Rect } from './types.ts'

/** Un module Novo : 100 × 250 cm, 40 mm. */
export const MODULE = { largeur: 1, hauteur: 2.5, epaisseur: 0.04 }
/** Le profilé d'aluminium d'une jonction : 3 cm de face, un rien plus saillant que le panneau. */
const JONCTION = { largeur: 0.03, saillie: 0.006 }
/** Le jour sous le panneau, que ferme une plinthe en retrait, et les pieds posés en travers. */
const PIED = { hauteur: 0.05, longueur: 0.36, largeur: 0.05 }
const RETRAIT_PLINTHE = 0.008
/**
 * La marge laissée au bout d'une face, avant l'écart minimal d'une toile : 30 cm,
 * soit 90 cm de panneau nu à côté du cadre — le cartel (46 cm) y tient.
 */
export const MARGE_BOUT = 0.3

/** Une ligne droite de modules, centrée en (x, z). */
export interface Cimaise {
  niveau: number
  salle: string
  x: number
  z: number
  /** `x` : la ligne court d'ouest en est, ses faces regardent le nord et le sud ; `z` : l'inverse. */
  axe: 'x' | 'z'
  modules: number
}

/**
 * Deux panneaux parallèles de quatre modules, symétriques autour de l'axe de la
 * banquette, dans la moitié de la salle que ne traverse aucune porte :
 * - Librairies .NET et Parsers & langages (16 × 14, trois portes), la moitié ouest,
 *   de part et d'autre de la banquette ; la porte du hall regarde entre eux ;
 * - Trading & finance (16 × 13, pleine à craquer), la moitié est : de la porte
 *   ouest, on regarde le mur du fond entre les deux.
 */
const paire = (niveau: number, salle: string, x: number, axe: number, ecart: number): Cimaise[] =>
  [axe - ecart / 2, axe + ecart / 2].map((z) => ({ niveau, salle, x, z, axe: 'x', modules: 4 }))

export const CIMAISES: Cimaise[] = [
  ...paire(0, 'r-o2', 4.2, 20, 5.2),
  ...paire(1, 'e-o2', 4.2, 20, 5.2),
  ...paire(0, 'r-e1', 43.8, 6.5, 6.4),
]

const longueur = (c: Cimaise) => c.modules * MODULE.largeur

/** L'emprise au sol : les modules, les profilés des bouts et les pieds en travers. */
export function emprise(c: Cimaise): Rect {
  const [l, e] = [longueur(c) + JONCTION.largeur, PIED.longueur]
  return c.axe === 'x' ? { x: c.x - l / 2, z: c.z - e / 2, width: l, depth: e } : { x: c.x - e / 2, z: c.z - l / 2, width: e, depth: l }
}

export const cimaisesDe = (niveau: number, salle?: string): Cimaise[] =>
  CIMAISES.filter((c) => c.niveau === niveau && (salle === undefined || c.salle === salle))

/** Les emprises d'un niveau, comme obstacles de la marche. */
export const obstaclesDesCimaises = (niveau: number): Rect[] => cimaisesDe(niveau).map(emprise)

/** Une face accrochable : de `a` à `b`, sur le parement, sa normale vers le visiteur. */
export interface Face {
  a: { x: number; z: number }
  b: { x: number; z: number }
  normal: { x: number; z: number }
}

/** Les deux faces d'une ligne, sur toute sa longueur de panneau. */
export function faces(c: Cimaise): Face[] {
  const demi = longueur(c) / 2
  return [1, -1].map((s) => {
    const off = (s * MODULE.epaisseur) / 2
    return c.axe === 'x'
      ? { a: { x: c.x - demi, z: c.z + off }, b: { x: c.x + demi, z: c.z + off }, normal: { x: 0, z: s } }
      : { a: { x: c.x + off, z: c.z - demi }, b: { x: c.x + off, z: c.z + demi }, normal: { x: s, z: 0 } }
  })
}

/** La cimaise dont (x, z) est sur une face, s'il y en a une. */
export const cimaiseSous = (niveau: number, salle: string, x: number, z: number): Cimaise | undefined =>
  cimaisesDe(niveau, salle).find((c) => {
    const [u, v] = c.axe === 'x' ? [x - c.x, z - c.z] : [z - c.z, x - c.x]
    return Math.abs(u) <= longueur(c) / 2 && Math.abs(Math.abs(v) - MODULE.epaisseur / 2) < 1e-3
  })

/** Ce qu'une face accroche au pas de `pas` mètres, ses bouts laissés libres. */
export const placesDeFace = (c: Cimaise, pas: number): number => Math.max(0, Math.floor((longueur(c) - 2 * MARGE_BOUT) / pas))

/** Les boîtes d'un niveau : le stratifié des modules, et l'aluminium des jonctions, de la plinthe et des pieds. */
export function boitesDesCimaises(plan: Plan, niveau: number): { panneaux: Box[]; alu: Box[] } {
  const y0 = plan.levels.find((l) => l.id === niveau)?.elevation ?? 0
  const panneaux: Box[] = []
  const alu: Box[] = []
  // Une boîte le long de la ligne : `u` le long, `v` en travers, en coordonnées de la ligne.
  const boite = (c: Cimaise, u: number, y: number, long: number, h: number, travers: number): Box =>
    c.axe === 'x'
      ? { x: c.x + u, y: y0 + y, z: c.z, w: long, h, d: travers, kind: 'wall' }
      : { x: c.x, y: y0 + y, z: c.z + u, w: travers, h, d: long, kind: 'wall' }
  const haut = MODULE.hauteur - PIED.hauteur
  for (const c of cimaisesDe(niveau)) {
    const demi = longueur(c) / 2
    for (let i = 0; i < c.modules; i++)
      panneaux.push(boite(c, -demi + (i + 0.5) * MODULE.largeur, PIED.hauteur + haut / 2, MODULE.largeur - JONCTION.largeur, haut, MODULE.epaisseur))
    for (let i = 0; i <= c.modules; i++) {
      const u = -demi + i * MODULE.largeur
      alu.push(boite(c, u, PIED.hauteur + haut / 2, JONCTION.largeur, haut, MODULE.epaisseur + 2 * JONCTION.saillie))
      alu.push(boite(c, u, PIED.hauteur / 2, PIED.largeur, PIED.hauteur, PIED.longueur))
    }
    alu.push(boite(c, 0, PIED.hauteur / 2, longueur(c), PIED.hauteur, MODULE.epaisseur - 2 * RETRAIT_PLINTHE))
  }
  return { panneaux, alu }
}
