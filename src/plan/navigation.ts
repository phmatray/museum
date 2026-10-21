/**
 * Le sol où marchent les visiteurs (PNJ), en triangles, pour le navmesh de Recast.
 *
 * Dérivé du plan, jamais des maillages rendus : chaque salle, palier, volée et le
 * terrain du parc donnent leurs rectangles de sol, PERCÉS de tout ce qui arrête la
 * marche — l'épaisseur des murs et des garde-corps, les obstacles du plan (mobilier,
 * cimaises, socles, l'eau du jardin, les troncs des grands arbres, le belvédère…) et
 * les sujets du parc (troncs d'érables, boules, rochers). Aucun volume : un trou
 * dans le sol suffit, Recast érode ensuite chaque bord du rayon du PNJ. Un sol à
 * une autre cote (un balcon au-dessus du vide, le côté d'une volée) n'est relié
 * que là où les cotes se rejoignent, à `walkableClimb` près.
 *
 * Pur : des nombres entrent, une soupe de triangles sort (`soupeDeNavigation`), et
 * la liste des entraves (`entraves`) que les tests confrontent aux PNJ.
 */
import type { Segment } from './geometry.ts'
import { guardrails } from './geometry.ts'
import { amenagerAllees } from './allees.ts'
import type { Parc } from './park.ts'
import type { PropPlacement } from './props.ts'
import { hauteurDuParc } from './relief.ts'
import { flightElevation } from './rules.ts'
import { EXT, INT } from './svg.ts'
import type { Plan, Rect } from './types.ts'
import { wallSegments } from './walk.ts'

/** Un cercle qui arrête la marche (un tronc, une boule, un rocher). */
export interface Cercle { x: number; z: number; r: number }

export interface Entraves {
  /** Par niveau : les murs et garde-corps (segments, centrés sur leur arête). */
  murs: Map<number, Segment[]>
  /** Par niveau : les obstacles du plan, qui ne ferment que le plancher. */
  obstacles: Map<number, Rect[]>
  /** Au parc : les sujets qu'on contourne, et les cordes du bord de l'eau. */
  cordes: Segment[]
  cercles: Cercle[]
}

/** Le pas de la grille du terrain (m) : le relief et les volées du belvédère y sont suivis à ce pas près. */
const PAS_PARC = 0.5
const EPS = 1e-4

/** Le tronc d'un érable, la boule d'un buis ou d'une azalée, un rocher : ce que la marche contourne (m, à l'échelle 1). */
const PIED: Partial<Record<string, (rayon: number, scale: number) => number>> = {
  'erable-rouge': (_, s) => 0.3 * s,
  'erable-vert': (_, s) => 0.3 * s,
  buis: (r) => r,
  azalee: (r) => r,
  fougere: (r) => r * 0.8,
  'rocher-1': (r) => r * 0.85,
  'rocher-2': (r) => r * 0.85,
  'rocher-3': (r) => r * 0.85,
  'rocher-4': (r) => r * 0.85,
  'rocher-5': (r) => r * 0.85,
}

/** La cuve d'une grande plante d'angle (`props.ts`), à l'échelle 1 (m) : son feuillage passe au-dessus des têtes. */
const CUVE = 0.45

/**
 * Ce qui arrête la marche, par niveau et au parc (les grands arbres sont déjà des obstacles
 * du plan). Une porte de service (la cabine de projection) reste fermée aux PNJ ; les plantes
 * d'angle (`props`, placées selon les thèmes de l'accrochage) ferment leur cuve ; au jardin, les
 * cordes tendues entre les piquets du bord de l'eau (`amenagerAllees`) sont des murs.
 */
export function entraves(plan: Plan, parc: Parc, props: readonly PropPlacement[] = []): Entraves {
  const ferme: Plan = { ...plan, levels: plan.levels.map((l) => ({ ...l, openings: l.openings.filter((o) => o.kind !== 'service') })) }
  const murs = new Map<number, Segment[]>()
  const obstacles = new Map<number, Rect[]>()
  for (const l of plan.levels) {
    murs.set(l.id, [...wallSegments(ferme, l.id, false), ...guardrails(plan, l.id)])
    const cuves = props.filter((p) => p.level === l.id).map((p): Rect => ({ x: p.x - CUVE * p.scale, z: p.z - CUVE * p.scale, width: 2 * CUVE * p.scale, depth: 2 * CUVE * p.scale }))
    obstacles.set(l.id, [...l.obstacles, ...cuves])
  }
  const { poteaux, cordes: travees } = amenagerAllees(parc)
  const cordes = travees.map(([a, b]): Segment => ({ x1: poteaux[a].x, z1: poteaux[a].z, x2: poteaux[b].x, z2: poteaux[b].z }))
  const cercles = parc.plantations.flatMap((p) => {
    const r = PIED[p.espece]?.(p.rayon, p.scale)
    return r ? [{ x: p.x, z: p.z, r }] : []
  })
  return { murs, obstacles, cercles, cordes }
}

