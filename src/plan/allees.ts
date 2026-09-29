/**
 * Les ALLÉES dessinées comme celles d'un vrai jardin : « ce type de chemin en
 * angle droit fait trop jeu vidéo, ce n'est pas réaliste » (Philippe).
 *
 * `park.ts` trace les axes des allées ; ici, on en fait un SOL : un champ de
 * distance signée (négatif sur le sol dur) où chaque jonction est une union
 * ARRONDIE — un congé circulaire de 2 à 3,5 m au lieu d'un coin vif —, puis
 * une grille de 50 cm dont on tire, par « marching squares », les surfaces à
 * paver et la ligne exacte du bord. Sur ce bord : une bordure de pierre à
 * l'arête arrondie, un lit de galets sombres entre elle et la pelouse. Près de
 * l'eau, des dalles irrégulières dans le gravier et des piquets de bois reliés
 * d'une corde ; aux courbes, des touffes d'herbe du Japon et de l'herbe aux
 * turquoises (ophiopogon), le couvre-sol sombre des jardins de Kyoto.
 *
 * Tout est pur et déterministe : `ParkLayer` ne fait que draper sur le relief.
 */
import { TABLIER, distanceEtang, distanceRuisseau, JARDIN } from './jardin.ts'
import { MOBILIER, emprise } from './mobilier.ts'
import { distanceRect, generateur, type Allee, type Parc } from './park.ts'
import type { Rect } from './types.ts'

/** Le pas de la grille, en mètres : assez fin pour qu'un congé de 2 m se lise rond. */
export const PAS_ALLEES = 0.5
/**
 * Les congés : entre deux allées de gravier, de l'axe à la ceinture, de l'axe
 * au parvis (l'entrée s'évase). Les deux derniers se partagent les 4,50 m de
 * gazon entre le parvis et la ceinture : plus larges, leurs arcs se coupaient
 * en pointe.
 */
const CONGE = 3
const CONGE_AXE = 2.2
const CONGE_PARVIS = 2.2
/** Au-delà, le champ est plafonné : plus loin que le plus grand congé, il ne sert plus à rien. */
const PLAFOND = 6
/** La bordure : sa face intérieure mord le sol de l'allée, l'extérieure tient le gazon. */
export const BORDURE = { dedans: -0.04, dehors: 0.11 }
/** Le lit de galets, au-delà de la bordure. */
export const GALETS = 0.32
/** Le gravier file sous la bordure de tant au-delà de son axe, et sous les dalles de tant en deçà de leur bord. */
const BORE = 0.03
const SOUS_DALLES = 0.5
const SUR_PARVIS = 0.3
/** Le pas de la bordure le long du bord : un congé de 2 m se lit rond, pas en facettes de 50 cm. */
const PAS_BORDURE = 0.2
/** Les piquets et leur corde : à moins de tant de l'eau, un tous les tant. */
const PRES_DE_L_EAU = 4.2
const PAS_POTEAUX = 2.2

export type Point = { x: number; z: number }

/** Union arrondie (hg_sdf `fOpUnionRound`) : deux bords qui se croisent à angle droit se raccordent d'un arc de rayon `r`. */
export function unionArrondie(a: number, b: number, r: number): number {
  return Math.max(r, Math.min(a, b)) - Math.hypot(Math.max(r - a, 0), Math.max(r - b, 0))
}

/**
 * Les allées bout à bout (l'arrivée de l'une est le départ de la suivante, même
 * largeur) : une allée qui serpente, la boucle de ceinture. Chacune est UNE
 * forme : ses tronçons s'unissent sans congé, sinon chaque coude gonflerait.
 */
export function chaines(allees: Allee[]): Allee[][] {
  const out: Allee[][] = []
  for (const a of allees) {
    const c = out[out.length - 1]
    const d = c?.[c.length - 1]
    if (d && d.largeur === a.largeur && d.sol === a.sol && Math.hypot(d.b.x - a.a.x, d.b.z - a.a.z) < 1e-6) c.push(a)
    else out.push([a])
  }
  return out
}

