/**
 * LOT 2 — Murs percés (spec §7.3 et §8).
 *
 * Un mur est un segment `[a, b]` du plan xz monté sur `height` mètres, dans
 * lequel les ouvertures découpent des passages. On le fabrique À PLAT — un
 * `THREE.Shape` dans le repère du mur, `u` = distance depuis `a`, `v` = hauteur
 * au-dessus du plancher — puis on l'extrude de 0,2 m et on redresse le tout dans
 * le monde. Raisonner à plat est ce qui rend les ouvertures triviales : ce sont
 * des rectangles alignés sur les axes, pas des volumes à soustraire.
 *
 * ── Les deux pièges d'`ExtrudeGeometry` (spec §8), tous deux SILENCIEUX ──
 *
 *  1. `bevelEnabled` vaut VRAI par défaut. Sans `bevelEnabled: false`, un mur
 *     demandé en 10 × 4 × 0,2 sort en 10,2 × 4,2 × 0,6 : il déborde de l'emprise,
 *     il est trois fois trop épais, et les murs voisins ne joignent plus. Aucun
 *     test d'aire en 2D ne le voit — l'aire de la face reste juste. Seule la
 *     BOUNDING BOX 3D l'attrape, d'où le test qui l'exige au millimètre.
 *
 *  2. La géométrie sort NON INDEXÉE (`geometry.index === null`), alors que
 *     `ColliderDesc.trimesh(vertices, indices)` de Rapier exige un tableau
 *     d'indices. Sans indexation explicite, le collider est vide et le joueur
 *     TRAVERSE le mur. On indexe donc par soudure (`mergeVertices`) avant de
 *     retourner quoi que ce soit, et le collider lit les mêmes tampons que la
 *     géométrie : ils ne peuvent pas diverger.
 *
 * ── Convention d'épaisseur ──
 *
 * Le segment `[a, b]` porte la face EXTÉRIEURE du mur, qui s'enfonce ensuite de
 * `WALL_THICKNESS` du côté de `normal`, c'est-à-dire vers l'intérieur de la
 * salle. Deux salles mitoyennes posent leur mur sur la même frontière mais de
 * part et d'autre : les deux volumes se touchent sans se recouvrir. Un mur
 * centré sur la frontière, lui, ferait coïncider exactement deux faces coplanaires
 * et donnerait le z-fighting classique sur toutes les cloisons du bâtiment.
 *
 * ── Repère de sortie ──
 *
 * x/z du monde, `y = 0` au plancher DU NIVEAU. Le composant R3F n'a plus qu'à
 * décaler de `floor.elevation`. Géométrie et collider partagent ce repère : on
 * ne peut pas déplacer l'un en oubliant l'autre.
 *
 * Aucun aléa, aucune horloge : deux appels sur le même mur produisent les mêmes
 * tampons, octet pour octet.
 */
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Opening, Wall } from '../domain/types'

// ── Constantes ───────────────────────────────────────────────────────────

/** Épaisseur d'un mur, en mètres (spec §8). */
export const WALL_THICKNESS = 0.2

/**
 * Tolérance géométrique. En deçà, deux cotes sont la même : c'est ce qui évite
 * les jambages d'un micromètre entre deux ouvertures jointives, dont la
 * triangulation ne saurait rien faire.
 */
const EPS = 1e-6

// ── Contrat public ───────────────────────────────────────────────────────

/** Maillage de collision, tel que `ColliderDesc.trimesh` le réclame. */
export interface ColliderMesh {
  vertices: Float32Array
  indices: Uint32Array
}

export interface BuiltWall {
  geometry: THREE.BufferGeometry
  collider: ColliderMesh
}

// ── Repère du mur ────────────────────────────────────────────────────────

interface WallFrame {
  length: number
  /** Axe `u` : direction `a → b`, unitaire. */
  ex: THREE.Vector3
  /** Troisième axe du repère, `ex × ey`. DIRECT, obligatoirement. */
  ez: THREE.Vector3
  /** Normale intérieure, exactement perpendiculaire à `ex`. */
  inward: THREE.Vector3
}

