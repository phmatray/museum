/**
 * LOT 2 — Dalles de plancher et garde-corps (spec §8).
 *
 * Une dalle est un rectangle troué : l'emprise du niveau, moins les trémies
 * (l'atrium en est une). On la construit en 2D avec `Shape` + `.holes`, puis on
 * l'extrude sur son épaisseur. Le garde-corps se génère sur le PÉRIMÈTRE DES
 * TROUS : c'est la seule chose qui empêche le joueur de tomber dans le vide, il
 * a donc un collider, pas seulement une géométrie.
 *
 * Deux pièges d'`ExtrudeGeometry` sont traités ici explicitement, parce qu'ils
 * échouent en silence :
 *
 *  - `bevelEnabled` vaut TRUE par défaut. Sans `bevelEnabled: false`, une dalle
 *    demandée en 20×20×0,4 sort en 20,2 m d'emprise et 0,8 m d'épaisseur : le
 *    chanfrein s'ajoute sur les quatre bords ET sur les deux faces. Aucun calcul
 *    d'aire en 2D ne le détecte, seule la bounding box 3D le voit.
 *  - La géométrie produite n'est PAS indexée (`geometry.index === null`), alors
 *    que `ColliderDesc.trimesh(vertices, indices)` exige des indices. Sans
 *    indexation, le collider est vide et le joueur traverse le sol. On indexe
 *    donc explicitement, des deux côtés : séquence `0..n-1` pour le rendu (les
 *    normales des arêtes vives doivent rester distinctes), sommets soudés pour
 *    la physique (les normales n'y existent pas, autant diviser le maillage).
 *
 * Repère : le monde est en XZ, la hauteur en Y. Le plan de la `Shape` est donc
 * une projection du sol, et la dalle est posée pour que sa FACE SUPÉRIEURE soit
 * en y = 0 — la surface de marche coïncide avec l'élévation du niveau, et la
 * scène n'a rien à corriger.
 *
 * Aucun aléa, aucune horloge : deux appels sur la même entrée produisent le
 * même maillage, sommet pour sommet.
 */
import * as THREE from 'three'

import type { Rect, Vec2 } from '../domain/types'

// ── Contrat public ───────────────────────────────────────────────────────

/** Maillage de collision au format attendu par `ColliderDesc.trimesh`. */
export interface TrimeshCollider {
  /** Positions à plat, 3 flottants par sommet. */
  vertices: Float32Array
  /** Triangles, 3 indices par face. Jamais `null`, jamais un `Uint16Array`. */
  indices: Uint32Array
}

/** Un segment horizontal du périmètre d'une trémie. */
export interface RailingSegment {
  a: Vec2
  b: Vec2
}

export interface SlabResult {
  geometry: THREE.BufferGeometry
  collider: TrimeshCollider
  /** Périmètre des trémies, à passer tel quel à `buildRailing`. */
  railingSegments: RailingSegment[]
}

export interface RailingResult {
  geometry: THREE.BufferGeometry
  collider: TrimeshCollider
}

// ── Constantes ───────────────────────────────────────────────────────────

/**
 * Index de groupe de la face SUPÉRIEURE de la dalle — le sol du niveau.
 *
 * Une dalle a deux faces que rien ne rapproche : on marche sur l'une, l'autre
 * est le plafond du niveau du dessous. Un seul matériau pour les deux donnait un
 * plafond en lames de parquet et un bandeau de bois en façade sur toute la
 * hauteur du bâtiment — le défaut visuel dominant du premier jet.
 *
 * `ExtrudeGeometry` ne sait pas les distinguer : ses deux groupes natifs sont
 * « les capots » (dessus ET dessous confondus) et « les côtés ». On refait donc
 * le découpage sur le signe de la normale.
 */
export const SLAB_GROUP_TOP = 0

/** Index de groupe de la tranche et de la sous-face : un seul et même béton. */
export const SLAB_GROUP_SHELL = 1

/**
 * Seuil de classement d'un triangle en « tourné vers le haut ». Les faces d'une
 * dalle extrudée sont franchement axiales — normale à ±1 en Y, ou strictement
 * horizontale — donc n'importe quelle valeur entre 0 et 1 séparerait les mêmes
 * triangles. On prend 0,5 pour que le classement reste juste si un jour la dalle
 * gagne une pente.
 */
