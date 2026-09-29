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
 * Dans chaque galerie qui accroche serré — plus de six dixièmes de sa capacité
 * murale, à l'accrochage de juillet 2026 : Trading & finance, la galerie du nord,
 * Librairies .NET, Parsers & langages et Simulation. Une seule ligne de sept
 * modules par salle : deux toiles par face, 90 cm de panneau nu à chaque bout.
 * Elle se tient à plus de 3 m de chaque mur — on recule devant une toile du mur
 * comme devant une toile du panneau —, à plus de 2 m des portes et de la
 * banquette, et hors des lignes de porte à porte et de porte au centre, où
 * mènent la visite et Bavette. Il n'y a donc qu'une place par forme de salle :
 * dans la bande que ne traverse aucune ligne, parallèle au plus long côté libre.
 *
 * Une ligne plus longue n'y gagnerait rien : 3 m de chaque mur laissent 9 m au
 * plus dans une salle de 16, deux toiles par face encore. Là où il faut plus de
 * mur, une seconde ligne perpendiculaire s'appuie sur la première et forme une
 * équerre (`faces` raccourcit la face qu'elle touche et marque l'angle rentrant,
 * où l'on garde `MARGE_ANGLE` de panneau nu) : Trading & finance.
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
 * Une ligne de sept modules par galerie chargée :
 * - Trading & finance (16 × 13, deux portes, à l'ouest et au sud) : d'ouest en
 *   est, dans la bande nord qu'aucune ligne ne traverse, la face sud le long du
 *   chemin ; la banquette au sud la regarde. La galerie du nord, en dessous de
 *   la salle d'honneur, a cédé la sienne aux ateliers en coupe (ateliers.ts) ;
 * - Librairies .NET et Parsers & langages (16 × 14, trois portes qui se croisent
 *   sur l'axe x = 8) : du nord au sud, dans la moitié ouest, la face est tournée
 *   vers la porte du hall ;
 * - Simulation (16 × 13, portes au nord et à l'est) : d'ouest en est, dans la
 *   bande sud, face nord tournée vers le centre.
 */
const ligne = (niveau: number, salle: string, x: number, z: number, axe: 'x' | 'z', modules = 7): Cimaise => ({ niveau, salle, x, z, axe, modules })

/**
 * Trading & finance, la salle la plus chargée (plus de toiles que ses murs n'en
 * portent) : une équerre. La ligne du nord passe à huit modules (3,3 m du mur
 * est), et une branche de quatre modules descend de son bout est vers le sud, le
 * long du mur est, dans le quart que ne traverse aucune ligne (la porte sud et
 * le centre sont sur x = 40). Deux faces de plus : six places au lieu de quatre.
 * La branche s'appuie sur la face sud de la ligne, sa face est dans le
 * prolongement du bout de la ligne : un angle vif dehors, un angle rentrant dedans.
 */
const EQUERRE_E1 = { x: 40.5, z: 4.2, ligne: 8, branche: 4 }
const BOUT_EST = EQUERRE_E1.x + EQUERRE_E1.ligne / 2

export const CIMAISES: Cimaise[] = [
  ligne(0, 'r-e1', EQUERRE_E1.x, EQUERRE_E1.z, 'x', EQUERRE_E1.ligne),
  ligne(0, 'r-e1', BOUT_EST - MODULE.epaisseur / 2, EQUERRE_E1.z + MODULE.epaisseur / 2 + EQUERRE_E1.branche / 2, 'z', EQUERRE_E1.branche),
  ligne(0, 'r-o2', 5, 20, 'z'),
  ligne(1, 'e-o2', 5, 20, 'z'),
  ligne(1, 'e-o3', 8, 35.9, 'x'),
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
  /** Le bout `a`, le bout `b` finit-il dans un angle rentrant (une autre ligne perpendiculaire) ? */
  angles: [boolean, boolean]
}

/**
 * Le panneau nu laissé dans un angle rentrant, avant l'écart minimal d'une
 * toile : le cartel (46 cm, cadre compris 52) y tient avec 18 cm d'air avant
 * l'autre branche.
 */
export const MARGE_ANGLE = 0.7

const EPS = 1e-6

/**
 * Les deux faces d'une ligne. Une ligne perpendiculaire de la même salle qui
 * s'appuie sur une face la raccourcit jusqu'à elle ; celle sur laquelle la
 * ligne s'appuie fait un angle rentrant au bout de la face qui la regarde.
 */
export function faces(c: Cimaise, autres: Cimaise[] = cimaisesDe(c.niveau, c.salle)): Face[] {
  const demi = longueur(c) / 2
  const e = MODULE.epaisseur / 2
  // Dans le repère de la ligne : `u` le long, `v` en travers.
  const repere = (x: number, z: number) => (c.axe === 'x' ? [x - c.x, z - c.z] : [z - c.z, x - c.x])
  const perpendiculaires = autres.filter((d) => d !== c && d.axe !== c.axe).map((d) => {
    const dl = longueur(d) / 2
    const [u0, v0] = repere(d.axe === 'x' ? d.x - dl : d.x - e, d.axe === 'x' ? d.z - e : d.z - dl)
    const [u1, v1] = repere(d.axe === 'x' ? d.x + dl : d.x + e, d.axe === 'x' ? d.z + e : d.z + dl)
    return { u0: Math.min(u0, u1), u1: Math.max(u0, u1), v0: Math.min(v0, v1), v1: Math.max(v0, v1) }
  })
  return [1, -1].map((s) => {
    const v = s * e
    let [ua, ub] = [-demi, demi]
    const angles: [boolean, boolean] = [false, false]
    for (const d of perpendiculaires) {
      if (v < d.v0 - EPS || v > d.v1 + EPS) continue
      if (d.u0 < ub - EPS && d.u1 > ua + EPS) {
        // Elle s'appuie sur cette face : la face s'arrête contre elle, du côté du bout le plus proche.
        if (d.u0 + d.u1 > 0) [ub, angles[1]] = [d.u0, true]
        else [ua, angles[0]] = [d.u1, true]
      } else if (v > d.v0 + EPS && v < d.v1 - EPS) {
        // Cette ligne s'appuie sur elle : le bout qui la touche est dans l'angle.
        if (Math.abs(d.u1 - ua) < 1e-3) angles[0] = true
        if (Math.abs(d.u0 - ub) < 1e-3) angles[1] = true
      }
    }
    const point = (u: number) => (c.axe === 'x' ? { x: c.x + u, z: c.z + v } : { x: c.x + v, z: c.z + u })
    return { a: point(ua), b: point(ub), normal: c.axe === 'x' ? { x: 0, z: s } : { x: s, z: 0 }, angles }
  })
}

/** La longueur d'une face. */
export const longueurDeFace = (f: Face): number => Math.hypot(f.b.x - f.a.x, f.b.z - f.a.z)

/** Le panneau nu laissé à chaque bout d'une face : `MARGE_BOUT`, ou `MARGE_ANGLE` dans un angle. */
export const margesDeFace = (f: Face): [number, number] => [f.angles[0] ? MARGE_ANGLE : MARGE_BOUT, f.angles[1] ? MARGE_ANGLE : MARGE_BOUT]

/** La cimaise dont (x, z) est sur une face, s'il y en a une. */
export const cimaiseSous = (niveau: number, salle: string, x: number, z: number): Cimaise | undefined =>
  cimaisesDe(niveau, salle).find((c) => {
    const [u, v] = c.axe === 'x' ? [x - c.x, z - c.z] : [z - c.z, x - c.x]
    return Math.abs(u) <= longueur(c) / 2 && Math.abs(Math.abs(v) - MODULE.epaisseur / 2) < 1e-3
  })

/** Ce qu'une face accroche au pas de `pas` mètres, ses bouts laissés libres. */
export const placesDeFace = (f: Face, pas: number): number => {
  const [ma, mb] = margesDeFace(f)
  return Math.max(0, Math.floor((longueurDeFace(f) - ma - mb) / pas + 1e-9))
}

/** Ce qu'accrochent toutes les faces des cimaises d'une salle, au pas de `pas` mètres. */
export const placesDesCimaises = (niveau: number, salle: string, pas: number): number =>
  cimaisesDe(niveau, salle).reduce((s, c) => s + faces(c).reduce((t, f) => t + placesDeFace(f, pas), 0), 0)

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