const recouvre = (a: Rect, b: Rect) =>
  a.x < b.x + b.width - EPS && b.x < a.x + a.width - EPS && a.z < b.z + b.depth - EPS && b.z < a.z + a.depth - EPS

/** `r` privé de `o` : jusqu'à quatre rectangles (bandes nord et sud, puis ouest et est de la bande du milieu). */
function oter(r: Rect, o: Rect): Rect[] {
  if (!recouvre(r, o)) return [r]
  const [x0, x1, z0, z1] = [r.x, r.x + r.width, r.z, r.z + r.depth]
  const [ox0, ox1] = [Math.max(x0, o.x), Math.min(x1, o.x + o.width)]
  const [oz0, oz1] = [Math.max(z0, o.z), Math.min(z1, o.z + o.depth)]
  const out: Rect[] = [
    { x: x0, z: z0, width: x1 - x0, depth: oz0 - z0 },
    { x: x0, z: oz1, width: x1 - x0, depth: z1 - oz1 },
    { x: x0, z: oz0, width: ox0 - x0, depth: oz1 - oz0 },
    { x: ox1, z: oz0, width: x1 - ox1, depth: oz1 - oz0 },
  ]
  return out.filter((q) => q.width > EPS && q.depth > EPS)
}

/**
 * Le côté des voxels de Recast (m). Recast remplit toute cellule qu'un triangle touche : un
 * trou plus étroit que deux cellules (une palissade de 14 cm) peut n'en vider aucune, et
 * disparaît. Chaque trou est donc élargi, au besoin, à deux cellules.
 */
export const CELLULE = 0.15

const auMoins = (r: Rect, min = 2 * CELLULE): Rect => {
  const [dx, dz] = [Math.max(0, min - r.width) / 2, Math.max(0, min - r.depth) / 2]
  return dx || dz ? { x: r.x - dx, z: r.z - dz, width: r.width + 2 * dx, depth: r.depth + 2 * dz } : r
}

/** Les rectangles `base` privés de chaque trou. */
export function percer(base: Rect[], trous: Rect[]): Rect[] {
  let out = base
  for (const t of trous.map((t) => auMoins(t))) out = out.flatMap((r) => oter(r, t))
  return out
}

/** Un segment de mur, épaissi de `e` de part et d'autre (un mur est centré sur son arête). */
const epaissir = (s: Segment, e = INT): Rect => {
  const [x0, x1, z0, z1] = [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2), Math.min(s.z1, s.z2), Math.max(s.z1, s.z2)]
  return { x: x0 - e, z: z0 - e, width: x1 - x0 + 2 * e, depth: z1 - z0 + 2 * e }
}

/** Un carré qui contient le cercle (le sol est fait de rectangles alignés). */
const carre = (c: Cercle): Rect => ({ x: c.x - c.r, z: c.z - c.r, width: 2 * c.r, depth: 2 * c.r })

/** Une corde de biais, en tronçons de `CELLULE` : leurs rectangles la suivent en escalier, sans en couvrir le voisinage. */
function troncons(s: Segment): Rect[] {
  const n = Math.max(1, Math.ceil(Math.hypot(s.x2 - s.x1, s.z2 - s.z1) / CELLULE))
  return Array.from({ length: n }, (_, i) => epaissir({
    x1: s.x1 + ((s.x2 - s.x1) * i) / n, z1: s.z1 + ((s.z2 - s.z1) * i) / n,
    x2: s.x1 + ((s.x2 - s.x1) * (i + 1)) / n, z2: s.z1 + ((s.z2 - s.z1) * (i + 1)) / n,
  }, 0.05))
}

export interface Soupe { positions: Float32Array; indices: Uint32Array }

/** Le niveau dont relève une cote : le plus haut dont le plancher est dessous. */
const niveauDe = (plan: Plan, cote: number) =>
  plan.levels.filter((l) => l.elevation <= cote + EPS).reduce((a, b) => (b.elevation > a.elevation ? b : a)).id

/**
 * Le sol praticable en triangles (x, y, z ; y vers le haut ; faces vers le haut dans un
 * repère main droite, x est, z sud). Chaque rectangle est découpé au plus au pas `pas`
 * pour que la cote, lue à chaque sommet, suive le relief.
 */