const TOP_FACING = 0.5

/** Hauteur réglementaire d'un garde-corps, main courante comprise. */
export const RAILING_HEIGHT = 1.1

/** Épaisseur du panneau. Assez fin pour être discret, assez épais pour exister. */
const RAILING_THICKNESS = 0.06

/** Section carrée de la main courante, qui couronne le panneau. */
const HANDRAIL_SIZE = 0.08

/**
 * Quantum de soudure des sommets du collider, en mètres. Les positions sont
 * stockées en float32 : deux sommets « identiques » diffèrent d'environ 1e-7.
 * Un dixième de millimètre absorbe cette erreur sans jamais fusionner deux
 * sommets réellement distincts, nos coordonnées étant au pire au centimètre.
 */
const WELD_QUANTUM = 1e-4

/** En dessous, un segment ou un rectangle est du bruit numérique : on l'ignore. */
const MIN_EXTENT = 1e-6

// ── Dalle ────────────────────────────────────────────────────────────────

/**
 * Construit la dalle d'un niveau : `footprint` moins les trémies `holes`,
 * extrudée sur `thickness`.
 *
 * Les trous dégénérés (largeur ou profondeur nulle) sont ignorés plutôt que
 * refusés : la disposition peut en produire à la marge, et un trou de zéro mètre
 * carré n'a aucune conséquence sur le plancher.
 */
export function buildSlab(footprint: Rect, holes: Rect[], thickness: number): SlabResult {
  if (thickness <= 0) {
    throw new RangeError(`buildSlab: épaisseur non positive (${thickness})`)
  }
  if (footprint.width <= MIN_EXTENT || footprint.depth <= MIN_EXTENT) {
    throw new RangeError(
      `buildSlab: emprise dégénérée (${footprint.width}×${footprint.depth})`,
    )
  }

  const usableHoles = holes.filter(
    (hole) => hole.width > MIN_EXTENT && hole.depth > MIN_EXTENT,
  )

  // Le contour extérieur est parcouru dans le sens trigonométrique du plan de la
  // Shape, les trous dans le sens inverse. `ExtrudeGeometry` renormalise de toute
  // façon, mais un contour explicite évite d'avoir à le vérifier à chaque montée
  // de version de three.
  const shape = new THREE.Shape(rectToShapePoints(footprint))
  for (const hole of usableHoles) {
    shape.holes.push(new THREE.Path(rectToShapePoints(hole).reverse()))
  }

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    // LE point critique : sans ça, l'emprise et l'épaisseur sont fausses.
    bevelEnabled: false,
    // Un seul pas suffit : les faces latérales sont planes, subdiviser
    // n'ajouterait que des triangles à faire calculer au collider.
    steps: 1,
  })

  // Passage du plan de la Shape au repère du monde : l'extrusion monte le long
  // de +Z, on la bascule pour qu'elle monte le long de +Y. Voir `rectToShapePoints`
  // pour la convention (u, v) = (x, −z) qui rend cette rotation exacte.
  geometry.rotateX(-Math.PI / 2)
  // Face supérieure en y = 0 : la dalle pend sous l'élévation du niveau.
  geometry.translate(0, -thickness, 0)

  indexSequentially(geometry)
  groupByFacing(geometry)

  return {
    geometry,
    collider: toTrimesh(geometry),
    railingSegments: usableHoles.flatMap(rectPerimeter),
  }
}

/**
 * Range les triangles en deux groupes de matériau : dessus d'abord, tranche et
 * sous-face ensuite.
 *
 * Un groupe est une PLAGE CONTIGUË de l'index, pas un ensemble : séparer les
 * deux faces impose donc de réordonner l'index. C'est sans effet ailleurs — les
 * positions et les normales ne bougent pas, et le collider ne lit que l'ensemble
 * des triangles, pas leur ordre.
 */
