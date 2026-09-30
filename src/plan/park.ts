/**
 * Le PARC autour du bâtiment du plan : où poussent les arbres, où passent les
 * allées. Repris de l'ancien `domain/park.ts` (#29), posé sur l'emprise du plan.
 *
 * Un bâtiment posé sur le vide se lit comme une maquette : un arbre de huit
 * mètres dit la hauteur d'un étage mieux qu'aucune texture. Un parvis dur
 * entoure le musée, une allée en fait le tour, quatre accès rejoignent le bord
 * du terrain ; les arbres remplissent ce que les allées laissent.
 *
 * Le parc se visite : on y sort par l'entrée, et la marche y reste bornée au
 * terrain (`terrainDuParc`, lu par `surfaceAt` et `walk.ts`).
 *
 * Au sud-est, le parc devient jardin japonais (`jardin.ts`) : l'eau, ses
 * rochers, des érables du Japon et des boules taillées.
 *
 * Aucun aléa réel : le tirage est semé par un texte, deux appels donnent le
 * même parc, arbre pour arbre.
 */
import { CONTOUR_ETANG, INDICE_LEVRE, JARDIN, LEVRE, RADIERS, TABLIER, TRACE_RUISSEAU, distanceEtang, distanceRuisseau, presDeLEau } from './jardin.ts'
import { BELVEDERE, EMPRISE_BELVEDERE, PIED_DE_L_ESCALIER, OBSTACLES_BELVEDERE, dansLaPercee } from './belvedere.ts'
import { EMPRISE_CHANTIER } from './chantier.ts'
import { hauteurDuParc } from './relief.ts'
import type { Plan, Rect } from './types.ts'

export type EspeceParc =
  | 'erable-rouge' | 'erable-vert' | 'buis' | 'azalee' | 'fougere' | 'petales'
  | 'rocher-1' | 'rocher-2' | 'rocher-3' | 'rocher-4' | 'rocher-5'
  | 'roseaux' | 'herbes' | 'lierre'

export interface PlantPlacement {
  espece: EspeceParc
  x: number
  z: number
  /** Lacet, en radians. */
  rotation: number
  scale: number
  /** Demi-largeur du houppier : l'encombrement au sol. */
  rayon: number
  /** Cote du pied : sur le relief (`relief.ts`), ou dans l'eau pour un rocher de berge. 0 par défaut. */
  y?: number
}

export interface Allee {
  a: { x: number; z: number }
  b: { x: number; z: number }
  largeur: number
  /** Le revêtement : du gravier bordé, par défaut ; les grandes dalles de pierre de l'axe d'entrée. */
  sol?: 'dalles'
}

export interface Parc {
  terrain: Rect
  /** Le parvis dur autour du bâtiment, emprise comprise. */
  parvis: Rect
  /** La pelouse et le parvis, percés de l'emprise : rien ne passe sous la dalle. */
  sol: Rect[]
  dalles: Rect[]
  allees: Allee[]
  plantations: PlantPlacement[]
  /**
   * Les herbes de berge (`semerBerges`) : roseaux au fil de l'eau, herbe du
   * Japon sur la rive. À part des `plantations` : on les traverse, rien ne les
   * contourne, et le reste du parc ne bouge pas d'un sujet.
   */
  berges: PlantPlacement[]
}

/** 40 m : un horizon d'arbres depuis l'étage, sans voir le bord du monde. */
const DEBORD_TERRAIN = 40
const DEBORD_PARVIS = 5
const RETRAIT_PERIPHERIQUE = 6
const LARGEUR_PERIPHERIQUE = 3
const LARGEUR_ACCES = 2.4
/**
 * L'axe de l'entrée, le plus large : la hiérarchie des allées se lit d'abord à
 * leur largeur. Trois dalles du parvis (1,20 m, `scene/pierre.ts`), centrées sur
 * le portique : ses bords tombent sur les joints, l'appareil du parvis s'y
 * prolonge en dalles entières et en demi-dalles, sans lanière recoupée au bord.
 */
const LARGEUR_AXE = 3.6
/** Le rayon des angles de la ceinture, et l'écart de ses côtés au parvis, au plus. */
const ARRONDI = 9
const ECART_CEINTURE = 1.6
/** La bordure et son lit de galets (`allees.ts`) : ni tronc ni boule n'y pousse. */
const BORD = 0.6
/** Un sujet par maille, quand la maille le permet : des arbres isolés, pas un rideau. */
/** Le parc hors jardin : ses bosquets, leur écart minimal, ses sujets isolés. */
const BOSQUETS = 14
const ECART_BOSQUETS = 22
const ISOLES = 18
const RAYON: Record<EspeceParc, number> = {
  'erable-rouge': 3.2, 'erable-vert': 3.2, buis: 0.8, azalee: 0.75, fougere: 0.5, petales: 0,
  'rocher-1': 1.4, 'rocher-2': 1.1, 'rocher-3': 1.0, 'rocher-4': 1.0, 'rocher-5': 0.9,
  roseaux: 0.3, herbes: 0.4, lierre: 1.1,
}
/** Au jardin, un semis plus serré : érables et boules taillées, pas les grands arbres. */
const PAS_JARDIN = 3.5
/** À moins de 12 m de l'eau, le parc devient jardin japonais. */
const PRES_DE_L_EAU = 12
const ROCHERS = ['rocher-1', 'rocher-2', 'rocher-3', 'rocher-4', 'rocher-5'] as const

