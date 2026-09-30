/**
 * Le JARDIN JAPONAIS du parc, d'après le jardin japonais de Hasselt : un
 * ruisseau qui serpente depuis l'est, passe sous un pont de bois, tombe en
 * petite cascade dans un étang sombre au sud-est de l'entrée.
 *
 * Le tracé vit dans `jardin.json`, lu tel quel par `tools/blender/build-jardin.py`
 * qui creuse les berges et modèle l'eau : une seule source pour ce qu'on voit et
 * pour ce qui arrête la marche. Ici, en pur : où est l'eau, et les rectangles
 * qui empêchent d'y marcher (`OBSTACLES_JARDIN`, dans les obstacles du
 * rez-de-chaussée comme ceux du portique).
 *
 * L'axe de l'entrée (x = 24, au sud) reste libre : l'étang commence à x = 33.
 */
import JARDIN_JSON from './jardin.json' with { type: 'json' }
import type { Rect } from './types.ts'

export type Point = [number, number]

export const JARDIN = JARDIN_JSON as unknown as {
  zones: Rect[]
  etang: { niveau: number; contour: Point[] }
  ruisseau: { niveau: number; trace: [number, number, number][] }
  souches: {
    sujets: { x: number; z: number; lacet: number; echelle: number }[]
    branche: { de: [number, number, number]; a: [number, number, number] }
  }
  pont: { x: number; z: number; longueur: number; largeur: number }
  lanterne: { x: number; z: number }
  pas: Point[]
}

/**
 * Chaikin : coupe chaque coin au quart. Le MÊME lissage que `lisser()` de
 * build-jardin.py — l'obstacle et la berge suivent la même courbe.
 */
export function lisser<T extends number[]>(pts: T[], fermee: boolean, iterations = 3): T[] {
  let p = pts
  for (let k = 0; k < iterations; k++) {
    const out: T[] = fermee ? [] : [p[0]]
    const n = fermee ? p.length : p.length - 1
    for (let i = 0; i < n; i++) {
      const [a, b] = [p[i], p[(i + 1) % p.length]]
      out.push(a.map((v, j) => 0.75 * v + 0.25 * b[j]) as T, a.map((v, j) => 0.25 * v + 0.75 * b[j]) as T)
    }
    if (!fermee) out.push(p[p.length - 1])
    p = out
  }
  return p
}

/**
 * Catmull-Rom CENTRIPÈTE (α = ½, Barry-Goldman) par les points de passage,
 * échantillonnée tous les `pas` mètres au plus. Elle passe PAR les points, sans
 * boucle ni rebroussement : le ruisseau serpente en courbes continues, là où
 * Chaikin laissait de longs segments droits et des coudes. La MÊME que
 * `spline()` de build-jardin.py — la berge qu'on voit est celle qui arrête le pied.
 */
export function spline(pts: number[][], pas = 0.5): [number, number, number][] {
  const n = pts.length
  const P = (i: number) => (i < 0 ? pts[0].map((v, k) => 2 * v - pts[1][k]) : i >= n ? pts[n - 1].map((v, k) => 2 * v - pts[n - 2][k]) : pts[i])
  const out: [number, number, number][] = []
  for (let i = 0; i + 1 < n; i++) {
    const [p0, p1, p2, p3] = [P(i - 1), P(i), P(i + 1), P(i + 2)]
    const noeud = (a: number[], b: number[]) => Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])) || 1e-6
    const [t1] = [noeud(p0, p1)]
    const t2 = t1 + noeud(p1, p2)
    const t3 = t2 + noeud(p2, p3)
    const lerp = (a: number[], b: number[], ta: number, tb: number, t: number) => a.map((v, k) => ((tb - t) * v + (t - ta) * b[k]) / (tb - ta))
    const m = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / pas))
    for (let j = 0; j < m; j++) {
      const t = t1 + ((t2 - t1) * j) / m
      const [a1, a2, a3] = [lerp(p0, p1, 0, t1, t), lerp(p1, p2, t1, t2, t), lerp(p2, p3, t2, t3, t)]
      const [b1, b2] = [lerp(a1, a2, 0, t2, t), lerp(a2, a3, t1, t3, t)]
      out.push(lerp(b1, b2, t1, t2, t) as [number, number, number])
    }
  }
  out.push([...pts[n - 1]] as [number, number, number])
  return out
}

