/**
 * Ce qui habite le lit du ruisseau, en pur : où posent les galets de rivière,
 * les vieilles souches et la branche morte (`ruisseau.glb`, `RuisseauLayer`),
 * et où l'eau, heurtant tout cela, écume (`remous`, lus par le shader du
 * ruisseau dans `jardinMatieres.ts`).
 *
 * Les galets suivent le lit creusé (`hauteurDuParc`) : semés au fond, serrés
 * aux radiers, un cordon au pied de chaque berge à cheval sur le fil de l'eau,
 * quelques gros qui crèvent la surface au milieu des radiers ; et le liseré de
 * l'étang, qui remplace les galets taillés à la main de build-jardin.py.
 * Déterministe : leur propre tirage, le même à chaque chargement.
 */
import { BOMBE_LEVRE, CONTOUR_ETANG, INDICE_LEVRE, JARDIN, LEVRE, RADIERS, TRACE_RUISSEAU, distanceEtang } from './jardin.ts'
import { generateur } from './park.ts'
import { hauteurDuParc } from './relief.ts'

/** Les sept galets de `ruisseau.glb`, tous ramenés à 20 cm de long : leur hauteur (build-ruisseau.py). */
export const GALETS = [0.16, 0.14, 0.05, 0.12, 0.09, 0.12, 0.13].map((h) => ({ longueur: 0.2, hauteur: h }))

export interface Galet {
  /** Lequel des sept modèles. */
  modele: number
  x: number
  /** Cote du pied du modèle : enfoncé d'un bon tiers dans le lit. */
  y: number
  z: number
  lacet: number
  /** Facteur d'échelle du modèle (20 cm × echelle de long). */
  echelle: number
  /** Teinte multipliée à la texture, 0,7..1,05 : deux galets identiques ne se suivent pas. */
  teinte: number
  /** Au bord de l’étang, pas dans le courant : il baigne à la cote de l’étang. */
  etang: boolean
  /** Crève la surface : l'eau écume autour (`remous`). */
  emerge: boolean
}

const NIVEAU = JARDIN.ruisseau.niveau
const NIVEAU_ETANG = JARDIN.etang.niveau

/** La berge de l'étang telle que build-jardin.py la modèle (`hauteur`) : bombée, raide au fil de l'eau. */
function solEtang(x: number, z: number): number {
  const d = distanceEtang(x, z)
  const s = Math.min(1, Math.max(0, d / 1.8))
  return Math.min(hauteurDuParc(x, z), d >= 0 ? NIVEAU_ETANG * (1 - s) ** 2 : Math.max(-0.9, NIVEAU_ETANG + 0.5 * d))
}

/** Le point du tracé k, sa direction d'aval (ux, uz) et sa normale à gauche (nx, nz). */
function repere(k: number) {
  const [a, b] = [TRACE_RUISSEAU[Math.max(0, k - 1)], TRACE_RUISSEAU[Math.min(TRACE_RUISSEAU.length - 1, k + 1)]]
  const l = Math.hypot(b[0] - a[0], b[1] - a[1])
  const [ux, uz] = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
  return { x: TRACE_RUISSEAU[k][0], z: TRACE_RUISSEAU[k][1], w: TRACE_RUISSEAU[k][2], ux, uz, nx: -uz, nz: ux }
}