/** FNV-1a puis mulberry32 : une graine stable, zéro dépendance. */
export function generateur(texte: string): () => number {
  let etat = 0x811c9dc5
  for (let i = 0; i < texte.length; i++) etat = Math.imul(etat ^ texte.charCodeAt(i), 0x01000193)
  etat >>>= 0
  return () => {
    etat = (etat + 0x6d2b79f5) >>> 0
    let t = etat
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Le rectangle arrondi aux mètres qui le contiennent : les mailles de la pelouse (`ParkLayer`). */
const maille = (r: Rect): Rect => {
  const [x0, z0] = [Math.floor(r.x), Math.floor(r.z)]
  return { x: x0, z: z0, width: Math.ceil(r.x + r.width) - x0, depth: Math.ceil(r.z + r.depth) - z0 }
}
const elargi = (r: Rect, m: number): Rect => ({ x: r.x - m, z: r.z - m, width: r.width + 2 * m, depth: r.depth + 2 * m })
const dansRect = (r: Rect, x: number, z: number, marge = 0) =>
  x >= r.x - marge && x <= r.x + r.width + marge && z >= r.z - marge && z <= r.z + r.depth + marge

function distanceSegment(a: Allee['a'], b: Allee['b'], x: number, z: number): number {
  const [dx, dz] = [b.x - a.x, b.z - a.z]
  const len2 = dx * dx + dz * dz
  const t = len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2))
  return Math.hypot(x - (a.x + t * dx), z - (a.z + t * dz))
}

/** Vrai si le point empiète sur une allée, houppier compris. */
export function surUneAllee(allees: Allee[], x: number, z: number, rayon = 0): boolean {
  return allees.some((s) => distanceSegment(s.a, s.b, x, z) < s.largeur / 2 + rayon)
}

/**
 * Le cadre qui reste d'un rectangle percé d'un trou : de 0 à 4 bandes, en
 * croix, qui ne se recouvrent jamais. Sans cette découpe, la pelouse passerait
 * sous le musée et recouvrirait la dalle du rez-de-chaussée.
 */
export function couronne(e: Rect, trou: Rect): Rect[] {
  const [x1, z1] = [Math.max(e.x, trou.x), Math.max(e.z, trou.z)]
  const [x2, z2] = [Math.min(e.x + e.width, trou.x + trou.width), Math.min(e.z + e.depth, trou.z + trou.depth)]
  if (x2 <= x1 || z2 <= z1) return [e]
  return [
    { x: e.x, z: e.z, width: e.width, depth: z1 - e.z },
    { x: e.x, z: z2, width: e.width, depth: e.z + e.depth - z2 },
    { x: e.x, z: z1, width: x1 - e.x, depth: z2 - z1 },
    { x: x2, z: z1, width: e.x + e.width - x2, depth: z2 - z1 },
  ].filter((r) => r.width > 1e-6 && r.depth > 1e-6)
}

/**
 * Un accès qui serpente : il part et arrive dans l'axe, et ondule entre les
 * deux d'une amplitude `a`. Le jardin japonais ne trace pas de ligne droite
 * — sauf l'axe de l'entrée, qui doit se lire depuis le portique. Un tronçon par
 * mètre : à deux mètres, les coudes se voyaient (« trop jeu vidéo », Philippe).
 */
function serpenter(a: Allee['a'], b: Allee['b'], amplitude: number, largeur: number): Allee[] {
  const [dx, dz] = [b.x - a.x, b.z - a.z]
  const l = Math.hypot(dx, dz)
  const n = Math.ceil(l)
  const pt = (t: number) => {
    const e = amplitude * Math.sin(Math.PI * t) * Math.sin(3 * Math.PI * t)
    return { x: a.x + t * dx - (dz / l) * e, z: a.z + t * dz + (dx / l) * e }
  }
  // Le dernier point tel quel : la grille du mur d'enceinte (`enceinte.ts`) se pose au bout exact.
  return Array.from({ length: n }, (_, i) => ({ a: pt(i / n), b: i + 1 === n ? b : pt((i + 1) / n), largeur }))
}

const smoothstep = (x: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** De la boîte `r` au point, négative dedans. */
export function distanceRect(r: Rect, x: number, z: number): number {
  const [dx, dz] = [Math.max(r.x - x, x - r.x - r.width), Math.max(r.z - z, z - r.z - r.depth)]
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0)
}