/**
 * Repère orthonormé du mur.
 *
 * La normale du contrat est arrondie au micromètre par `layout.ts` : on ne s'en
 * sert que pour choisir le CÔTÉ, jamais comme axe. La direction exacte est
 * recalculée depuis `a → b`, sinon le mur serait très légèrement gauchi et ses
 * faces ne seraient plus parallèles.
 *
 * Le repère est laissé DIRECT quoi qu'il arrive. Prendre la normale intérieure
 * comme troisième axe donnerait un repère indirect une fois sur deux, donc une
 * géométrie miroir : toutes les faces retournées, le mur éclairé par l'intérieur
 * et le collider inversé. On préfère décaler l'extrusion (voir `buildWall`).
 */
function wallFrame(wall: Wall): WallFrame {
  const dx = wall.b.x - wall.a.x
  const dz = wall.b.z - wall.a.z
  const length = Math.hypot(dx, dz)
  if (length < EPS) {
    return {
      length: 0,
      ex: new THREE.Vector3(1, 0, 0),
      ez: new THREE.Vector3(0, 0, 1),
      inward: new THREE.Vector3(0, 0, -1),
    }
  }

  const ex = new THREE.Vector3(dx / length, 0, dz / length)
  const ez = new THREE.Vector3(-ex.z, 0, ex.x) // = ex × (0,1,0)
  // Perpendiculaire canonique, celle que `layout.ts` produit : (dir.z, −dir.x).
  const perp = new THREE.Vector3(ex.z, 0, -ex.x)
  const inward = perp.dot(new THREE.Vector3(wall.normal.x, 0, wall.normal.z)) < 0 ? perp.negate() : perp

  return { length, ex, ez, inward }
}

/** Longueur du mur, en mètres. */
export function wallLength(wall: Wall): number {
  return Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z)
}

/**
 * Passage du repère du mur `(u, v, w)` au repère du niveau : `u` le long de
 * `a → b`, `v` vers le haut, `w` sur le troisième axe direct. Exportée parce que
 * l'accrochage et la scène en ont besoin pour poser une œuvre à `u` mètres de
 * `a` sans refaire cette trigonométrie chacun dans leur coin.
 */
export function wallMatrix(wall: Wall): THREE.Matrix4 {
  const { ex, ez } = wallFrame(wall)
  return new THREE.Matrix4()
    .makeBasis(ex, new THREE.Vector3(0, 1, 0), ez)
    .setPosition(wall.a.x, 0, wall.a.z)
}

// ── Découpe des ouvertures ───────────────────────────────────────────────

/** Une marche du profil d'une ouverture : `[from, to]` percé jusqu'à `h`. */
interface Step {
  from: number
  to: number
  h: number
}

/**
 * Profil d'un groupe d'ouvertures qui se touchent, c'est-à-dire l'enveloppe de
 * leurs hauteurs — le « skyline ».
 *
 * Deux ouvertures qui se chevauchent ne peuvent PAS devenir deux trous : deux
 * contours sécants font échouer la triangulation en silence et l'aire percée
 * n'est plus celle qu'on croit. On les fusionne donc en un seul contour en
 * escalier, ce qui est exactement leur union.
 */
function skyline(rects: Step[]): Step[] {
  const bornes = [...new Set(rects.flatMap((r) => [r.from, r.to]))].sort((a, b) => a - b)
  const steps: Step[] = []

  for (let i = 0; i + 1 < bornes.length; i++) {
    const from = bornes[i]
    const to = bornes[i + 1]
    let h = 0
    for (const r of rects) {
      if (r.from <= from + EPS && r.to >= to - EPS) h = Math.max(h, r.h)
    }
    if (h <= EPS) continue

    const precedente = steps[steps.length - 1]
    if (precedente && Math.abs(precedente.h - h) < EPS && Math.abs(precedente.to - from) < EPS) {
      precedente.to = to // même hauteur et jointive : une seule marche
    } else {
      steps.push({ from, to, h })
    }
  }

  return steps
}

/**
 * Les ouvertures, ramenées dans le mur puis regroupées par contact.
 *
 * `Opening` n'a pas d'allège : une ouverture part TOUJOURS du plancher et monte
 * à `height`. C'est vrai des portes comme des baies, et c'est ce qui fait qu'une
 * ouverture est une encoche du contour et non un trou flottant — son arête basse
 * est confondue avec celle du mur. `Earcut`, sous `ExtrudeGeometry`, sait ponter
 * ce cas sans produire de triangle dégénéré ; c'est vérifié par les tests, y
 * compris sur les vingt murs percés du musée réel.
 */