function groupByFacing(geometry: THREE.BufferGeometry): void {
  const index = geometry.getIndex()
  const normal = geometry.getAttribute('normal')
  if (!index || !normal) return

  const dessus: number[] = []
  const coque: number[] = []

  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i)
    const b = index.getX(i + 1)
    const c = index.getX(i + 2)
    // Moyenne des trois normales de sommet plutôt que la normale géométrique :
    // elle est déjà calculée, et sur des faces planes les deux coïncident.
    const ny = (normal.getY(a) + normal.getY(b) + normal.getY(c)) / 3
    ;(ny > TOP_FACING ? dessus : coque).push(a, b, c)
  }

  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array([...dessus, ...coque]), 1))
  // `ExtrudeGeometry` a posé ses propres groupes (capots / côtés) : les laisser
  // en place ferait rendre la dalle deux fois, avec les mauvaises plages.
  geometry.clearGroups()
  geometry.addGroup(0, dessus.length, SLAB_GROUP_TOP)
  geometry.addGroup(dessus.length, coque.length, SLAB_GROUP_SHELL)
}

// ── Garde-corps ──────────────────────────────────────────────────────────

/**
 * Construit le garde-corps d'une liste de segments — typiquement le
 * `railingSegments` d'une dalle. Chaque segment donne un panneau vertical
 * couronné d'une main courante ; l'ensemble mesure exactement `height`, main
 * courante comprise, pour que la hauteur demandée soit la hauteur obtenue.
 *
 * Le résultat est un seul maillage : un garde-corps de quatre côtés doit coûter
 * un draw call, pas quatre (budget de rendu, spec §9).
 */
export function buildRailing(
  segments: RailingSegment[],
  height: number,
): RailingResult {
  if (height <= HANDRAIL_SIZE) {
    throw new RangeError(
      `buildRailing: hauteur (${height}) inférieure à la main courante (${HANDRAIL_SIZE})`,
    )
  }

  const panelHeight = height - HANDRAIL_SIZE
  const parts: THREE.BufferGeometry[] = []

  for (const segment of segments) {
    const dx = segment.b.x - segment.a.x
    const dz = segment.b.z - segment.a.z
    const length = Math.hypot(dx, dz)
    if (length <= MIN_EXTENT) continue

    // La boîte est créée le long de son axe X local, puis pivotée autour de Y
    // pour épouser le segment. Une rotation d'angle θ envoie +X sur
    // (cos θ, 0, −sin θ), d'où θ = atan2(−dz, dx).
    const yaw = Math.atan2(-dz, dx)
    const cx = (segment.a.x + segment.b.x) / 2
    const cz = (segment.a.z + segment.b.z) / 2

    parts.push(
      orientedBox(length, panelHeight, RAILING_THICKNESS, cx, panelHeight / 2, cz, yaw),
    )
    parts.push(
      orientedBox(
        length,
        HANDRAIL_SIZE,
        HANDRAIL_SIZE,
        cx,
        height - HANDRAIL_SIZE / 2,
        cz,
        yaw,
      ),
    )
  }

  const geometry = mergeIndexed(parts)
  return { geometry, collider: toTrimesh(geometry) }
}

// ── Outils géométriques ──────────────────────────────────────────────────

/**
 * Contour d'un rectangle dans le plan de la `Shape`.
 *
 * La convention est (u, v) = (x, −z). Le signe est ce qui rend la bascule
 * `rotateX(−π/2)` exacte : cette rotation envoie (u, v, w) sur (u, w, −v), donc
 * v = −z redonne bien z. Sans ce signe, la dalle serait construite en miroir et
 * un trou décentré tomberait du mauvais côté du bâtiment.
 *
 * Les points sont ordonnés dans le sens trigonométrique du plan (u, v).
 */
function rectToShapePoints(rect: Rect): THREE.Vector2[] {
  const { x, z, width, depth } = rect
  return [
    new THREE.Vector2(x, -z),
    new THREE.Vector2(x, -z - depth),
    new THREE.Vector2(x + width, -z - depth),
    new THREE.Vector2(x + width, -z),
  ]
}

/**
 * Les quatre côtés d'un rectangle, dans le monde. Parcours fermé : le point `b`
 * d'un segment est le point `a` du suivant, et le dernier reboucle sur le
 * premier — un garde-corps ne doit pas avoir de coin ouvert.
 */
function rectPerimeter(rect: Rect): RailingSegment[] {
  const { x, z, width, depth } = rect
  const c0 = { x, z }
  const c1 = { x: x + width, z }
  const c2 = { x: x + width, z: z + depth }
  const c3 = { x, z: z + depth }
  return [
    { a: c0, b: c1 },
    { a: c1, b: c2 },
    { a: c2, b: c3 },
    { a: c3, b: c0 },
  ]
}