/**
 * Le chemin de ceinture : un rectangle aux angles arrondis (rayon `ARRONDI`),
 * dont chaque demi-côté s'écarte doucement du parvis, en sin² : il part tangent
 * de l'arc de l'angle et revient tangent au milieu du côté, là où l'accès
 * s'embranche. Près du sol creusé du jardin, l'écart s'éteint : le chemin ne
 * mord ni l'étang ni le ruisseau.
 */
function ceinture(x0: number, z0: number, x1: number, z1: number): Allee['a'][] {
  const coins = [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }]
  const unite = (p: Allee['a'], q: Allee['a']) => {
    const l = Math.hypot(q.x - p.x, q.z - p.z)
    return { x: (q.x - p.x) / l, z: (q.z - p.z) / l, l }
  }
  const pts: Allee['a'][] = []
  coins.forEach((p, k) => {
    const [q, r] = [coins[(k + 1) % 4], coins[(k + 2) % 4]]
    const [t, t2] = [unite(p, q), unite(q, r)]
    // Vers le dehors : dans ce sens (x à l'est, z au sud), le parc est à gauche de la marche.
    const n = { x: t.z, z: -t.x }
    const droit = t.l - 2 * ARRONDI
    const m = Math.ceil(droit)
    for (let i = 0; i < m; i++) {
      const s = (droit * i) / m
      const [bx, bz] = [p.x + t.x * (ARRONDI + s), p.z + t.z * (ARRONDI + s)]
      const loin = Math.min(...JARDIN.zones.map((z) => distanceRect(z, bx, bz)))
      const e = ECART_CEINTURE * Math.sin((2 * Math.PI * s) / droit) ** 2 * smoothstep(loin, 2, 9)
      pts.push({ x: bx + n.x * e, z: bz + n.z * e })
    }
    // L'arc de l'angle, tangent aux deux côtés, un point tous les 80 cm.
    const c = { x: q.x - t.x * ARRONDI + t2.x * ARRONDI, z: q.z - t.z * ARRONDI + t2.z * ARRONDI }
    const a0 = Math.atan2(-t2.z, -t2.x)
    const da = Math.atan2(t.z, t.x) - a0
    const d = da > Math.PI ? da - 2 * Math.PI : da < -Math.PI ? da + 2 * Math.PI : da
    const na = Math.ceil((Math.abs(d) * ARRONDI) / 0.8)
    for (let i = 0; i < na; i++) pts.push({ x: c.x + Math.cos(a0 + (d * i) / na) * ARRONDI, z: c.z + Math.sin(a0 + (d * i) / na) * ARRONDI })
  })
  return pts
}

/**
 * Une boucle arrondie autour du parvis, un accès au milieu de chaque côté. Les
 * accès partent du bord extérieur de la ceinture : le congé de leur jonction
 * (`allees.ts`) s'évase côté parc, sans gonfler le bord intérieur où attendent
 * les bancs.
 */
function tracerAllees(parvis: Rect, terrain: Rect): Allee[] {
  const [x0, x1] = [parvis.x - RETRAIT_PERIPHERIQUE, parvis.x + parvis.width + RETRAIT_PERIPHERIQUE]
  const [z0, z1] = [parvis.z - RETRAIT_PERIPHERIQUE, parvis.z + parvis.depth + RETRAIT_PERIPHERIQUE]
  const [cx, cz] = [parvis.x + parvis.width / 2, parvis.z + parvis.depth / 2]
  const boucle = ceinture(x0, z0, x1, z1)
  // Les accès partent à 30 cm en deçà du bord extérieur de la ceinture, bout coupé net (`allees.ts`).
  const bord = LARGEUR_PERIPHERIQUE / 2 - 0.3
  // L'accès est franchit le ruisseau sur le pont du jardin : il s'arrête de part
  // et d'autre du tablier, qui prend le relais. Il mord de 30 cm sur le bois :
  // son bout arrondi laissait une encoche de gazon au pied du pont.
  const [p0, p1] = [TABLIER.x + 0.3, TABLIER.x + TABLIER.width - 0.3]
  return [
    // L'axe de l'entrée, dallé : droit, du parvis au bord du terrain. Il se lit
    // depuis le portique, et on entre au musée sans traverser de gazon.
    { a: { x: cx, z: parvis.z + parvis.depth }, b: { x: cx, z: terrain.z + terrain.depth }, largeur: LARGEUR_AXE, sol: 'dalles' },
    ...boucle.map((a, i) => ({ a, b: boucle[(i + 1) % boucle.length], largeur: LARGEUR_PERIPHERIQUE })),
    ...serpenter({ x: cx, z: z0 - bord }, { x: cx, z: terrain.z }, 2.2, LARGEUR_ACCES),
    ...serpenter({ x: x0 - bord, z: cz }, { x: terrain.x, z: cz }, 2.2, LARGEUR_ACCES),
    ...serpenter({ x: x1 + bord, z: cz }, { x: p0, z: cz }, 0.4, LARGEUR_ACCES),
    ...serpenter({ x: p1, z: cz }, { x: terrain.x + terrain.width, z: cz }, 0.4, LARGEUR_ACCES),
  ]
}