export function soupeDeNavigation(plan: Plan, e: Entraves): Soupe {
  const pos: number[] = []
  const idx: number[] = []
  const poser = (rects: Rect[], cote: (x: number, z: number) => number, pas = Infinity) => {
    for (const r of rects) {
      const nx = Math.max(1, Math.ceil(r.width / pas))
      const nz = Math.max(1, Math.ceil(r.depth / pas))
      const base = pos.length / 3
      for (let j = 0; j <= nz; j++)
        for (let i = 0; i <= nx; i++) {
          const x = r.x + (r.width * i) / nx
          const z = r.z + (r.depth * j) / nz
          pos.push(x, cote(x, z), z)
        }
      for (let j = 0; j < nz; j++)
        for (let i = 0; i < nx; i++) {
          const a = base + j * (nx + 1) + i
          const b = a + 1
          const c = a + nx + 1
          const d = c + 1
          // Normale +y : (c − a) × (b − a) avec z vers le sud.
          idx.push(a, c, b, b, c, d)
        }
    }
  }
  const mursEpais = (niveau: number) => (e.murs.get(niveau) ?? []).map((s) => epaissir(s))

  for (const l of plan.levels) {
    // Le plancher : les salles, moins les murs, les obstacles et toute volée qui part
    // de ce plancher, y arrive ou le traverse (sa cage est un trou dans la dalle).
    const volees = plan.flights.filter((f) => f.bottom <= l.elevation + EPS && f.top >= l.elevation - EPS)
    const trous = [...mursEpais(l.id), ...(e.obstacles.get(l.id) ?? []), ...volees]
    poser(percer(l.rooms, trous.filter((t) => l.rooms.some((r) => recouvre(r, t)))), () => l.elevation)
  }
  // Paliers et volées : moins les murs et garde-corps de leur niveau (pas ses obstacles :
  // ils ne ferment que le plancher, le palier passe au-dessus du sien).
  for (const p of plan.landings) poser(percer([p], mursEpais(niveauDe(plan, p.elevation))), () => p.elevation)
  for (const f of plan.flights) poser(percer([f], mursEpais(niveauDe(plan, f.bottom))), (x, z) => flightElevation(f, x, z))

  // Le parc : le terrain moins le bâtiment (façade comprise, `svg.ts`), rouvert au seuil de
  // chaque baie sur l'extérieur ; moins les obstacles du rez-de-chaussée et les sujets du parc.
  const rdc = plan.levels.find((l) => l.elevation === 0)!
  const bati: Rect = { x: -EXT, z: -EXT, width: plan.width + 2 * EXT, depth: plan.depth + 2 * EXT }
  const terrain: Rect = { x: -40, z: -40, width: plan.width + 80, depth: plan.depth + 80 }
  const trous = [bati, ...(e.obstacles.get(rdc.id) ?? []).filter((o) => !recouvre(o, { x: 0, z: 0, width: plan.width, depth: plan.depth })), ...e.cercles.map(carre), ...e.cordes.flatMap(troncons)]
  poser(percer([terrain], trous), hauteurDuParc, PAS_PARC)
  // Les seuils : l'épaisseur de la façade, à la cote du parvis.
  const seuils = rdc.openings.filter((o) => o.b === null && o.kind !== 'bay').map((o): Rect =>
    Math.abs(o.z - plan.depth) < EPS ? { x: o.x - o.width / 2, z: plan.depth, width: o.width, depth: EXT }
    : Math.abs(o.z) < EPS ? { x: o.x - o.width / 2, z: -EXT, width: o.width, depth: EXT }
    : Math.abs(o.x) < EPS ? { x: -EXT, z: o.z - o.width / 2, width: EXT, depth: o.width }
    : { x: plan.width, z: o.z - o.width / 2, width: EXT, depth: o.width })
  poser(seuils, () => 0)
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) }
}

/**
 * La cote exacte du sol en (x, z), parmi les sols du plan qui passent là (planchers,
 * paliers, volées, parc), celle qui est la plus proche de `y` : le navmesh ne rend la
 * cote qu'à quelques centimètres près, les pieds d'un PNJ se posent sur le vrai sol.
 */
export function coteDuSol(plan: Plan, x: number, z: number, y: number): number {
  const dans = (r: Rect) => x >= r.x && x <= r.x + r.width && z >= r.z && z <= r.z + r.depth
  let mieux = y
  let ecart = Infinity
  const essayer = (c: number) => {
    if (Math.abs(c - y) < ecart) [mieux, ecart] = [c, Math.abs(c - y)]
  }
  for (const l of plan.levels) if (l.rooms.some(dans)) essayer(l.elevation)
  for (const p of plan.landings) if (dans(p)) essayer(p.elevation)
  for (const f of plan.flights) if (dans(f)) essayer(flightElevation(f, x, z))
  if (!dans({ x: 0, z: 0, width: plan.width, depth: plan.depth })) essayer(hauteurDuParc(x, z))
  return mieux
}