/**
 * La distance signée à un tronçon de largeur `largeur`. Aux coudes d'une
 * allée, le bout est rond (les tronçons se fondent) ; au départ d'une allée
 * (`plat`), il est coupé net : un bout rond, noyé dans l'allée qu'elle
 * rejoint, pinçait le congé de la jonction. L'arrivée reste ronde : au bord du
 * terrain, elle déborde sous la grille, et la bordure ne barre pas le passage.
 */
function distanceSegment(s: Allee, x: number, z: number, plat: boolean): number {
  const [dx, dz] = [s.b.x - s.a.x, s.b.z - s.a.z]
  const l = Math.hypot(dx, dz)
  const w = s.largeur / 2
  if (l < 1e-9) return Math.hypot(x - s.a.x, z - s.a.z) - w
  const [ux, uz] = [dx / l, dz / l]
  const u = (x - s.a.x) * ux + (z - s.a.z) * uz
  const h = Math.abs((x - s.a.x) * uz - (z - s.a.z) * ux) - w
  const bout = u < 0 ? -u : u > l ? u - l : 0
  if (bout === 0) return h
  if (u < 0 && plat) return Math.hypot(bout, Math.max(h, 0)) + Math.min(Math.max(bout, h), 0)
  return Math.hypot(bout, h + w) - w
}

export interface Champ {
  /** Tout le sol dur — allées, parvis, tablier du pont —, négatif dedans. */
  reseau: (x: number, z: number) => number
  /** L'axe dallé fondu dans le parvis : ce qui se pave de pierre. */
  dalles: (x: number, z: number) => number
}

/**
 * Le champ des allées. Chaque allée est un chapelet de capsules ; les allées
 * de gravier s'unissent entre elles d'un congé de `CONGE`, l'axe dallé au
 * parvis de `CONGE_PARVIS`, le tout d'un congé de `CONGE_AXE`. Le tablier se
 * joint sans congé : c'est un ouvrage, pas un chemin.
 */
export function champDesAllees(parc: Pick<Parc, 'allees' | 'parvis'>): Champ {
  const ch = chaines(parc.allees)
  const fermee = (c: Allee[]) => Math.hypot(c[0].a.x - c[c.length - 1].b.x, c[0].a.z - c[c.length - 1].b.z) < 1e-6
  const segs = ch.flatMap((c, k) => c.map((s, i) => ({ s, k, plat: i === 0 && !fermee(c) })))
  // Une grille de cases de 4 m : chaque point ne teste que les tronçons voisins.
  const CASE = 4
  const cases = new Map<number, number[]>()
  const cle = (i: number, j: number) => (i + 500) * 1000 + (j + 500)
  segs.forEach(({ s }, n) => {
    const m = s.largeur / 2 + PLAFOND
    for (let i = Math.floor((Math.min(s.a.x, s.b.x) - m) / CASE); i <= Math.floor((Math.max(s.a.x, s.b.x) + m) / CASE); i++)
      for (let j = Math.floor((Math.min(s.a.z, s.b.z) - m) / CASE); j <= Math.floor((Math.max(s.a.z, s.b.z) + m) / CASE); j++) {
        const l = cases.get(cle(i, j))
        if (l) l.push(n)
        else cases.set(cle(i, j), [n])
      }
  })
  const d = new Float64Array(ch.length)
  const pave = ch.map((c) => c[0].sol === 'dalles')
  const parChaine = (x: number, z: number) => {
    d.fill(PLAFOND)
    for (const n of cases.get(cle(Math.floor(x / CASE), Math.floor(z / CASE))) ?? []) {
      const { s, k, plat } = segs[n]
      const v = distanceSegment(s, x, z, plat)
      if (v < d[k]) d[k] = v
    }
  }
  const dalles = (x: number, z: number, deja = false) => {
    if (!deja) parChaine(x, z)
    let axe = PLAFOND
    for (let k = 0; k < ch.length; k++) if (pave[k]) axe = Math.min(axe, d[k])
    return unionArrondie(axe, distanceRect(parc.parvis, x, z), CONGE_PARVIS)
  }
  return {
    reseau: (x, z) => {
      parChaine(x, z)
      let gravier = PLAFOND
      for (let k = 0; k < ch.length; k++) if (!pave[k]) gravier = unionArrondie(gravier, d[k], CONGE)
      return Math.min(unionArrondie(gravier, dalles(x, z, true), CONGE_AXE), distanceRect(TABLIER, x, z))
    },
    dalles: (x, z) => dalles(x, z),
  }
}