/** Le terrain du parc : l'emprise du bâtiment élargie de `DEBORD_TERRAIN`. */
export function terrainDuParc(plan: Plan): Rect {
  return elargi({ x: 0, z: 0, width: plan.width, depth: plan.depth }, DEBORD_TERRAIN)
}

/**
 * Sème le parc autour de l'emprise du plan. Grille perturbée plutôt que tirage
 * uniforme : pas de grappes ni de clairières que l'œil lirait comme une erreur.
 */
export function parkPlacements(plan: Plan, graine = 'parc'): Parc {
  const emprise: Rect = { x: 0, z: 0, width: plan.width, depth: plan.depth }
  const parvis = elargi(emprise, DEBORD_PARVIS)
  const terrain = terrainDuParc(plan)
  const allees = tracerAllees(parvis, terrain)
  const alea = generateur(graine)
  const plantations: PlantPlacement[] = []
  const lanterne = JARDIN.lanterne

  /** Libre : hors du parvis et des allées, sur le terrain, au sec, sans chevaucher. */
  const libre = (x: number, z: number, rayon: number, eau = 0.8, serre = 1) =>
    !dansRect(parvis, x, z, rayon) && dansRect(terrain, x, z, -rayon) && !surUneAllee(allees, x, z, rayon + BORD)
    && !presDeLEau(x, z, rayon + eau) && !dansRect(TABLIER, x, z, rayon + 1)
    && Math.hypot(x - lanterne.x, z - lanterne.z) > rayon + 1.2
    && !JARDIN.pas.some(([px, pz]) => Math.hypot(x - px, z - pz) < rayon + 0.6)
    && !plantations.some((p) => Math.hypot(p.x - x, p.z - z) < (p.rayon + rayon) * serre)
  const planter = (espece: EspeceParc, x: number, z: number, scale = 0.85 + alea() * 0.3, y?: number, tirage = alea) => {
    // ±15 % de taille : deux sujets identiques côte à côte trahiraient l'instanciation.
    const p: PlantPlacement = { espece, x, z, rotation: tirage() * Math.PI * 2, scale, rayon: RAYON[espece] * scale }
    // Sur une pente, le pied se pose au plus bas de son tour : rien ne flotte côté aval.
    const sol = Math.min(...[[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]].map(([dx, dz]) => hauteurDuParc(x + dx, z + dz)))
    if (y !== undefined || sol !== 0) p.y = (y ?? 0) + sol
    // Le dernier mot, houppier compris, quel que soit le tirage qui a proposé le sujet.
    if (surUneAllee(allees, x, z, p.rayon + BORD) || dansRect(parvis, x, z, p.rayon) || !dansRect(terrain, x, z, -p.rayon)) return
    plantations.push(p)
  }
  const rocher = (tirage = alea) => ROCHERS[Math.floor(tirage() * ROCHERS.length)]

  // 1. Les rochers d'abord : ils tiennent la berge, le reste pousse autour.
  //    Deux gros de part et d'autre de la cascade, puis la rive de l'étang et
  //    celle du ruisseau, enfoncés dans l'eau d'un bon tiers.
  const [lx, lz] = LEVRE
  const [px, pz] = TRACE_RUISSEAU[Math.max(0, TRACE_RUISSEAU.indexOf(LEVRE) - 1)]
  const l = Math.hypot(lx - px, lz - pz)
  const [ux, uz] = [(lx - px) / l, (lz - pz) / l]
  for (const s of [-1, 1]) planter(s < 0 ? 'rocher-2' : 'rocher-4', lx - uz * s * 1.9 - ux * 0.3, lz + ux * s * 1.9 - uz * 0.3, 0.72, -0.3)
  CONTOUR_ETANG.forEach(([x, z], k) => {
    if (k % 3 !== 0 || alea() < 0.45) return
    const s = 0.3 + alea() * 0.35
    const espece = rocher()
    if (Math.hypot(x - lx, z - lz) < 3.5 || surUneAllee(allees, x, z, 1)) return
    if (plantations.some((p) => Math.hypot(p.x - x, p.z - z) < (p.rayon + RAYON[espece] * s) * 0.7)) return
    planter(espece, x, z, s, -0.2 - 0.35 * s)
  })
  // Des fougères entre les rochers, sur la berge, à un mètre de l'eau.
  const [cx, cz] = CONTOUR_ETANG.reduce(([a, b], [x, z]) => [a + x / CONTOUR_ETANG.length, b + z / CONTOUR_ETANG.length], [0, 0])
  CONTOUR_ETANG.forEach(([x, z], k) => {
    if (k % 2 !== 1 || alea() < 0.4) return
    const d = Math.hypot(x - cx, z - cz)
    const [fx, fz] = [x + ((x - cx) / d) * 1.0, z + ((z - cz) / d) * 1.0]
    if (libre(fx, fz, 0.2, 0.3)) planter('fougere', fx, fz, 1.1 + alea() * 0.7)
  })
  // Le long du ruisseau, tous les 3,5 m environ : un rocher moussu calé dans la
  // berge, d'un côté ou de l'autre ; aux radiers, une pierre au milieu du courant
  // que l'eau contourne en écumant. Et des fougères qui penchent sur l'eau.
  // Leur propre tirage : le tracé du ruisseau peut changer sans rebattre tout le parc.
  const rive = generateur(`${graine}:ruisseau`)
  let [marche, prochain] = [0, 2]
  TRACE_RUISSEAU.forEach(([x, z, w], k) => {
    if (k === 0 || k >= INDICE_LEVRE) return
    const [ax, az] = TRACE_RUISSEAU[k - 1]
    marche += Math.hypot(x - ax, z - az)
    const d = Math.hypot(x - ax, z - az) || 1
    const [nx, nz] = [-(z - az) / d, (x - ax) / d]
    const loinDuPont = !dansRect(TABLIER, x, z, 1.5) && distanceEtang(x, z) > 2
    if (marche >= prochain && loinDuPont) {
      prochain = marche + 2.8 + rive() * 1.6
      const cote = rive() < 0.5 ? -1 : 1
      if (RADIERS[k] > 0.7 && rive() < 0.75) {
        const c = (rive() - 0.5) * w * 0.4
        planter(rocher(rive), x + nx * c, z + nz * c, 0.24 + rive() * 0.12, -0.12, rive)
      } else if (rive() < 0.7) {
        const [rx, rz] = [x + nx * cote * (w / 2 + 0.15), z + nz * cote * (w / 2 + 0.15)]
        if (!surUneAllee(allees, rx, rz, 0.8)) planter(rocher(rive), rx, rz, 0.22 + rive() * 0.25, -0.06, rive)
      }
    }
    // Les fougères : une tous les 1,5 m à peu près, sur la pente de la berge.
    if (k % 3 === 0 && loinDuPont && rive() < 0.55) {
      const cote = rive() < 0.5 ? -1 : 1
      const r = w / 2 + 0.3 + rive() * 0.45
      const [fx, fz] = [x + nx * cote * r, z + nz * cote * r]
      const serre = !plantations.some((p) => Math.hypot(p.x - fx, p.z - fz) < (p.rayon + 0.25) * 0.6)
      if (serre && !surUneAllee(allees, fx, fz, 0.8) && distanceRuisseau(fx, fz) > 0.2) planter('fougere', fx, fz, 1.0 + rive() * 0.7, undefined, rive)
    }
  })
  // 2. Un rideau de grands arbres au fond du jardin, le long du bord du terrain :
  //    sans lui, la pelouse filait jusqu'au ciel derrière l'étang.
  const [xMax, zMax] = [terrain.x + terrain.width, terrain.z + terrain.depth]
  const rideau: [number, number][] = []
  for (let x = JARDIN.zones[0].x; x < xMax; x += 7) rideau.push([x, zMax - 3.5])
  for (let z = JARDIN.zones[1].z; z < zMax - 7; z += 7) rideau.push([xMax - 3.5, z])
  for (const [x, z] of rideau) {
    // De grands érables, surtout verts : un fond calme derrière les rouges du jardin.
    const espece = alea() < 0.3 ? 'erable-rouge' : 'erable-vert'
    const [rx, rz] = [x + (alea() - 0.5) * 3, z + (alea() - 0.5) * 2]
    if (libre(rx, rz, RAYON[espece] * 0.8, 1.5)) planter(espece, rx, rz, 1.3 + alea() * 0.35)
  }

  // 3. Le jardin : un semis serré à moins de `PRES_DE_L_EAU` de l'eau, érables
  //    et boules taillées en massifs.
  const [gx0, gz0] = [Math.min(...JARDIN.zones.map((r) => r.x)), Math.min(...JARDIN.zones.map((r) => r.z))]
  const [gx1, gz1] = [Math.max(...JARDIN.zones.map((r) => r.x + r.width)), Math.max(...JARDIN.zones.map((r) => r.z + r.depth))]
  for (let x = gx0 - PRES_DE_L_EAU + PAS_JARDIN / 2; x < gx1; x += PAS_JARDIN) {
    for (let z = gz0 + PAS_JARDIN / 2; z < gz1; z += PAS_JARDIN) {
      const [jx, jz] = [x + (alea() - 0.5) * PAS_JARDIN * 0.9, z + (alea() - 0.5) * PAS_JARDIN * 0.9]
      const tirage = alea()
      if (!presDeLEau(jx, jz, PRES_DE_L_EAU)) continue
      if (tirage < 0.42) {
        // Un érable penche volontiers sur l'eau : son houppier peut la surplomber.
        const espece = alea() < 0.45 ? 'erable-rouge' : 'erable-vert'
        if (libre(jx, jz, 1.8, -0.2, 0.75)) planter(espece, jx, jz, 0.8 + alea() * 0.35)
      } else if (tirage < 0.85) {
        // Un massif de boules : une grande, deux petites à côté (o-karikomi).
        const espece = alea() < 0.45 ? 'azalee' : 'buis'
        const s0 = 0.9 + alea() * 0.5
        if (!libre(jx, jz, RAYON[espece] * s0, 0.8, 0.7)) continue
        planter(espece, jx, jz, s0)
        for (let k = 0; k < 2; k++) {
          const a = alea() * Math.PI * 2
          const s1 = 0.55 + alea() * 0.3
          const r = RAYON[espece] * (s0 + s1) * 0.8
          const [bx, bz] = [jx + Math.cos(a) * r, jz + Math.sin(a) * r]
          if (libre(bx, bz, RAYON[espece] * s1 * 0.6, 0.8, 0.7)) planter(alea() < 0.7 ? espece : 'buis', bx, bz, s1)
        }
      }
    }
  }

  // 4. Le reste du parc, en BOSQUETS plutôt qu'en grille : un parc paysager se
  //    lit par masses et clairières, pas par sujets alignés (« le parc doit
  //    sembler organique », Philippe). Chaque bosquet : des érables serrés de
  //    tailles inégales, plus grands au cœur, et un chapelet de boules et
  //    d'azalées sur sa lisière ; entre les bosquets, de la pelouse, et quelques
  //    isolés. Seules les essences du jardin : les arbres Poly Haven d'origine ne
  //    s'y accordaient pas.
  const bosquets: [number, number][] = []
  for (let essai = 0; essai < 400 && bosquets.length < BOSQUETS; essai++) {
    const [x, z] = [terrain.x + alea() * terrain.width, terrain.z + alea() * terrain.depth]
    if (dansRect(parvis, x, z, 9) || presDeLEau(x, z, 6)) continue
    if (bosquets.some(([bx, bz]) => Math.hypot(bx - x, bz - z) < ECART_BOSQUETS)) continue
    bosquets.push([x, z])
  }
  for (const [bx, bz] of bosquets) {
    // Un bosquet est plutôt rouge ou plutôt vert : des masses de couleur, pas un damier.
    const rouge = alea() < 0.35
    const n = 3 + Math.floor(alea() * 5)
    const etendue = 3 + n * 0.9
    for (let k = 0; k < n * 3; k++) {
      const [a, r] = [alea() * Math.PI * 2, Math.sqrt(alea()) * etendue]
      const [x, z] = [bx + Math.cos(a) * r * 1.3, bz + Math.sin(a) * r]
      const espece = (alea() < 0.8) === rouge ? 'erable-rouge' : 'erable-vert'
      const taille = 0.85 + alea() * 0.6 + (1 - r / etendue) * 0.3
      if (libre(x, z, RAYON[espece] * taille * 0.8, 1.5, 0.55)) planter(espece, x, z, taille)
    }
    for (let k = 0; k < 10; k++) {
      const [a, f] = [alea() * Math.PI * 2, (etendue + 2.5) * (0.85 + alea() * 0.3)]
      const [x, z] = [bx + Math.cos(a) * f * 1.3, bz + Math.sin(a) * f]
      const espece = alea() < 0.5 ? 'azalee' : 'buis'
      if (libre(x, z, RAYON[espece], 0.8, 0.8)) planter(espece, x, z, 0.8 + alea() * 0.7)
    }
  }
  for (let k = 0; k < ISOLES; k++) {
    const [x, z] = [terrain.x + alea() * terrain.width, terrain.z + alea() * terrain.depth]
    const espece: EspeceParc = alea() < 0.5 ? (alea() < 0.4 ? 'erable-rouge' : 'erable-vert') : alea() < 0.5 ? 'azalee' : 'buis'
    // Un isolé garde ses distances : c'est ce qui le fait lire comme tel.
    if (libre(x, z, RAYON[espece] * 1.6, 1.5)) planter(espece, x, z)
  }

  // 5. En dernier, pour ne rien empêcher de pousser : des pétales tombés sous
  //    les azalées et les érables pourpres.
  for (const p of [...plantations]) {
    if ((p.espece !== 'azalee' && p.espece !== 'erable-rouge') || alea() < 0.45) continue
    const [x, z] = [p.x + (alea() - 0.5) * 1.5, p.z + (alea() - 0.5) * 1.5]
    if (!presDeLEau(x, z, 1.6) && !surUneAllee(allees, x, z, 1.3) && !dansRect(parvis, x, z, 1.3)) planter('petales', x, z, 0.8 + alea() * 0.6)
  }

  // 6. Le long du mur d'enceinte (`enceinte.ts`), là où le rideau du jardin
  //    ne va pas (ouest, nord, et le sud-ouest), une ligne de grands érables :
  //    au-dessus du mur, une lisière, pas un ciel nu. Leur propre tirage, en
  //    dernier : le reste du parc ne bouge pas d'un arbre.
  const lisiere = generateur(`${graine}:lisiere`)
  const bord = 5
  const pieds: [number, number][] = []
  for (let x = terrain.x + bord; x < xMax - bord; x += 8) pieds.push([x, terrain.z + bord])
  for (let z = terrain.z + bord + 8; z < zMax - bord; z += 8) pieds.push([terrain.x + bord, z])
  for (let x = terrain.x + bord + 8; x < JARDIN.zones[0].x; x += 8) pieds.push([x, zMax - bord])
  for (let z = terrain.z + bord + 8; z < JARDIN.zones[1].z; z += 8) pieds.push([xMax - bord, z])
  for (const [x, z] of pieds) {
    const espece = lisiere() < 0.3 ? 'erable-rouge' : 'erable-vert'
    const [rx, rz] = [x + (lisiere() - 0.5) * 3, z + (lisiere() - 0.5) * 3]
    if (libre(rx, rz, RAYON[espece] * 0.8, 1.5, 0.6)) planter(espece, rx, rz, 1.2 + lisiere() * 0.35)
  }

  // 7. La source du ruisseau : l'eau naissait d'un bout carré dans la pelouse,
  //    à quatre mètres du mur. Un gros rocher la couvre, deux autres la tiennent :
  //    le ruisseau sourd d'entre les pierres. En dernier, comme la lisière.
  const [[sx, sz, sw], [tx, tz]] = TRACE_RUISSEAU
  const ls = Math.hypot(tx - sx, tz - sz)
  const [vx, vz] = [(tx - sx) / ls, (tz - sz) / ls]
  planter('rocher-1', sx - vx * 0.5, sz - vz * 0.5, 0.95, -0.25)
  for (const s of [-1, 1]) planter(s < 0 ? 'rocher-3' : 'rocher-5', sx + vx * 0.7 - vz * s * (sw / 2 + 0.5), sz + vz * 0.7 + vx * s * (sw / 2 + 0.5), 0.6, -0.15)

  // La pelouse s'arrête où commence le sol creusé du jardin (build-jardin.py),
  // et sous le belvédère : ses pierres couvrent le sol, maille entière (`belvedere.ts`).
  const sol = [...JARDIN.zones, ...EMPRISE_BELVEDERE.map(maille)].reduce((rs, zone) => rs.flatMap((r) => couronne(r, zone)), couronne(terrain, parvis))
  // Les vieilles souches des berges (`ruisseau.ts`) tiennent leur place : rien ne
  // pousse dans leurs racines. Retirés après coup, sans rebattre aucun tirage.
  const souches = JARDIN.souches.sujets
  // La baraque du chantier (`chantier.ts`) de même : ni tronc sous son plancher,
  // ni houppier dans sa verrière (le houppier d'un grand érable déborde son rayon
  // d'encombrement d'un bon mètre), et de la pelouse autour.
  const libres = plantations.filter((p) => !souches.some((s) => Math.hypot(p.x - s.x, p.z - s.z) < 0.9 * s.echelle + p.rayon * 0.5)
    && distanceRect(EMPRISE_CHANTIER, p.x, p.z) > p.rayon * (p.espece.startsWith('erable') ? 1.4 : 1) + 1)
  // Le belvédère et son roji (`belvedere.ts`), posés APRÈS le tirage : le reste
  // du parc garde chaque arbre à sa place. On retire seulement ce qui pousserait
  // dans la pierre, sur le roji, dans la palissade, ou dans la percée (les grands
  // arbres seuls : boules et azalées font le premier plan) ; les houppiers qui
  // débordent sur le roji restent — c'est le tunnel du chemin de thé.
  const { roji: J, sujets } = BELVEDERE
  // Il file sous les deux premières marches : son bout rond, et sa bordure, se perdent sous la pierre.
  const roji = serpenter({ x: J.x, z: J.z0 }, { x: PIED_DE_L_ESCALIER[0], z: BELVEDERE.escalier.z0 + 1.2 }, J.ondulation, J.largeur)
  const grand = (p: PlantPlacement) => p.espece.startsWith('erable')
  const pied = (p: PlantPlacement) => (grand(p) ? 0.5 * p.scale : p.rayon)
  const gardes = libres.filter((p) =>
    !EMPRISE_BELVEDERE.some((r) => distanceRect(r, p.x, p.z) < pied(p) + 0.6)
    && !OBSTACLES_BELVEDERE.some((r) => distanceRect(r, p.x, p.z) < pied(p) + 0.3)
    && !surUneAllee(roji, p.x, p.z, pied(p) + BORD)
    && !(grand(p) && dansLaPercee(p.x, p.z))
    && !sujets.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < (RAYON[s.espece] * s.scale + p.rayon) * 0.6))
  // Les sujets plantés à dessein : l'érable pourpre de la terrasse, qui penche
  // sur le parapet, et la paire qui encadre la façade au bout de l'axe.
  for (const s of sujets) {
    const y = s.belvedere ? BELVEDERE.cote : Math.min(...[[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]].map(([dx, dz]) => hauteurDuParc(s.x + dx, s.z + dz)))
    gardes.push({ espece: s.espece, x: s.x, z: s.z, rotation: s.lacet ?? generateur(`${graine}:${s.x}`)() * Math.PI * 2, scale: s.scale, rayon: RAYON[s.espece] * s.scale, y: s.espece === 'lierre' ? y - 0.05 : y })
  }
  const toutes = [...allees, ...roji]
  return { terrain, parvis, sol, dalles: couronne(parvis, emprise), allees: toutes, plantations: gardes, berges: semerBerges(toutes, gardes, graine) }
}