export const CONTOUR_ETANG = lisser(JARDIN.etang.contour, true)
export const TRACE_RUISSEAU = spline(JARDIN.ruisseau.trace)

function dansPolygone(poly: Point[], x: number, z: number): boolean {
  let dedans = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [[xi, zi], [xj, zj]] = [poly[i], poly[j]]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) dedans = !dedans
  }
  return dedans
}

/** Distance au segment [a, b], et la position t ∈ [0, 1] du pied. */
function auSegment(ax: number, az: number, bx: number, bz: number, x: number, z: number): [number, number] {
  const [dx, dz] = [bx - ax, bz - az]
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
  return [Math.hypot(x - ax - t * dx, z - az - t * dz), t]
}

/**
 * Le tracé par paquets de 8 segments, chacun dans son cercle : un paquet dont le
 * cercle est plus loin que le meilleur trouvé est sauté. La spline compte trois
 * fois plus de segments que l'ancien tracé ; la distance reste aussi rapide.
 */
const PAQUETS = (() => {
  const out: { i0: number; i1: number; x: number; z: number; r: number }[] = []
  for (let i0 = 0; i0 + 1 < TRACE_RUISSEAU.length; i0 += 8) {
    const i1 = Math.min(i0 + 8, TRACE_RUISSEAU.length - 1)
    const pts = TRACE_RUISSEAU.slice(i0, i1 + 1)
    const [x, z] = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
    out.push({ i0, i1, x, z, r: Math.max(...pts.map((p) => Math.hypot(p[0] - x, p[1] - z) + p[2] / 2)) })
  }
  return out
})()

/** Distance au ruisseau moins sa demi-largeur (négative dans l'eau), et la largeur du lit au plus près. */
export function auRuisseau(x: number, z: number): [number, number] {
  let [d, w] = [Infinity, 0]
  for (const p of PAQUETS) {
    if (Math.hypot(x - p.x, z - p.z) - p.r >= d) continue
    for (let i = p.i0; i < p.i1; i++) {
      const [ax, az, aw] = TRACE_RUISSEAU[i]
      const [bx, bz, bw] = TRACE_RUISSEAU[i + 1]
      const [di, t] = auSegment(ax, az, bx, bz, x, z)
      const wi = aw + t * (bw - aw)
      if (di - wi / 2 < d) [d, w] = [di - wi / 2, wi]
    }
  }
  return [d, w]
}

/** Distance au ruisseau moins sa demi-largeur : négative dans l'eau. */
export const distanceRuisseau = (x: number, z: number): number => auRuisseau(x, z)[0]

/** La berge du ruisseau descend de la pelouse à l'eau sur tant de mètres. */
export const BERGE_RUISSEAU = 1.3
/** Le rebord raide de la berge, au fil de l'eau : l'herbe s'arrête là, la terre sombre affleure. */
const LEVRE_BERGE = 0.45
/** La cote de la berge au fil de l'eau : 3 cm sous la surface, pour que la rive la recouvre. */
const FIL_DE_L_EAU = JARDIN.ruisseau.niveau - 0.03
const BOITE_RUISSEAU = [
  Math.min(...TRACE_RUISSEAU.map((p) => p[0])) - 3, Math.max(...TRACE_RUISSEAU.map((p) => p[0])) + 3,
  Math.min(...TRACE_RUISSEAU.map((p) => p[1])) - 3, Math.max(...TRACE_RUISSEAU.map((p) => p[1])) + 3,
]