// ── La grille et ses « marching squares » ─────────────────────────────────

export interface Grille {
  x0: number
  z0: number
  nx: number
  nz: number
  v: Float32Array
}

/** Les valeurs de `f` aux nœuds d'une grille de pas `PAS_ALLEES` couvrant `r`. */
export function echantillonner(r: Rect, f: (x: number, z: number) => number): Grille {
  const [nx, nz] = [Math.round(r.width / PAS_ALLEES) + 1, Math.round(r.depth / PAS_ALLEES) + 1]
  const v = new Float32Array(nx * nz)
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = f(r.x + i * PAS_ALLEES, r.z + j * PAS_ALLEES)
  return { x0: r.x, z0: r.z, nx, nz, v }
}

/** Le sommet d'un nœud (3n), ou du passage à zéro sur l'arête qui en part vers +x (3n+1) ou +z (3n+2). */
function sommet(g: Grille, cle: number): Point {
  const [n, sorte] = [Math.floor(cle / 3), cle % 3]
  const [i, j] = [n % g.nx, Math.floor(n / g.nx)]
  const [x, z] = [g.x0 + i * PAS_ALLEES, g.z0 + j * PAS_ALLEES]
  if (sorte === 0) return { x, z }
  const m = sorte === 1 ? n + 1 : n + g.nx
  const t = g.v[n] / (g.v[n] - g.v[m])
  return sorte === 1 ? { x: x + t * PAS_ALLEES, z } : { x, z: z + t * PAS_ALLEES }
}

/** Les quatre coins d'une maille dans l'ordre, et l'arête qui va de chacun au suivant. */
function maille(g: Grille, i: number, j: number): { coins: number[]; aretes: number[] } {
  const n = j * g.nx + i
  const coins = [n, n + 1, n + 1 + g.nx, n + g.nx]
  return { coins, aretes: [3 * n + 1, 3 * (n + 1) + 2, 3 * (n + g.nx) + 1, 3 * n + 2] }
}

export interface Surface {
  /** x, z à plat : le rendu ajoute la cote du relief. */
  xz: number[]
  index: number[]
}

/** La région `v < 0` en triangles, sommets partagés : chaque maille découpée par la ligne du zéro. */
export function remplir(g: Grille): Surface {
  const rang = new Map<number, number>()
  const xz: number[] = []
  const index: number[] = []
  const id = (cle: number) => {
    let k = rang.get(cle)
    if (k === undefined) {
      const p = sommet(g, cle)
      rang.set(cle, (k = xz.length / 2))
      xz.push(p.x, p.z)
    }
    return k
  }
  for (let j = 0; j + 1 < g.nz; j++)
    for (let i = 0; i + 1 < g.nx; i++) {
      const { coins, aretes } = maille(g, i, j)
      if (coins.every((c) => g.v[c] >= 0)) continue
      const poly: number[] = []
      coins.forEach((c, e) => {
        const d = coins[(e + 1) % 4]
        if (g.v[c] < 0) poly.push(id(3 * c))
        if (g.v[c] < 0 !== g.v[d] < 0) poly.push(id(aretes[e]))
      })
      // Vu du ciel (x à l'est, z au sud), le tour de la maille est horaire : on le prend à rebours.
      for (let k = 1; k + 1 < poly.length; k++) index.push(poly[0], poly[k + 1], poly[k])
    }
  return { xz, index }
}

