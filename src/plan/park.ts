/**
 * Le PARC autour du bâtiment du plan : où poussent les arbres, où passent les
 * allées. Repris de l'ancien `domain/park.ts` (#29), posé sur l'emprise du plan.
 *
 * Un bâtiment posé sur le vide se lit comme une maquette : un arbre de huit
 * mètres dit la hauteur d'un étage mieux qu'aucune texture. Un parvis dur
 * entoure le musée, une allée en fait le tour, quatre accès rejoignent le bord
 * du terrain ; les arbres remplissent ce que les allées laissent.
 *
 * Le parc ne se visite pas : la marche reste bornée à l'emprise (`walk.ts`).
 * Il se regarde par l'entrée et par-dessus les murs de l'étage.
 *
 * Aucun aléa réel : le tirage est semé par un texte, deux appels donnent le
 * même parc, arbre pour arbre.
 */
import type { Plan, Rect } from './types.ts'

export type EspeceParc = 'arbre-01' | 'arbre-02' | 'arbuste-01' | 'arbuste-02'

export interface PlantPlacement {
  espece: EspeceParc
  x: number
  z: number
  /** Lacet, en radians. */
  rotation: number
  scale: number
  /** Demi-largeur du houppier : l'encombrement au sol. */
  rayon: number
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
const PAS_GRILLE = 11
/** Les arbustes font la strate basse, et coûtent cinq fois moins. */
const PART_ARBUSTES = 0.6
const RAYON: Record<EspeceParc, number> = { 'arbre-01': 3.2, 'arbre-02': 2.8, 'arbuste-01': 1.1, 'arbuste-02': 0.9 }

/** FNV-1a puis mulberry32 : une graine stable, zéro dépendance. */
function generateur(texte: string): () => number {
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

/** Une boucle fermée autour du parvis, et un accès au milieu de chaque côté. */
function tracerAllees(parvis: Rect, terrain: Rect): Allee[] {
  const [x0, x1] = [parvis.x - RETRAIT_PERIPHERIQUE, parvis.x + parvis.width + RETRAIT_PERIPHERIQUE]
  const [z0, z1] = [parvis.z - RETRAIT_PERIPHERIQUE, parvis.z + parvis.depth + RETRAIT_PERIPHERIQUE]
  const coins = [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }]
  const [cx, cz] = [parvis.x + parvis.width / 2, parvis.z + parvis.depth / 2]
  return [
    ...coins.map((a, i) => ({ a, b: coins[(i + 1) % 4], largeur: LARGEUR_PERIPHERIQUE })),
    ...[
      [{ x: cx, z: z0 }, { x: cx, z: terrain.z }],
      [{ x: cx, z: z1 }, { x: cx, z: terrain.z + terrain.depth }],
      [{ x: x0, z: cz }, { x: terrain.x, z: cz }],
      [{ x: x1, z: cz }, { x: terrain.x + terrain.width, z: cz }],
    ].map(([a, b]) => ({ a, b, largeur: LARGEUR_ACCES })),
  ]
}

/**
 * Sème le parc autour de l'emprise du plan. Grille perturbée plutôt que tirage
 * uniforme : pas de grappes ni de clairières que l'œil lirait comme une erreur.
 */
export function parkPlacements(plan: Plan, graine = 'parc'): Parc {
  const emprise: Rect = { x: 0, z: 0, width: plan.width, depth: plan.depth }
  const parvis = elargi(emprise, DEBORD_PARVIS)
  const terrain = elargi(emprise, DEBORD_TERRAIN)
  const allees = tracerAllees(parvis, terrain)
  const alea = generateur(graine)
  const plantations: PlantPlacement[] = []

  for (let i = 0; i < Math.floor(terrain.width / PAS_GRILLE); i++) {
    for (let j = 0; j < Math.floor(terrain.depth / PAS_GRILLE); j++) {
      const x = terrain.x + (i + 0.5) * PAS_GRILLE + (alea() - 0.5) * PAS_GRILLE * 0.8
      const z = terrain.z + (j + 0.5) * PAS_GRILLE + (alea() - 0.5) * PAS_GRILLE * 0.8
      const espece: EspeceParc = alea() < PART_ARBUSTES
        ? alea() < 0.5 ? 'arbuste-01' : 'arbuste-02'
        : alea() < 0.5 ? 'arbre-01' : 'arbre-02'
      const rayon = RAYON[espece]
      if (dansRect(parvis, x, z, rayon) || !dansRect(terrain, x, z, -rayon) || surUneAllee(allees, x, z, rayon)) continue
      if (plantations.some((p) => Math.hypot(p.x - x, p.z - z) < p.rayon + rayon)) continue
      // ±15 % de taille : deux sujets identiques côte à côte trahiraient l'instanciation.
      plantations.push({ espece, x, z, rotation: alea() * Math.PI * 2, scale: 0.85 + alea() * 0.3, rayon })
    }
  }

  return { terrain, parvis, sol: couronne(terrain, parvis), dalles: couronne(parvis, emprise), allees, plantations }
}
