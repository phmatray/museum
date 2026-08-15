/**
 * LOT 9 — Le DÉCOR d'architecture : ce qui tient au bâtiment, pas aux salles.
 *
 * Ce module décide OÙ se posent les pièces qui appartiennent à la STRUCTURE —
 * nervures d'atrium pour commencer. Il ne dessine rien : `scene/DecorLayer.tsx`
 * prend la liste et la fusionne. Comme tout ce qui vit dans `domain/`, il
 * n'importe ni `three` ni `react`.
 *
 * ── Pourquoi un module séparé de `props.ts` ──
 *
 * Ce n'est pas le même problème, et les mettre ensemble aurait mélangé deux
 * régimes qui ne se ressemblent pas :
 *
 *  - `props.ts` est un solveur par REJET. Il propose un banc, le teste contre la
 *    géométrie de la salle, et l'ABANDONNE s'il ne passe pas — « on préfère une
 *    salle un peu vide à une salle impraticable ». Une nervure d'atrium n'est pas
 *    un candidat : elle naît du nez de dalle, elle y est ou le bâtiment est faux.
 *  - `PropPlacement.rotation` est un LACET (un nombre) et `scale` un scalaire,
 *    parce que le mobilier ne tourne qu'autour de Y. Une pièce d'architecture
 *    bascule et s'étire : il lui faut trois axes. Élargir `PropPlacement`
 *    casserait `PropsLayer` et l'hypothèse sur laquelle repose
 *    `PropMetrics.radius`, qui dit explicitement qu'un rayon suffit « quel que
 *    soit le lacet ».
 *  - `PROP_IDS` est un contrat de LOTS D'INSTANCES : `PropsLayer` fait un
 *    `InstancedMesh` par entrée. Y verser les pièces de décor coûterait un draw
 *    call chacune, sur un compteur déjà à 259 pour un plafond de 150.
 *
 * Le précédent existe : `domain/park.ts` importe déjà `generateur` et
 * `graineDepuis` de `./props` et vit à côté. On fait pareil.
 *
 * ── Déterminisme ──
 *
 * Aucun `Math.random`, aucune horloge. Ce module est pour l'instant entièrement
 * régulier — les nervures sont réparties au pas constant — et le restera tant
 * qu'une variation n'apporte rien : une colonnade dont les fûts seraient
 * inégalement espacés ne lirait pas comme du hasard, elle lirait comme un défaut.
 */
import type { Museum, Rect, Vec3 } from './types'

// ── Contrat public ───────────────────────────────────────────────────────

export type DecorId = 'nervure-atrium'

/** Ordre canonique, contractuel comme `PROP_IDS`. */
export const DECOR_IDS: readonly DecorId[] = ['nervure-atrium']

export interface DecorPlacement {
  id: DecorId
  /** Position MONDE, élévation du niveau comprise. Même convention que `PropPlacement`. */
  position: Vec3
  /** Euler XYZ en radians — la convention de three et celle de la prop `rotation`. */
  rotation: Vec3
  /**
   * Échelle par AXE : c'est ce qui sépare une pièce d'architecture d'un meuble.
   * Une nervure s'étire sur sa portée, un banc non.
   *
   * ⛔ TOUJOURS strictement positive. Un déterminant négatif retournerait
   * l'enroulement des triangles — et dans un lot FUSIONNÉ, où toutes les pièces
   * partagent un seul matériau et un seul état de `side`, la pièce miroir
   * sortirait retournée sans que rien d'autre ne bouge. On miroite par une
   * rotation de π, jamais par un signe. Un test le vérifie.
   */
  scale: Vec3
  /** `null` pour ce qui n'appartient à aucun niveau. */
  floorId: string | null
}

/**
 * Emprise d'une pièce à l'échelle 1, mesurée sur le GLB.
 *
 * Mêmes conventions que `PropMetrics` : `radius` est le rayon du cylindre
 * englobant, `minY`/`maxY` sont relatifs au point d'ancrage.
 */
export interface DecorMetrics {
  radius: number
  minY: number
  maxY: number
  /**
   * Comment le joueur la rencontre. `null` = il la traverse, et c'est VOULU :
   * une nervure qui naît au-dessus de la tête est hors d'atteinte, lui donner un
   * collider ne ferait que charger la phase large de Rapier.
   */
  collision: 'cylindre' | null
}

/**
 * Mesuré sur le GLB réel par `metriquesDuNoeud`, jamais estimé — et l'épreuve
 * qui le vérifie a servi dès son premier passage.
 *
 * La première valeur écrite ici était `1.14`, prise sur la seule borne X du
 * fichier (±1,1398). C'était FAUX : le rayon du cylindre englobant se mesure
 * depuis l'origine dans le plan XZ, et la pièce déborde aussi en Z (±0,6722).
 * Le vrai rayon vaut `hypot(1.1398, 0.6722) = 1.3166`, soit **16 % de plus**.
 *
 * Une sous-estimation de rayon ne casse aucun test de placement — elle laisse
 * simplement la pièce entrer dans ce qu'elle aurait dû éviter, et ça ne se voit
 * qu'à l'écran, depuis le bon angle, si on passe par là. C'est exactement le
 * défaut que `glbBounds.ts` a été écrit pour fermer, et il l'a fermé.
 */