/** La ligne du zéro, en polylignes chaînées ; une boucle se referme sur son premier point. */
export function isolignes(g: Grille): Point[][] {
  const voisins = new Map<number, number[]>()
  const lier = (a: number, b: number) => {
    for (const [p, q] of [[a, b], [b, a]]) {
      const l = voisins.get(p)
      if (l) l.push(q)
      else voisins.set(p, [q])
    }
  }
  for (let j = 0; j + 1 < g.nz; j++)
    for (let i = 0; i + 1 < g.nx; i++) {
      const { coins, aretes } = maille(g, i, j)
      const dedans = coins.map((c) => g.v[c] < 0)
      const coupees = aretes.filter((_, e) => dedans[e] !== dedans[(e + 1) % 4])
      if (coupees.length === 2) lier(coupees[0], coupees[1])
      else if (coupees.length === 4) {
        // Le col : le centre de la maille dit quels coins se rejoignent.
        const centre = coins.reduce((s, c) => s + g.v[c], 0) / 4 < 0
        if (centre === dedans[0]) {
          lier(aretes[0], aretes[1])
          lier(aretes[2], aretes[3])
        } else {
          lier(aretes[3], aretes[0])
          lier(aretes[1], aretes[2])
        }
      }
    }
  const vu = new Set<number>()
  const lignes: Point[][] = []
  const suivre = (depart: number) => {
    const l = [depart]
    vu.add(depart)
    for (let k = depart; ; ) {
      const n = voisins.get(k)!.find((q) => !vu.has(q))
      if (n === undefined) break
      vu.add(n)
      l.push((k = n))
    }
    if (l.length > 2 && voisins.get(l[l.length - 1])!.includes(depart)) l.push(depart)
    lignes.push(l.map((c) => sommet(g, c)))
  }
  // Les lignes ouvertes d'abord (elles butent sur le bord de la grille), puis les boucles.
  for (const [k, l] of voisins) if (l.length === 1 && !vu.has(k)) suivre(k)
  for (const k of voisins.keys()) if (!vu.has(k)) suivre(k)
  return lignes
}

type Champ2D = (x: number, z: number) => number
type PointNormal = Point & { nx: number; nz: number }

function gradient(f: Champ2D, x: number, z: number): [number, number] {
  const e = 0.02
  return [(f(x + e, z) - f(x - e, z)) / (2 * e), (f(x, z + e) - f(x, z - e)) / (2 * e)]
}

/** Ramène un point sur la ligne du zéro, le long de la pente (Newton). */
function surLeZero(f: Champ2D, x: number, z: number): Point {
  for (let k = 0; k < 4; k++) {
    const v = f(x, z)
    if (Math.abs(v) < 1e-4) break
    const [gx, gz] = gradient(f, x, z)
    const g2 = gx * gx + gz * gz
    if (g2 < 1e-6) break
    x -= (v * gx) / g2
    z -= (v * gz) / g2
  }
  return { x, z }
}

/**
 * Une ligne du zéro telle que la bordure la suit : les « marching squares » la
 * tirent en cordes de 50 cm, inégales, que la bordure extrudée rendait en
 * facettes et en coudes. On la reprend tous les `PAS_BORDURE`, chaque point
 * ramené sur le vrai bord ; là où le bord a un angle vif (les coins du
 * parvis, l'intérieur d'un coude), on pose le sommet exact de l'angle, et sa
 * normale en ONGLET (`n·n₁ = n·n₂ = 1`) : la bordure y tourne d'équerre, sans
 * chanfrein ni pierre qui se chevauche.
 */
export function affiner(ligne: Point[], f: Champ2D): PointNormal[] {
  const long = [0]
  for (let i = 1; i < ligne.length; i++) long.push(long[i - 1] + Math.hypot(ligne[i].x - ligne[i - 1].x, ligne[i].z - ligne[i - 1].z))
  const total = long[long.length - 1]
  if (total < 1e-6) return []
  const n = Math.max(1, Math.round(total / PAS_BORDURE))
  const pts: PointNormal[] = []
  for (let i = 0, j = 0; i <= n; i++) {
    const s = (total * i) / n
    while (j + 2 < long.length && long[j + 1] < s) j++
    const t = Math.min(1, (s - long[j]) / (long[j + 1] - long[j] || 1))
    const p = surLeZero(f, ligne[j].x + (ligne[j + 1].x - ligne[j].x) * t, ligne[j].z + (ligne[j + 1].z - ligne[j].z) * t)
    const q = pts[pts.length - 1]
    if (q && Math.hypot(p.x - q.x, p.z - q.z) < 0.02 && i < n) continue
    const [gx, gz] = gradient(f, p.x, p.z)
    const l = Math.hypot(gx, gz) || 1
    pts.push({ ...p, nx: gx / l, nz: gz / l })
  }
  const out: PointNormal[] = []
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i], pts[i + 1]]
    out.push(a)
    if (!b || a.nx * b.nx + a.nz * b.nz > Math.cos(Math.PI / 6)) continue
    // L'angle : l'intersection des deux bords, chacun porté par sa normale.
    const det = a.nx * b.nz - a.nz * b.nx
    if (Math.abs(det) < 1e-3) continue
    const [ca, cb] = [a.nx * a.x + a.nz * a.z, b.nx * b.x + b.nz * b.z]
    const c = { x: (ca * b.nz - cb * a.nz) / det, z: (a.nx * cb - b.nx * ca) / det }
    if (Math.hypot(c.x - a.x, c.z - a.z) > 2 * PAS_BORDURE || Math.hypot(c.x - b.x, c.z - b.z) > 2 * PAS_BORDURE) continue
    const k = 1 + a.nx * b.nx + a.nz * b.nz
    out.push({ ...c, nx: (a.nx + b.nx) / k, nz: (a.nz + b.nz) / k })
  }
  return out
}