/**
 * Le lit creusé du ruisseau, en mètres sous la pelouse (≤ 0) : une berge qui
 * plonge d'une vingtaine de centimètres — un rebord raide sur ses 45 derniers
 * centimètres, une épaule douce au-dessus — puis un fond qui se creuse au milieu — une mouille dans les
 * passages larges, à peine un radier dans les étroits. Le `creux_ruisseau` de
 * build-jardin.py en est le miroir ; `hauteurDuParc` l'ajoute à la pelouse.
 */
export function creuxDuRuisseau(x: number, z: number): number {
  const [x0, x1, z0, z1] = BOITE_RUISSEAU
  if (x < x0 || x > x1 || z < z0 || z > z1) return 0
  const [d, w] = auRuisseau(x, z)
  if (d >= BERGE_RUISSEAU) return 0
  if (d >= 0) return FIL_DE_L_EAU * (0.55 * Math.max(0, 1 - d / LEVRE_BERGE) ** 2 + 0.45 * (1 - d / BERGE_RUISSEAU) ** 2)
  const fond = 0.07 + 0.2 * Math.min(1, Math.max(0, (w - 1.4) / 1.4))
  const s = Math.min(1, -d / Math.min(0.7, w / 2))
  return FIL_DE_L_EAU - fond * s * s * (3 - 2 * s)
}

/** Distance signée au bord de l'étang : négative dans l'eau (`sdf_etang` de build-jardin.py). */
export function distanceEtang(x: number, z: number): number {
  let d = Infinity
  CONTOUR_ETANG.forEach((a, i) => {
    const b = CONTOUR_ETANG[(i + 1) % CONTOUR_ETANG.length]
    d = Math.min(d, auSegment(a[0], a[1], b[0], b[1], x, z)[0])
  })
  return dansPolygone(CONTOUR_ETANG, x, z) ? -d : d
}

/** Vrai si (x, z) est à moins de `marge` de l'eau, ou dedans. */
export const presDeLEau = (x: number, z: number, marge = 0): boolean =>
  Math.min(distanceRuisseau(x, z), distanceEtang(x, z)) < marge

/** La lèvre de la cascade : où le ruisseau atteint la berge de l'étang (`indice_cascade` de build-jardin.py). */
export const INDICE_LEVRE = TRACE_RUISSEAU.findIndex(([x, z]) => distanceEtang(x, z) < 0.5)
export const LEVRE = TRACE_RUISSEAU[INDICE_LEVRE]

/** L'eau déborde sous la berge de tant : son bord se perd sous la rive, jamais à nu. */
const SOUS_LA_RIVE = 0.25

/**
 * La lèvre de la cascade s'arrondit : son milieu avance de tant vers l'étang,
 * ses bords restent sous la berge. Une lèvre droite, tirée au cordeau, trahissait
 * la fin d'un ruban. Le même bombé que `eau()` de build-jardin.py.
 */
export const BOMBE_LEVRE = 0.16

/**
 * Le RADIER en chaque point du tracé, 0..1 : l'eau se presse et écume où le lit
 * se resserre (moins de 2,2 m), et dans le dernier mètre et demi avant la
 * cascade ; elle dort, sombre, dans les mouilles larges.
 */
export const RADIERS: number[] = (() => {
  let s = 0
  const abscisse = TRACE_RUISSEAU.map((p, i) => (s += i ? Math.hypot(p[0] - TRACE_RUISSEAU[i - 1][0], p[1] - TRACE_RUISSEAU[i - 1][1]) : 0))
  const lisse = (t: number) => t * t * (3 - 2 * t)
  return TRACE_RUISSEAU.map(([, , w], i) =>
    Math.max(lisse(Math.min(1, Math.max(0, (2.2 - w) / 0.7))), lisse(Math.min(1, Math.max(0, 1 - (abscisse[INDICE_LEVRE] - abscisse[i]) / 1.5)))))
})()

export interface Ruban {
  position: Float32Array
  /** u : mètres le long du courant ; v : mètres en travers, 0 au milieu. */
  uv: Float32Array
  /** Le radier (0..1) et la place en travers (|v| / demi-lit : 1 au fil de la berge). */
  eau: Float32Array
  index: number[]
}