/** Les galets du ruisseau et de l'étang. */
export const GALETS_DU_RUISSEAU: Galet[] = (() => {
  const alea = generateur('ruisseau:galets')
  const out: Galet[] = []
  /** Pose un galet de `longueur` mètres, le pied enfoncé de `enfonce` de sa hauteur ; ou sa tête à `sommet`. */
  const poser = (x: number, z: number, longueur: number, enfonce: number, sommet?: number, courant = true) => {
    const modele = Math.floor(alea() * GALETS.length)
    const echelle = longueur / GALETS[modele].longueur
    const h = GALETS[modele].hauteur * echelle
    // Jamais en l’air : un galet trop petit pour atteindre `sommet` reste posé au fond.
    // Au bord de l'étang, la berge bombée de build-jardin.py, que `hauteurDuParc` ignore :
    // le galet y est à demi enterré, jamais posé sur la pelouse comme un œuf.
    const sol = courant ? hauteurDuParc(x, z) : solEtang(x, z)
    const y = sommet === undefined ? sol - enfonce * h : Math.min(sommet - h, sol - (courant ? 0.15 : 0.45) * h)
    // Ceux de l'étang plus ternes : la vase les salit, et le blanc d'un galet sec y criait.
    const teinte = courant ? 0.7 + alea() * 0.35 : 0.5 + alea() * 0.22
    out.push({ modele, x, y, z, lacet: alea() * Math.PI * 2, echelle, teinte, emerge: courant && sommet !== undefined && y + h > NIVEAU + 0.01, etang: !courant })
  }
  for (let k = 0; k < INDICE_LEVRE; k++) {
    const { x, z, w, ux, uz, nx, nz } = repere(k)
    const r = RADIERS[k]
    const demi = w / 2
    // Au fond : un à quatre par demi-mètre, plus aux radiers ; petits au bord, gros au milieu.
    const n = 1 + Math.floor(alea() * (1.1 + 2.4 * r))
    for (let i = 0; i < n; i++) {
      const [a, c] = [(alea() - 0.5) * 0.5, (alea() * 2 - 1) * (demi - 0.05)]
      const bord = Math.abs(c) / demi
      poser(x + ux * a + nx * c, z + uz * a + nz * c, (0.08 + alea() * (0.12 + 0.08 * r)) * (1 - 0.4 * bord), 0.4)
    }
    // Le cordon des berges, à cheval sur le fil de l'eau : mouillés en bas, secs en haut.
    for (const cote of [-1, 1]) {
      if (alea() > 0.55) continue
      // Pas plus de 8 cm au-delà du fil de l'eau : dans la terre nue du rebord, jamais sur la pelouse.
      const c = cote * (demi + alea() * 0.18 - 0.1)
      const a = (alea() - 0.5) * 0.5
      poser(x + ux * a + nx * c, z + uz * a + nz * c, 0.07 + alea() * 0.12, 0.3)
    }
    // Au milieu des radiers, de gros galets qui affleurent : l'eau se fend et blanchit.
    if (r > 0.6 && alea() < 0.2) {
      const c = (alea() * 2 - 1) * demi * 0.45
      poser(x + nx * c, z + nz * c, 0.22 + alea() * 0.1, 0, NIVEAU + 0.03 + alea() * 0.04)
    }
  }
  // La lèvre de la cascade : un gros galet contre chaque berge, un au milieu que l'eau contourne.
  const L = repere(INDICE_LEVRE)
  for (const [c, longueur] of [[-1.05, 0.46], [0.15, 0.27], [1.05, 0.42]] as const) {
    const cc = c * (L.w / 2)
    const bombe = BOMBE_LEVRE * (1 - c * c) - 0.04
    poser(L.x + L.nx * cc + L.ux * bombe, L.z + L.nz * cc + L.uz * bombe, longueur, 0, NIVEAU + 0.04 + 0.06 * Math.abs(c))
  }
  // Le liseré de l'étang, tous les 40 cm environ, à cheval sur son bord ; pas devant la cascade.
  const [lx, lz] = LEVRE
  let s = 0
  for (let i = 0; i < CONTOUR_ETANG.length; i++) {
    const [a, b] = [CONTOUR_ETANG[i], CONTOUR_ETANG[(i + 1) % CONTOUR_ETANG.length]]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    for (; s < l; s += 0.34 + alea() * 0.14) {
      const [x, z] = [a[0] + ((b[0] - a[0]) * s) / l, a[1] + ((b[1] - a[1]) * s) / l]
      if (Math.hypot(x - lx, z - lz) < 1.6) continue
      // Sur le fil de l'eau, à quelques centimètres près : à demi dans l'eau, à demi dans la berge.
      const e = (alea() - 0.5) * 0.12
      const [px, pz] = [x + (-(b[1] - a[1]) / l) * e, z + ((b[0] - a[0]) / l) * e]
      poser(px, pz, 0.12 + alea() * 0.14, 0, NIVEAU_ETANG + 0.015 + alea() * 0.03, false)
    }
    s -= l
  }
  return out
})()

/**
 * Un obstacle au courant, dans le repère du ruban (`rubanDuRuisseau`) :
 * u, mètres le long du courant ; v, mètres en travers (à gauche > 0) ; son
 * rayon ; la force de l'écume qu'il lève (0..1).
 */