function openingGroups(openings: Opening[], length: number, height: number): Step[][] {
  const rects: Step[] = openings
    .map((o) => ({
      from: Math.max(0, Math.min(o.start, o.end)),
      to: Math.min(length, Math.max(o.start, o.end)),
      // Une ouverture plus haute que le mur le traverserait : on la plafonne,
      // le linteau devient nul et le mur se sépare proprement en deux jambages.
      h: Math.min(o.height, height),
    }))
    .filter((r) => r.to - r.from > EPS && r.h > EPS)
    .sort((a, b) => a.from - b.from || a.to - b.to)

  const groups: Step[][] = []
  let courant: Step[] = []
  let fin = -Infinity

  for (const r of rects) {
    if (courant.length > 0 && r.from > fin + EPS) {
      groups.push(skyline(courant))
      courant = []
    }
    courant.push(r)
    fin = Math.max(fin, r.to)
  }
  if (courant.length > 0) groups.push(skyline(courant))

  return groups.filter((s) => s.length > 0)
}

/**
 * Le mur à plat : contour rectangulaire, une encoche par groupe d'ouvertures.
 *
 * Le contour est parcouru dans le sens TRIGONOMÉTRIQUE. `ExtrudeGeometry`
 * n'harmonise l'orientation des trous que lorsqu'il a dû retourner le contour ;
 * partir en sens horaire laisserait donc les trous dans un sens arbitraire et
 * les faces de leurs jambages seraient retournées.
 */
function wallShape(length: number, height: number, groups: Step[][]): THREE.Shape {
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(length, 0)
  shape.lineTo(length, height)
  shape.lineTo(0, height)
  shape.closePath()

  for (const steps of groups) {
    const trou = new THREE.Path()
    trou.moveTo(steps[0].from, 0)
    trou.lineTo(steps[steps.length - 1].to, 0)
    // Retour par le haut, de droite à gauche, en suivant l'escalier.
    for (let i = steps.length - 1; i >= 0; i--) {
      trou.lineTo(steps[i].to, steps[i].h)
      trou.lineTo(steps[i].from, steps[i].h)
    }
    trou.closePath()
    shape.holes.push(trou)
  }

  return shape
}

// ── Assemblage ───────────────────────────────────────────────────────────

/** Mur dégénéré : rien à dessiner, mais un collider valide et vide. */
function emptyWall(): BuiltWall {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1))
  return {
    geometry,
    collider: { vertices: new Float32Array(0), indices: new Uint32Array(0) },
  }
}

/**
 * Le mur, prêt à être rendu et à être posé dans le monde physique.
 *
 * La géométrie est indexée — c'est une condition de survie du collider — et le
 * collider relit ses tampons : une seule source de vérité pour ce qu'on voit et
 * pour ce qu'on heurte.
 */
export function buildWall(wall: Wall): BuiltWall {
  const frame = wallFrame(wall)
  if (frame.length < EPS || wall.height <= EPS) return emptyWall()

  const groups = openingGroups(wall.openings, frame.length, wall.height)
  const shape = wallShape(frame.length, wall.height, groups)

  const brute = new THREE.ExtrudeGeometry(shape, {
    depth: WALL_THICKNESS,
    // ── Piège n°1 (spec §8) : sans ça, +0,2 m dans chaque direction. ──
    bevelEnabled: false,
    steps: 1,
  })

  // L'extrusion part toujours vers `+z` local. Quand cet axe regarde le dos du
  // mur, on recule la plaque d'une épaisseur pour qu'elle s'enfonce du côté de
  // la salle. Miroir interdit : il retournerait toutes les faces.
  if (frame.ez.dot(frame.inward) < 0) brute.translate(0, 0, -WALL_THICKNESS)

  // ── Piège n°2 (spec §8) : `ExtrudeGeometry` ne produit aucun index. ──
  // La soudure garde les arêtes vives — deux sommets de normales différentes ne
  // fusionnent pas — donc l'ombrage à facettes du mur est intact.
  const geometry = mergeVertices(brute)
  brute.dispose()
  geometry.applyMatrix4(wallMatrix(wall))

  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  // Ceinture et bretelles : plutôt la séquence identité qu'un collider vide,
  // qui serait un mur traversable sans le moindre message d'erreur.
  const indices = index
    ? new Uint32Array(index.array)
    : Uint32Array.from({ length: position.count }, (_, i) => i)
  if (!index) geometry.setIndex(new THREE.BufferAttribute(indices, 1))

  return {
    geometry,
    collider: { vertices: new Float32Array(position.array), indices },
  }
}