/**
 * La nappe du ruisseau : UN ruban continu de la source à la lèvre de la
 * cascade, cinq sommets en travers de chaque point de la spline — pas de
 * quadrilatères qui se chevauchent aux coudes. Ses UV suivent le courant : le
 * shader fait couler les vaguelettes et l'écume le long de u.
 */
export function rubanDuRuisseau(): Ruban {
  const t = TRACE_RUISSEAU.slice(0, INDICE_LEVRE + 1)
  const [position, uv, eau, index] = [[], [], [], []] as number[][]
  const TRAVERS = [-1, -0.5, 0, 0.5, 1]
  let u = 0
  t.forEach(([x, z, w], i) => {
    const [a, b] = [t[Math.max(0, i - 1)], t[Math.min(t.length - 1, i + 1)]]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    const [nx, nz] = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l]
    if (i) u += Math.hypot(x - t[i - 1][0], z - t[i - 1][1])
    const demi = w / 2 + SOUS_LA_RIVE
    for (const k of TRAVERS) {
      // (nz, −nx) : l'aval.
      const bombe = i === t.length - 1 ? BOMBE_LEVRE * (1 - k * k) : 0
      position.push(x + nx * k * demi + nz * bombe, JARDIN.ruisseau.niveau, z + nz * k * demi - nx * bombe)
      uv.push(u, k * demi)
      eau.push(RADIERS[i], (Math.abs(k) * demi) / (w / 2))
    }
    if (i) {
      const [p, q] = [(i - 1) * TRAVERS.length, i * TRAVERS.length]
      for (let k = 0; k + 1 < TRAVERS.length; k++) index.push(p + k, p + k + 1, q + k, p + k + 1, q + k + 1, q + k)
    }
  })
  return { position: new Float32Array(position), uv: new Float32Array(uv), eau: new Float32Array(eau), index }
}

/** Le tablier du pont : le seul passage sec au-dessus du ruisseau. */
export const TABLIER: Rect = (() => {
  const { x, z, longueur, largeur } = JARDIN.pont
  return { x: x - longueur / 2, z: z - largeur / 2, width: longueur, depth: largeur }
})()

const dansRect = (r: Rect, x: number, z: number) => x > r.x && x < r.x + r.width && z > r.z && z < r.z + r.depth

/** Le pied d'une souche arrête la marche : un carré de 1,24 m à l'échelle 1, ses racines en débordent à peine. */
export const OBSTACLES_SOUCHES: Rect[] = JARDIN.souches.sujets.map(({ x, z, echelle }) => {
  const r = 0.62 * echelle
  return { x: x - r, z: z - r, width: 2 * r, depth: 2 * r }
})

/** Pas de la grille des obstacles : assez fin pour suivre une berge, assez gros pour rester peu nombreux. */
const MAILLE = 1

/**
 * L'eau en rectangles pour la marche : une grille d'un mètre, fusionnée en
 * bandes horizontales. Une maille est de l'eau si son centre l'est ; le
 * visiteur (rayon 0,3 m) s'arrête donc au bord, à quelques décimètres près —
 * sur la berge, pas dedans. Le tablier du pont reste ouvert.
 */
export const OBSTACLES_JARDIN: Rect[] = (() => {
  const out: Rect[] = []
  for (const zone of JARDIN.zones) {
    for (let z = zone.z; z < zone.z + zone.depth; z += MAILLE) {
      let debut: number | null = null
      const fermer = (x: number) => {
        if (debut !== null) out.push({ x: debut, z, width: x - debut, depth: MAILLE })
        debut = null
      }
      for (let x = zone.x; x < zone.x + zone.width; x += MAILLE) {
        const [cx, cz] = [x + MAILLE / 2, z + MAILLE / 2]
        const eau = presDeLEau(cx, cz) && !dansRect(TABLIER, cx, cz)
        if (eau && debut === null) debut = x
        if (!eau) fermer(x)
      }
      fermer(zone.x + zone.width)
    }
  }
  return [...out, ...OBSTACLES_SOUCHES]
})()