export type Remous = [u: number, v: number, rayon: number, force: number]

/** Abscisse cumulée du tracé, comme les u du ruban. */
const ABSCISSE = (() => {
  let s = 0
  return TRACE_RUISSEAU.map((p, i) => (s += i ? Math.hypot(p[0] - TRACE_RUISSEAU[i - 1][0], p[1] - TRACE_RUISSEAU[i - 1][1]) : 0))
})()

/** (x, z) dans le repère du ruban : le pied sur le tracé, jusqu'à la lèvre. */
export function versLeRuban(x: number, z: number): [u: number, v: number] {
  let [best, u, v] = [Infinity, 0, 0]
  for (let i = 0; i < INDICE_LEVRE; i++) {
    const [[ax, az], [bx, bz]] = [TRACE_RUISSEAU[i], TRACE_RUISSEAU[i + 1]]
    const [dx, dz] = [bx - ax, bz - az]
    const l2 = dx * dx + dz * dz
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2))
    const d = Math.hypot(x - ax - t * dx, z - az - t * dz)
    if (d < best) {
      const l = Math.sqrt(l2)
      ;[best, u, v] = [d, ABSCISSE[i] + t * l, ((x - ax) * -dz + (z - az) * dx) / l]
    }
  }
  return [u, v]
}

/** Au plus tant d'obstacles : le shader les parcourt tous, pour chaque pixel du ruisseau. */
export const REMOUS_MAX = 40

/**
 * Où l'eau bute et blanchit : au pied des souches, où leurs racines plongent ;
 * le long de la branche, là où elle est dans l'eau ; autour des galets qui
 * affleurent et des rochers posés dans le courant (`rochers`, en (x, z, rayon)).
 */
export function remous(rochers: [number, number, number][] = []): Remous[] {
  const out: Remous[] = []
  for (const s of JARDIN.souches.sujets) {
    const [u, v] = versLeRuban(s.x, s.z)
    // Du côté de l’eau, les racines : 40 cm en deçà du bord du lit.
    const w = TRACE_RUISSEAU[Math.min(INDICE_LEVRE, Math.max(0, TRACE_RUISSEAU.findIndex((_, i) => ABSCISSE[i] >= u)))][2]
    out.push([u, Math.sign(v) * (w / 2 - 0.4), 0.5 * s.echelle, 1])
  }
  const { de, a } = JARDIN.souches.branche
  for (let t = 0; t <= 1.001; t += 0.1) {
    const y = de[1] + (a[1] - de[1]) * t
    if (y > NIVEAU + 0.04) continue
    const [u, v] = versLeRuban(de[0] + (a[0] - de[0]) * t, de[2] + (a[2] - de[2]) * t)
    out.push([u, v, 0.1, 0.75])
  }
  for (const g of GALETS_DU_RUISSEAU) {
    if (!g.emerge) continue
    const [u, v] = versLeRuban(g.x, g.z)
    out.push([u, v, 0.03 + 0.3 * g.echelle * GALETS[g.modele].longueur, 0.9])
  }
  // La lèvre : l'eau se presse et blanchit juste avant de tomber.
  const uLevre = ABSCISSE[INDICE_LEVRE]
  for (const c of [-0.45, 0.05, 0.5]) out.push([uLevre - 0.3, c * TRACE_RUISSEAU[INDICE_LEVRE][2] / 2, 0.28, 0.7])
  for (const [x, z, r] of rochers) {
    const [u, v] = versLeRuban(x, z)
    out.push([u, v, r, 0.8])
  }
  return out.slice(0, REMOUS_MAX)
}

/** La souche s'enfonce de tant (× son échelle) : la motte de racines est dans la berge, pas posée dessus. */
const ENFOUI = 0.14

/** Les souches posées : leur pied au plus bas de la berge sous elles, enfoncé. */
export const SOUCHES = JARDIN.souches.sujets.map(({ x, z, lacet, echelle }) => {
  const sol = Math.min(...[[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]].map(([dx, dz]) => hauteurDuParc(x + dx * echelle, z + dz * echelle)))
  return { x, y: sol - ENFOUI * echelle, z, lacet, echelle }
})