/**
 * Les herbes de berge, par colonies comme dans la nature : des roseaux les
 * pieds dans l'eau le long du ruisseau et autour de l'étang, de l'herbe du
 * Japon en fontaine sur le haut de la rive. Une colonie court sur quelques
 * mètres puis la rive se dégage ; les pierres, les souches, le pont, les pas
 * japonais et les allées gardent leur place. Leur propre tirage.
 */
function semerBerges(allees: Allee[], plantations: PlantPlacement[], graine: string): PlantPlacement[] {
  const alea = generateur(`${graine}:berges`)
  const out: PlantPlacement[] = []
  const { lanterne, pas, souches, etang } = JARDIN
  const libre = (x: number, z: number, r: number) =>
    !surUneAllee(allees, x, z, r + 0.3) && !dansRect(TABLIER, x, z, r + 0.8)
    && Math.hypot(x - lanterne.x, z - lanterne.z) > r + 1.2
    && !pas.some(([px, pz]) => Math.hypot(x - px, z - pz) < r + 0.5)
    && !souches.sujets.some((s) => Math.hypot(x - s.x, z - s.z) < 1.1 * s.echelle + r)
    && !plantations.some((p) => p.espece !== 'petales' && p.espece !== 'fougere' && Math.hypot(p.x - x, p.z - z) < p.rayon * 0.7 + r)
    && !out.some((p) => Math.hypot(p.x - x, p.z - z) < (p.rayon + r) * 0.75)
  const poser = (espece: EspeceParc, x: number, z: number, scale: number, y?: number) => {
    const rayon = RAYON[espece] * scale
    if (!libre(x, z, rayon)) return
    const sol = y ?? Math.min(...[[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]].map(([dx, dz]) => hauteurDuParc(x + dx, z + dz)))
    out.push({ espece, x, z, rotation: alea() * Math.PI * 2, scale, rayon, y: sol })
  }
  /** Une colonie par rive : elle dure `n` pas, puis la rive reste nue un moment. */
  const colonies = () => {
    let reste = 0
    return (chance: number) => {
      if (reste > 0) return reste-- > 0
      if (alea() < chance) reste = 4 + Math.floor(alea() * 8)
      return false
    }
  }
  // Le ruisseau : les roseaux au fil de l'eau, l'herbe du Japon plus haut sur la berge.
  const [roseau, herbe] = [[colonies(), colonies()], [colonies(), colonies()]]
  TRACE_RUISSEAU.forEach(([x, z, w], k) => {
    if (k === 0 || k >= INDICE_LEVRE || k % 2) return
    const [ax, az] = TRACE_RUISSEAU[k - 1]
    const d = Math.hypot(x - ax, z - az) || 1
    const [nx, nz] = [-(z - az) / d, (x - ax) / d]
    ;[-1, 1].forEach((cote, i) => {
      if (roseau[i](0.12)) {
        const r = w / 2 - 0.05 + (alea() - 0.4) * 0.3
        poser('roseaux', x + nx * cote * r + (alea() - 0.5) * 0.3, z + nz * cote * r + (alea() - 0.5) * 0.3, 0.75 + alea() * 0.5)
      }
      if (herbe[i](0.1)) {
        const r = w / 2 + 0.55 + alea() * 0.6
        poser('herbes', x + nx * cote * r, z + nz * cote * r, 0.8 + alea() * 0.5)
      }
    })
  })
  // L'étang : des roseaux dans l'eau le long du bord, de l'herbe sur la rive ; rien devant la cascade.
  const [cx, cz] = CONTOUR_ETANG.reduce(([a, b], [x, z]) => [a + x / CONTOUR_ETANG.length, b + z / CONTOUR_ETANG.length], [0, 0])
  const [lx, lz] = LEVRE
  const [bord, rive] = [colonies(), colonies()]
  CONTOUR_ETANG.forEach(([x, z]) => {
    if (Math.hypot(x - lx, z - lz) < 3.5) return
    const l = Math.hypot(x - cx, z - cz)
    const [ux, uz] = [(x - cx) / l, (z - cz) / l]
    if (bord(0.1)) {
      const e = -0.1 - alea() * 0.35
      poser('roseaux', x + ux * e, z + uz * e, 0.8 + alea() * 0.5, etang.niveau - 0.2)
    }
    if (rive(0.08)) poser('herbes', x + ux * (0.7 + alea() * 0.5), z + uz * (0.7 + alea() * 0.5), 0.8 + alea() * 0.5)
  })
  return out
}