/** Boîte de dimensions données, tournée autour de Y puis posée à un centre. */
function orientedBox(
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  cx: number,
  cy: number,
  cz: number,
  yaw: number,
): THREE.BufferGeometry {
  const box = new THREE.BoxGeometry(sizeX, sizeY, sizeZ)
  box.rotateY(yaw)
  box.translate(cx, cy, cz)
  return box
}

/**
 * Donne à une géométrie non indexée l'index trivial `0..n-1`.
 *
 * On ne soude PAS les sommets ici : `ExtrudeGeometry` duplique volontairement
 * les positions aux arêtes vives pour leur donner des normales différentes, et
 * les fusionner arrondirait les angles de la dalle. La soudure n'a de sens que
 * pour le collider, qui ignore les normales — voir `toTrimesh`.
 */
function indexSequentially(geometry: THREE.BufferGeometry): void {
  if (geometry.getIndex() !== null) return
  const count = geometry.getAttribute('position').count
  const indices = new Uint32Array(count)
  for (let i = 0; i < count; i++) indices[i] = i
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
}

/**
 * Extrait le maillage de collision d'une géométrie, en soudant les sommets
 * coïncidents. Rapier n'utilise que les positions : garder les doublons ne
 * ferait qu'alourdir la structure d'accélération du trimesh.
 */
function toTrimesh(geometry: THREE.BufferGeometry): TrimeshCollider {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const source = index
    ? Array.from({ length: index.count }, (_, i) => index.getX(i))
    : Array.from({ length: position.count }, (_, i) => i)

  const vertices: number[] = []
  const indices: number[] = []
  const seen = new Map<string, number>()

  for (const vertexId of source) {
    const x = position.getX(vertexId)
    const y = position.getY(vertexId)
    const z = position.getZ(vertexId)
    const key = `${quantise(x)}|${quantise(y)}|${quantise(z)}`
    let welded = seen.get(key)
    if (welded === undefined) {
      welded = vertices.length / 3
      seen.set(key, welded)
      vertices.push(x, y, z)
    }
    indices.push(welded)
  }

  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) }
}

function quantise(value: number): number {
  // `+ 0` neutralise le −0, qui donnerait une clé distincte de celle de 0.
  return Math.round(value / WELD_QUANTUM) + 0
}

/**
 * Concatène des géométries indexées partageant les mêmes attributs. Les boîtes
 * de `BoxGeometry` remplissent toujours ce contrat ; on reste donc volontairement
 * minimal plutôt que d'importer `BufferGeometryUtils`, qui vit dans
 * `three/examples` et n'a pas sa place dans un module de domaine.
 */
function mergeIndexed(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = new THREE.BufferGeometry()
  const names = ['position', 'normal', 'uv'] as const

  if (parts.length === 0) {
    // Une géométrie vide reste une géométrie valide : index non nul, zéro face.
    for (const name of names) {
      const itemSize = name === 'uv' ? 2 : 3
      merged.setAttribute(name, new THREE.BufferAttribute(new Float32Array(0), itemSize))
    }
    merged.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1))
    return merged
  }

  for (const name of names) {
    const itemSize = parts[0].getAttribute(name).itemSize
    const total = parts.reduce((sum, part) => sum + part.getAttribute(name).count, 0)
    const data = new Float32Array(total * itemSize)
    let offset = 0
    for (const part of parts) {
      const attribute = part.getAttribute(name)
      for (let i = 0; i < attribute.count; i++) {
        for (let c = 0; c < itemSize; c++) {
          data[offset++] = attribute.array[i * attribute.itemSize + c] as number
        }
      }
    }
    merged.setAttribute(name, new THREE.BufferAttribute(data, itemSize))
  }

  const totalIndices = parts.reduce((sum, part) => sum + (part.getIndex()?.count ?? 0), 0)
  const indices = new Uint32Array(totalIndices)
  let cursor = 0
  let vertexOffset = 0
  for (const part of parts) {
    const partIndex = part.getIndex()
    if (partIndex) {
      for (let i = 0; i < partIndex.count; i++) {
        indices[cursor++] = partIndex.getX(i) + vertexOffset
      }
    }
    vertexOffset += part.getAttribute('position').count
  }
  merged.setIndex(new THREE.BufferAttribute(indices, 1))

  return merged
}
