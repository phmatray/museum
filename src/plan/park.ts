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
import { CONTOUR_ETANG, JARDIN, LEVRE, TABLIER, TRACE_RUISSEAU, distanceEtang, presDeLEau } from './jardin.ts'
import { hauteurDuParc } from './relief.ts'
import type { Plan, Rect } from './types.ts'

export type EspeceParc =
  | 'erable-rouge' | 'erable-vert' | 'buis' | 'azalee' | 'fougere' | 'petales'
  | 'rocher-1' | 'rocher-2' | 'rocher-3' | 'rocher-4' | 'rocher-5'

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
}

/** 40 m : un horizon d'arbres depuis l'étage, sans voir le bord du monde. */
const DEBORD_TERRAIN = 40
const DEBORD_PARVIS = 5
const RETRAIT_PERIPHERIQUE = 6
const LARGEUR_PERIPHERIQUE = 3
const LARGEUR_ACCES = 2.4
/** Un sujet par maille, quand la maille le permet : des arbres isolés, pas un rideau. */
/** Le parc hors jardin : ses bosquets, leur écart minimal, ses sujets isolés. */
const BOSQUETS = 14
const ECART_BOSQUETS = 22
const ISOLES = 18
const RAYON: Record<EspeceParc, number> = {
  'erable-rouge': 3.2, 'erable-vert': 3.2, buis: 0.8, azalee: 0.75, fougere: 0.5, petales: 0,
  'rocher-1': 1.4, 'rocher-2': 1.1, 'rocher-3': 1.0, 'rocher-4': 1.0, 'rocher-5': 0.9,
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
 * — sauf l'axe de l'entrée, qui doit se lire depuis le portique.
 */
function serpenter(a: Allee['a'], b: Allee['b'], amplitude: number, largeur: number, n = 14): Allee[] {
  const [dx, dz] = [b.x - a.x, b.z - a.z]
  const l = Math.hypot(dx, dz)
  const pt = (t: number) => {
    const e = amplitude * Math.sin(Math.PI * t) * Math.sin(3 * Math.PI * t)
    return { x: a.x + t * dx - (dz / l) * e, z: a.z + t * dz + (dx / l) * e }
  }
  return Array.from({ length: n }, (_, i) => ({ a: pt(i / n), b: pt((i + 1) / n), largeur }))
}

/** Une allée droite, coupée là où elle passe le pont : le tablier prend le relais. */
function coupee(a: Allee['a'], b: Allee['b'], largeur: number): Allee[] {
  const [x0, x1] = [TABLIER.x - 0.8, TABLIER.x + TABLIER.width + 0.8]
  const croise = Math.abs(a.z - b.z) < 1e-9 && a.z > TABLIER.z && a.z < TABLIER.z + TABLIER.depth
    && Math.min(a.x, b.x) < x0 && Math.max(a.x, b.x) > x1
  if (!croise) return [{ a, b, largeur }]
  const [g, d] = a.x < b.x ? [a, b] : [b, a]
  return [{ a: g, b: { x: x0, z: g.z }, largeur }, { a: { x: x1, z: g.z }, b: d, largeur }]
}

/** Une boucle fermée autour du parvis, et un accès au milieu de chaque côté. */
function tracerAllees(parvis: Rect, terrain: Rect): Allee[] {
  const [x0, x1] = [parvis.x - RETRAIT_PERIPHERIQUE, parvis.x + parvis.width + RETRAIT_PERIPHERIQUE]
  const [z0, z1] = [parvis.z - RETRAIT_PERIPHERIQUE, parvis.z + parvis.depth + RETRAIT_PERIPHERIQUE]
  const coins = [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }]
  const [cx, cz] = [parvis.x + parvis.width / 2, parvis.z + parvis.depth / 2]
  // Seule l'entrée (au sud) est reliée au PARVIS : sans ce raccord, il fallait
  // traverser une bande de gazon pour entrer au musée. Les trois autres accès
  // s'arrêtent au chemin de ceinture, qui fait le tour : ils filaient droit
  // dans un mur aveugle, sans porte (audit du jardin).
  const raccords: Allee[] = [{ a: { x: cx, z: parvis.z + parvis.depth }, b: { x: cx, z: z1 }, largeur: LARGEUR_ACCES }]
  return [
    ...raccords,
    ...coins.map((a, i) => ({ a, b: coins[(i + 1) % 4], largeur: LARGEUR_PERIPHERIQUE })),
    ...serpenter({ x: cx, z: z0 }, { x: cx, z: terrain.z }, 2.2, LARGEUR_ACCES),
    // L'axe de l'entrée : droit, du portique au bord du terrain.
    { a: { x: cx, z: z1 }, b: { x: cx, z: terrain.z + terrain.depth }, largeur: LARGEUR_ACCES },
    ...serpenter({ x: x0, z: cz }, { x: terrain.x, z: cz }, 2.2, LARGEUR_ACCES),
    // L'accès est franchit le ruisseau sur le pont du jardin.
    ...coupee({ x: x1, z: cz }, { x: terrain.x + terrain.width, z: cz }, LARGEUR_ACCES),
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
    !dansRect(parvis, x, z, rayon) && dansRect(terrain, x, z, -rayon) && !surUneAllee(allees, x, z, rayon)
    && !presDeLEau(x, z, rayon + eau) && !dansRect(TABLIER, x, z, rayon + 1)
    && Math.hypot(x - lanterne.x, z - lanterne.z) > rayon + 1.2
    && !JARDIN.pas.some(([px, pz]) => Math.hypot(x - px, z - pz) < rayon + 0.6)
    && !plantations.some((p) => Math.hypot(p.x - x, p.z - z) < (p.rayon + rayon) * serre)
  const planter = (espece: EspeceParc, x: number, z: number, scale = 0.85 + alea() * 0.3, y?: number) => {
    // ±15 % de taille : deux sujets identiques côte à côte trahiraient l'instanciation.
    const p: PlantPlacement = { espece, x, z, rotation: alea() * Math.PI * 2, scale, rayon: RAYON[espece] * scale }
    // Sur une pente, le pied se pose au plus bas de son tour : rien ne flotte côté aval.
    const sol = Math.min(...[[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]].map(([dx, dz]) => hauteurDuParc(x + dx, z + dz)))
    if (y !== undefined || sol > 0) p.y = (y ?? 0) + sol
    // Le dernier mot, houppier compris, quel que soit le tirage qui a proposé le sujet.
    if (surUneAllee(allees, x, z, p.rayon) || dansRect(parvis, x, z, p.rayon) || !dansRect(terrain, x, z, -p.rayon)) return
    plantations.push(p)
  }
  const rocher = () => ROCHERS[Math.floor(alea() * ROCHERS.length)]

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
  TRACE_RUISSEAU.forEach(([x, z, w], k) => {
    if (k % 3 !== 0 || alea() < 0.35) return
    const [ax, az] = TRACE_RUISSEAU[Math.min(k + 1, TRACE_RUISSEAU.length - 1)]
    const d = Math.hypot(ax - x, az - z) || 1
    const [nx, nz] = [-(az - z) / d, (ax - x) / d]
    const cote = alea() < 0.5 ? -1 : 1
    const [rx, rz] = [x + nx * cote * (w / 2 + 0.2), z + nz * cote * (w / 2 + 0.2)]
    const s = 0.22 + alea() * 0.25
    if (distanceEtang(rx, rz) < 2 || dansRect(TABLIER, rx, rz, 1.5) || surUneAllee(allees, rx, rz, 0.8)) return
    planter(rocher(), rx, rz, s, -0.08 - 0.3 * s)
    // Une fougère au pied du rocher, côté terre.
    const [fx, fz] = [rx + nx * cote * 1.1, rz + nz * cote * 1.1]
    if (alea() < 0.7 && libre(fx, fz, RAYON.fougere * 0.3, 0.2)) planter('fougere', fx, fz, 1.2 + alea() * 0.6)
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

  // La pelouse s'arrête où commence le sol creusé du jardin (build-jardin.py).
  const sol = JARDIN.zones.reduce((rs, zone) => rs.flatMap((r) => couronne(r, zone)), couronne(terrain, parvis))
  return { terrain, parvis, sol, dalles: couronne(parvis, emprise), allees, plantations }
}
