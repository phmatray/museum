/**
 * Le PARC : ce qui entoure le musée.
 *
 * Module de domaine PUR — il ne dessine rien, il décide où. `scene/ParkLayer.tsx`
 * instancie ce qu'il produit.
 *
 * ── Pourquoi un musée a besoin d'un parc ──
 *
 * Un bâtiment posé sur une dalle nue se lit comme une maquette : il n'a pas
 * d'échelle, parce que rien autour de lui n'en a une. Un arbre de huit mètres
 * dit la hauteur d'un étage mieux que n'importe quelle texture, et un sentier
 * dit d'où l'on vient. Ce n'est pas de la décoration, c'est ce qui fait qu'on
 * lit un bâtiment plutôt qu'un objet.
 *
 * ── La composition ──
 *
 * Un parvis dur autour du bâtiment, une ALLÉE PÉRIPHÉRIQUE qui en fait le tour,
 * et quatre allées d'accès qui rejoignent les bords du parc en visant les
 * quatre côtés. Les arbres remplissent ce que les allées laissent, en évitant à
 * la fois le bâtiment et les sentiers — un arbre au milieu d'un chemin est le
 * genre de détail qui ruine tout le reste.
 *
 * ── Déterminisme ──
 *
 * Aucun aléa réel, aucune horloge : le tirage est semé par un texte, et deux
 * exécutions produisent le même parc, arbre pour arbre. C'est ce qui permet à un
 * test de vérifier qu'aucun arbre ne pousse dans une allée.
 */
import { generateur, graineDepuis } from './props'
import type { Rect, Vec3 } from './types'

// ── Contrat public ───────────────────────────────────────────────────────

export type EspeceParc = 'arbre-01' | 'arbre-02' | 'arbuste-01' | 'arbuste-02'

export const ESPECES_PARC: readonly EspeceParc[] = [
  'arbre-01',
  'arbre-02',
  'arbuste-01',
  'arbuste-02',
]

export interface PlantationParc {
  espece: EspeceParc
  /** Position monde. `y` est l'altitude du terrain, pas celle du bâtiment. */
  position: Vec3
  /** Lacet, en radians. Deux arbres de la même essence ne se superposent pas. */
  rotation: number
  scale: number
}

/** Un segment d'allée, décrit par son axe et sa largeur. */
export interface Allee {
  a: { x: number; z: number }
  b: { x: number; z: number }
  largeur: number
}

export interface Parc {
  /** Emprise totale du terrain, centrée sur le bâtiment. */
  terrain: Rect
  /** Le parvis dur, autour du bâtiment. Aucune plantation n'y entre. */
  parvis: Rect
  allees: Allee[]
  plantations: PlantationParc[]
}

// ── Dimensions ───────────────────────────────────────────────────────────

/**
 * Débord du terrain autour du bâtiment, par côté.
 *
 * 40 m : assez pour que le bâtiment ait un horizon d'arbres depuis n'importe
 * quelle fenêtre, et assez peu pour que le terrain reste un parc et non une
 * plaine — au-delà, on voit le bord du monde depuis les étages.
 */
const DEBORD_TERRAIN = 40

/** Le parvis, mesuré depuis la façade. Un musée ne pousse pas dans l'herbe. */
const DEBORD_PARVIS = 5

/** Largeur des allées. 3 m pour la périphérique, 2,4 m pour les accès. */
const LARGEUR_PERIPHERIQUE = 3
const LARGEUR_ACCES = 2.4

/** Distance de l'allée périphérique au bord du parvis. */
const RETRAIT_PERIPHERIQUE = 6

/**
 * Rayon d'encombrement d'un sujet, pour ne pas le planter dans une allée ni
 * dans un autre. Ce sont des demi-largeurs de houppier, pas des rayons de tronc.
 */
const RAYON: Record<EspeceParc, number> = {
  'arbre-01': 3.2,
  'arbre-02': 2.8,
  'arbuste-01': 1.1,
  'arbuste-02': 0.9,
}

/** Densité : un sujet par cellule de grille, quand la cellule le permet. */
// 7,5 m donnait une trentaine de sujets, ce qui etait tenable quand un arbre
// pesait 6 000 triangles. A 22 000 — le prix reel d'un arbre qui a des feuilles
// — la meme densite passerait le budget geometrique a elle seule. On espace,
// et le parc y gagne : des arbres isoles et lisibles plutot qu'un rideau.
const PAS_GRILLE = 11

/**
 * Part d'arbustes dans le tirage. Un parc n'est pas une forêt : les arbustes
 * font la strate basse, qui est ce qui donne de la profondeur au sous-bois.
 */
// Davantage d'arbustes que d'arbres : ils coutent cinq fois moins et font la
// strate basse, qui est ce qui donne sa profondeur a un sous-bois.
const PART_ARBUSTES = 0.6

// ── Géométrie ────────────────────────────────────────────────────────────

function dansRect(r: Rect, x: number, z: number, marge = 0): boolean {
  return (
    x >= r.x - marge &&
    x <= r.x + r.width + marge &&
    z >= r.z - marge &&
    z <= r.z + r.depth + marge
  )
}

/** Distance d'un point au segment `[a, b]`. */
function distanceSegment(
  a: { x: number; z: number },
  b: { x: number; z: number },
  x: number,
  z: number,
): number {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len2 = dx * dx + dz * dz
  if (len2 < 1e-9) return Math.hypot(x - a.x, z - a.z)
  // Projection paramétrique, bornée au segment : au-delà des extrémités, c'est
  // la distance au bout et non à la droite support.
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2))
  return Math.hypot(x - (a.x + t * dx), z - (a.z + t * dz))
}