export const DECOR_METRICS: Record<DecorId, DecorMetrics> = {
  'nervure-atrium': { radius: 1.317, minY: 0, maxY: 4.31, collision: null },
}

// ── Réglages ─────────────────────────────────────────────────────────────

/**
 * Pas des nervures le long du pourtour de l'atrium, en mètres.
 *
 * 3 m sur les 48 m de pourtour donne seize nervures. Plus serré, elles
 * deviennent une palissade et ferment le vide qu'elles sont censées célébrer ;
 * plus lâche, le rythme se perd et chacune lit comme un accident.
 */
const PAS_NERVURE = 3

/**
 * Recul du pied de la nervure par rapport au bord de la trémie, en mètres.
 *
 * Négatif : la nervure est posée EN RETRAIT du vide, sur la dalle. Elle penche
 * ensuite au-dessus de l'atrium — c'est le porte-à-faux qui fait le geste — mais
 * son pied reste sur le plancher, là où il y a de quoi le porter.
 *
 * 0,55 m tient compte du garde-corps de la trémie (1,10 m de haut) : le pied de
 * la nervure se place DERRIÈRE lui, sans quoi les deux se traverseraient.
 */
const RECUL_NERVURE = 0.55

// ── Placement ────────────────────────────────────────────────────────────

/**
 * Toutes les pièces de décor du bâtiment.
 *
 * L'ordre est contractuel : il détermine l'ordre de fusion côté rendu, donc la
 * comparabilité de deux exécutions.
 */
export function placeDecor(museum: Museum): DecorPlacement[] {
  const placements: DecorPlacement[] = []
  for (const floor of museum.floors) {
    // Pas de nervures en réserve : elle est enterrée, sans trémie ouverte sur le
    // ciel, et une crypte en béton brut est une information, pas un oubli.
    if (floor.level < 0) continue
    for (const trou of floor.slabHoles) {
      placements.push(...nervuresDeTremie(floor.id, floor.elevation, trou))
    }
  }
  return placements
}

/**
 * Les nervures d'une trémie : un anneau de côtes qui penchent vers le vide.
 *
 * Chacune est tournée pour que son porte-à-faux regarde le CENTRE de la trémie.
 * Le modèle penche dans son axe local +X ; un lacet qui envoie ce +X vers le
 * centre suffit donc, et c'est pour ça que la pièce a été générée penchée plutôt
 * que droite — la faire pencher ici aurait demandé une rotation composée dont
 * l'emprise ne serait plus un cylindre.
 */
function nervuresDeTremie(floorId: string, elevation: number, trou: Rect): DecorPlacement[] {
  const cx = trou.x + trou.width / 2
  const cz = trou.z + trou.depth / 2
  const placements: DecorPlacement[] = []

  for (const point of pourtourDeTremie(trou, RECUL_NERVURE, PAS_NERVURE)) {
    // Le lacet qui envoie le +X local vers le centre de la trémie. Un lacet θ
    // envoie +X sur (cos θ, 0, −sin θ), d'où l'atan2 croisé.
    const rotation = Math.atan2(-(cz - point.z), cx - point.x)
    placements.push({
      id: 'nervure-atrium',
      position: { x: point.x, y: elevation, z: point.z },
      rotation: { x: 0, y: rotation, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      floorId,
    })
  }
  return placements
}

/**
 * Points régulièrement espacés sur le pourtour d'un rectangle agrandi.
 *
 * Le pas est RECALCULÉ par côté pour tomber juste : un pas constant appliqué
 * bêtement laisse un intervalle bâtard dans chaque angle, et c'est précisément
 * ce que l'œil lit comme une erreur sur une colonnade.
 */
function pourtourDeTremie(trou: Rect, recul: number, pas: number): { x: number; z: number }[] {
  const x0 = trou.x - recul
  const z0 = trou.z - recul
  const x1 = trou.x + trou.width + recul
  const z1 = trou.z + trou.depth + recul

  const points: { x: number; z: number }[] = []
  const parCote = Math.max(1, Math.round((x1 - x0) / pas))
  const parCoteZ = Math.max(1, Math.round((z1 - z0) / pas))

  for (let i = 0; i < parCote; i++) {
    const t = (i + 0.5) / parCote
    points.push({ x: x0 + (x1 - x0) * t, z: z0 })
    points.push({ x: x0 + (x1 - x0) * t, z: z1 })
  }
  for (let i = 0; i < parCoteZ; i++) {
    const t = (i + 0.5) / parCoteZ
    points.push({ x: x0, z: z0 + (z1 - z0) * t })
    points.push({ x: x1, z: z0 + (z1 - z0) * t })
  }
  return points
}
