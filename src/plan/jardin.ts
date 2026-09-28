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

export const CONTOUR_ETANG = lisser(JARDIN.etang.contour, true)
export const TRACE_RUISSEAU = lisser(JARDIN.ruisseau.trace, false)

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

/** Distance au ruisseau moins sa demi-largeur : négative dans l'eau. */
export function distanceRuisseau(x: number, z: number): number {
  let d = Infinity
  for (let i = 0; i + 1 < TRACE_RUISSEAU.length; i++) {
    const [ax, az, aw] = TRACE_RUISSEAU[i]
    const [bx, bz, bw] = TRACE_RUISSEAU[i + 1]
    const [di, t] = auSegment(ax, az, bx, bz, x, z)
    d = Math.min(d, di - (aw + t * (bw - aw)) / 2)
  }
  return d
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
export const LEVRE = TRACE_RUISSEAU.find(([x, z]) => distanceEtang(x, z) < 0.5)!

/** Le tablier du pont : le seul passage sec au-dessus du ruisseau. */
export const TABLIER: Rect = (() => {
  const { x, z, longueur, largeur } = JARDIN.pont
  return { x: x - longueur / 2, z: z - largeur / 2, width: longueur, depth: largeur }
})()

const dansRect = (r: Rect, x: number, z: number) => x > r.x && x < r.x + r.width && z > r.z && z < r.z + r.depth

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
  return out
})()