/** Vrai si le point empiète sur une allée, houppier compris. */
export function surUneAllee(allees: Allee[], x: number, z: number, rayon = 0): boolean {
  return allees.some((s) => distanceSegment(s.a, s.b, x, z) < s.largeur / 2 + rayon)
}

// ── Tracé ────────────────────────────────────────────────────────────────

/**
 * Les allées : une boucle autour du bâtiment, et quatre accès qui rejoignent
 * le bord du parc.
 *
 * La boucle est FERMÉE — le dernier segment reboucle sur le premier —, sans quoi
 * il resterait un coin ouvert par lequel les arbres viendraient couper le
 * chemin.
 */
export function tracerAllees(parvis: Rect, terrain: Rect): Allee[] {
  const r = RETRAIT_PERIPHERIQUE
  const xMin = parvis.x - r
  const xMax = parvis.x + parvis.width + r
  const zMin = parvis.z - r
  const zMax = parvis.z + parvis.depth + r

  const coins = [
    { x: xMin, z: zMin },
    { x: xMax, z: zMin },
    { x: xMax, z: zMax },
    { x: xMin, z: zMax },
  ]
  const allees: Allee[] = coins.map((a, i) => ({
    a,
    b: coins[(i + 1) % 4],
    largeur: LARGEUR_PERIPHERIQUE,
  }))

  // Quatre accès, au milieu de chaque côté, jusqu'au bord du terrain.
  const cx = parvis.x + parvis.width / 2
  const cz = parvis.z + parvis.depth / 2
  const bords: [{ x: number; z: number }, { x: number; z: number }][] = [
    [{ x: cx, z: zMin }, { x: cx, z: terrain.z }],
    [{ x: cx, z: zMax }, { x: cx, z: terrain.z + terrain.depth }],
    [{ x: xMin, z: cz }, { x: terrain.x, z: cz }],
    [{ x: xMax, z: cz }, { x: terrain.x + terrain.width, z: cz }],
  ]
  for (const [a, b] of bords) allees.push({ a, b, largeur: LARGEUR_ACCES })

  return allees
}

// ── Plantation ───────────────────────────────────────────────────────────

/**
 * Sème le parc autour d'une emprise de bâtiment.
 *
 * Grille jitterée plutôt que tirage uniforme : un tirage uniforme fait des
 * grappes et des clairières que l'œil lit comme une erreur, alors qu'une grille
 * perturbée donne la répartition irrégulière-mais-couvrante d'une plantation
 * réelle. Le jitter est ce qui empêche la grille de se voir.
 */
export function planterParc(footprint: Rect, graine = 'parc'): Parc {
  const parvis: Rect = {
    x: footprint.x - DEBORD_PARVIS,
    z: footprint.z - DEBORD_PARVIS,
    width: footprint.width + 2 * DEBORD_PARVIS,
    depth: footprint.depth + 2 * DEBORD_PARVIS,
  }
  const terrain: Rect = {
    x: footprint.x - DEBORD_TERRAIN,
    z: footprint.z - DEBORD_TERRAIN,
    width: footprint.width + 2 * DEBORD_TERRAIN,
    depth: footprint.depth + 2 * DEBORD_TERRAIN,
  }

  const allees = tracerAllees(parvis, terrain)
  const alea = generateur(graineDepuis(graine))
  const plantations: PlantationParc[] = []
  const poses: { x: number; z: number; rayon: number }[] = []

  const colonnes = Math.floor(terrain.width / PAS_GRILLE)
  const rangees = Math.floor(terrain.depth / PAS_GRILLE)

  for (let i = 0; i < colonnes; i++) {
    for (let j = 0; j < rangees; j++) {
      // Jitter sur les deux axes, jusqu'à 40 % de la maille : au-delà, deux
      // cellules voisines se recouvrent et la répartition redevient grumeleuse.
      const x = terrain.x + (i + 0.5) * PAS_GRILLE + (alea() - 0.5) * PAS_GRILLE * 0.8
      const z = terrain.z + (j + 0.5) * PAS_GRILLE + (alea() - 0.5) * PAS_GRILLE * 0.8

      const arbuste = alea() < PART_ARBUSTES
      const espece: EspeceParc = arbuste
        ? alea() < 0.5
          ? 'arbuste-01'
          : 'arbuste-02'
        : alea() < 0.5
          ? 'arbre-01'
          : 'arbre-02'
      const rayon = RAYON[espece]

      // Le parvis est dur : rien n'y pousse, et la marge du rayon empêche un
      // houppier de déborder au-dessus.
      if (dansRect(parvis, x, z, rayon)) continue
      if (!dansRect(terrain, x, z, -rayon)) continue
      if (surUneAllee(allees, x, z, rayon)) continue
      // Un sujet déjà posé interdit son propre encombrement.
      if (poses.some((p) => Math.hypot(p.x - x, p.z - z) < p.rayon + rayon)) continue

      poses.push({ x, z, rayon })
      plantations.push({
        espece,
        position: { x, y: 0, z },
        rotation: alea() * Math.PI * 2,
        // ±15 % de taille. Deux arbres identiques côte à côte se remarquent
        // immédiatement ; c'est le premier signe qu'une forêt est instanciée.
        scale: 0.85 + alea() * 0.3,
      })
    }
  }

  return { terrain, parvis, allees, plantations }
}