// ── L'aménagement ───────────────────────────────────────────────────────────

export interface PointDeBord extends Point {
  /** La normale vers le gazon. */
  nx: number
  nz: number
  /** La part du lit de galets, de 0 (le long des dalles et du parvis) à 1. */
  galets: number
}

export interface Pose extends Point {
  rotation: number
  /** L'échelle : `sx`, `sz` au sol, `sy` en hauteur. */
  sx: number
  sy: number
  sz: number
}

export interface Amenagement {
  gravier: Surface
  dalles: Surface
  bordures: PointDeBord[][]
  /** Les dalles irrégulières posées dans le gravier, près de l'eau. */
  pierres: Pose[]
  poteaux: Point[]
  /** Les travées de corde, d'un poteau (indice) au suivant. */
  cordes: [number, number][]
  touffes: Pose[]
  /** L'ophiopogon : des touffes basses et vert sombre, au pied des autres. */
  couvreSol: Pose[]
}

const smoothstep = (x: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
/**
 * La distance à l'eau, lue au centre de la maille de 50 cm qui contient le
 * point (à 35 cm près) : le contour de l'étang coûte cher à parcourir.
 */
const EAU = new Map<number, number>()
function eau(x: number, z: number): number {
  const [i, j] = [Math.floor(x / PAS_ALLEES), Math.floor(z / PAS_ALLEES)]
  const cle = (i + 1000) * 4000 + j + 1000
  let d = EAU.get(cle)
  if (d === undefined) {
    const [cx, cz] = [(i + 0.5) * PAS_ALLEES, (j + 0.5) * PAS_ALLEES]
    // L'eau est dans le jardin : à 10 m de ses zones, inutile de chercher la berge.
    const loin = Math.min(...JARDIN.zones.map((r) => distanceRect(r, cx, cz))) > 10
    EAU.set(cle, (d = loin ? 10 : Math.min(distanceEtang(cx, cz), distanceRuisseau(cx, cz))))
  }
  return d
}

/** Un index spatial de disques, pour les semis sans chevauchement. */
function semis(cote: number) {
  const cases = new Map<string, { x: number; z: number; r: number }[]>()
  const cle = (i: number, j: number) => `${i}:${j}`
  return {
    libre(x: number, z: number, r: number, jeu = 0): boolean {
      const [i, j] = [Math.floor(x / cote), Math.floor(z / cote)]
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++)
          for (const p of cases.get(cle(i + di, j + dj)) ?? []) if (Math.hypot(p.x - x, p.z - z) < p.r + r + jeu) return false
      return true
    },
    poser(x: number, z: number, r: number) {
      const k = cle(Math.floor(x / cote), Math.floor(z / cote))
      cases.set(k, [...(cases.get(k) ?? []), { x, z, r }])
    },
  }
}

/**
 * Tout ce qui fait d'un tracé une allée : les sols (gravier, dalles de l'axe),
 * la ligne de bordure, et le décor posé autour, sans rien sur un tronc, un
 * rocher, un banc ou dans l'eau.
 */
export function amenagerAllees(parc: Parc): Amenagement {
  const champ = champDesAllees(parc)
  const { terrain, parvis } = parc
  const R = echantillonner(terrain, champ.reseau)
  const D = echantillonner(terrain, champ.dalles)
  const noeud = (k: number): Point => ({ x: terrain.x + (k % R.nx) * PAS_ALLEES, z: terrain.z + Math.floor(k / R.nx) * PAS_ALLEES })
  const T = R.v.map((_, k) => {
    const p = noeud(k)
    return distanceRect(TABLIER, p.x, p.z)
  })
  const P = R.v.map((_, k) => {
    const p = noeud(k)
    return distanceRect(parvis, p.x, p.z)
  })
  // Le gravier file SOUS la bordure (`BORE`) et SOUS le bord des dalles (`SOUS_DALLES`),
  // les dalles posées 1 cm plus haut : deux sols qui se recouvrent au lieu de se
  // partager un bord. Découpés l'un par l'autre, leurs « marching squares »
  // tranchaient chacun le coin à sa façon, et le gazon passait entre les deux.
  const gravier = remplir({ ...R, v: R.v.map((v, k) => Math.max(v - BORE, -D.v[k] - SOUS_DALLES, -T[k], -P[k])) })
  // Les dalles mordent de `SUR_PARVIS` sur le parvis, à sa cote et de sa pierre : coupées
  // pile sur son bord (le zéro tombait sur une rangée de nœuds), le congé s'y
  // tranchait en biais et laissait un coin de gazon.
  const dalles = remplir({ ...R, v: D.v.map((v, k) => Math.max(v, -P[k] - SUR_PARVIS, -T[k])) })

  // La bordure suit tout le bord, sauf le long du pont (le tablier a ses poutres).
  const bordures: PointDeBord[][] = []
  for (const ligne of isolignes(R)) {
    let courante: PointDeBord[] = []
    for (const p of affiner(ligne, champ.reseau)) {
      if (distanceRect(TABLIER, p.x, p.z) < 0.35) {
        if (courante.length > 1) bordures.push(courante)
        courante = []
        continue
      }
      courante.push({ ...p, galets: smoothstep(champ.dalles(p.x, p.z), 0.6, 2.5) })
    }
    if (courante.length > 1) bordures.push(courante)
  }

  // Ce qui occupe déjà le sol : troncs, boules, rochers, bancs, la lanterne, les pas japonais.
  const occupe = semis(2)
  for (const p of parc.plantations) {
    if (p.espece === 'petales' || p.espece === 'fougere') continue
    occupe.poser(p.x, p.z, p.espece.startsWith('erable') ? 0.35 * p.scale : p.rayon * 0.75)
  }
  for (const m of MOBILIER.filter((m) => m.surface === 'parc:terrain')) {
    const r = emprise(m)
    occupe.poser(r.x + r.width / 2, r.z + r.depth / 2, Math.hypot(r.width, r.depth) / 2 + 1.3)
  }
  occupe.poser(JARDIN.lanterne.x, JARDIN.lanterne.z, 0.8)
  for (const [x, z] of JARDIN.pas) occupe.poser(x, z, 0.5)
  const auSol = (x: number, z: number, r: number) =>
    distanceRect(terrain, x, z) < -r - 0.3 && distanceRect(TABLIER, x, z) > r + 0.6 && eau(x, z) > r + 1.1 && occupe.libre(x, z, r)

  // Près de l'eau, le gravier se couvre de dalles irrégulières, de plus en plus
  // espacées en s'en éloignant : le chemin devient gravier semé de pierres, comme à Kyoto.
  const alea = generateur('allees')
  const pierres: Pose[] = []
  const lit = semis(1)
  const candidats: number[] = []
  R.v.forEach((v, k) => {
    const p = noeud(k)
    if (v < -0.25 && D.v[k] > 0.3 && T[k] > 0.5 && eau(p.x, p.z) < 8.5) candidats.push(k)
  })
  for (let n = 0; n < candidats.length * 10; n++) {
    const c = noeud(candidats[Math.floor(alea() * candidats.length)])
    const [x, z] = [c.x + (alea() - 0.5) * PAS_ALLEES, c.z + (alea() - 0.5) * PAS_ALLEES]
    const r = 0.2 + alea() * 0.14
    const densite = 1 - smoothstep(eau(x, z), 5, 8.5)
    if (alea() > densite || champ.reseau(x, z) > -r - 0.06 || !lit.libre(x, z, r, 0.035 + alea() * 0.05)) continue
    lit.poser(x, z, r)
    pierres.push({ x, z, rotation: alea() * Math.PI * 2, sx: r * (0.9 + alea() * 0.25), sy: 1, sz: r * (0.85 + alea() * 0.2) })
  }

  // Le long de l'eau, côté eau : un piquet tous les `PAS_POTEAUX`, une corde de l'un à l'autre.
  const poteaux: Point[] = []
  const cordes: [number, number][] = []
  const recul = BORDURE.dehors + GALETS + 0.22
  for (const ligne of bordures) {
    let depuis = Infinity
    let precedent = -1
    for (let i = 0; i < ligne.length; i++) {
      const p = ligne[i]
      if (i > 0) depuis += Math.hypot(p.x - ligne[i - 1].x, p.z - ligne[i - 1].z)
      const [x, z] = [p.x + p.nx * recul, p.z + p.nz * recul]
      if (eau(x, z) > PRES_DE_L_EAU || !auSol(x, z, 0.1)) {
        precedent = -1
        depuis = Infinity
        continue
      }
      if (depuis < PAS_POTEAUX) continue
      if (precedent >= 0) cordes.push([precedent, poteaux.length])
      precedent = poteaux.length
      poteaux.push({ x, z })
      depuis = 0
    }
  }
  for (const p of poteaux) occupe.poser(p.x, p.z, 0.15)

  // Aux courbes (rayon sous 12 m), côté gazon : une touffe d'herbe du Japon,
  // l'ophiopogon en tapis bas à son pied.
  const touffes: Pose[] = []
  const couvreSol: Pose[] = []
  for (const ligne of bordures) {
    const long = [0]
    for (let i = 1; i < ligne.length; i++) long.push(long[i - 1] + Math.hypot(ligne[i].x - ligne[i - 1].x, ligne[i].z - ligne[i - 1].z))
    const a = (s: number) => ligne[Math.max(0, Math.min(ligne.length - 1, long.findIndex((l) => l >= s)))]
    let prochaine = 0
    for (let i = 0; i < ligne.length; i++) {
      if (long[i] < prochaine) continue
      const [p, q] = [a(long[i] - 1.5), a(long[i] + 1.5)]
      const virage = Math.acos(Math.max(-1, Math.min(1, p.nx * q.nx + p.nz * q.nz)))
      if (virage < 3 / 12 || alea() < 0.3) continue
      prochaine = long[i] + 1.4 + alea() * 1.2
      const o = ligne[i]
      const recul = BORDURE.dehors + GALETS * o.galets + 0.35 + alea() * 0.6
      const [x, z] = [o.x + o.nx * recul + (alea() - 0.5) * 0.4, o.z + o.nz * recul + (alea() - 0.5) * 0.4]
      const s = 1.1 + alea() * 0.7
      if (champ.reseau(x, z) < BORDURE.dehors + GALETS * o.galets + 0.2 || !auSol(x, z, 0.35 * s)) continue
      occupe.poser(x, z, 0.35 * s)
      touffes.push({ x, z, rotation: alea() * Math.PI * 2, sx: s, sy: s * (0.85 + alea() * 0.3), sz: s })
      for (let k = 0; k < 3; k++) {
        const [t, d] = [alea() * Math.PI * 2, 0.5 + alea() * 0.4]
        const [mx, mz] = [x + Math.cos(t) * d, z + Math.sin(t) * d]
        const r = 0.6 + alea() * 0.35
        if (champ.reseau(mx, mz) < BORDURE.dehors + GALETS * o.galets + 0.1 || !auSol(mx, mz, 0.25 * r)) continue
        occupe.poser(mx, mz, 0.25 * r)
        couvreSol.push({ x: mx, z: mz, rotation: alea() * Math.PI * 2, sx: r, sy: r * (0.4 + alea() * 0.15), sz: r })
      }
    }
  }
  return { gravier, dalles, bordures, pierres, poteaux, cordes, touffes, couvreSol }
}
