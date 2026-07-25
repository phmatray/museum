/**
 * LOT 2 — Murs percés (spec §7.3 et §8), révisé au LOT 4 pour le §9.4.
 *
 * Un mur est un segment `[a, b]` du plan xz monté sur `height` mètres, dans
 * lequel les ouvertures découpent des passages. On le fabrique À PLAT — un
 * `THREE.Shape` dans le repère du mur, `u` = distance depuis `a`, `v` = hauteur
 * au-dessus du plancher — puis on l'extrude de `WALL_THICKNESS` et on redresse
 * le tout dans le monde. Raisonner à plat est ce qui rend les ouvertures
 * triviales : ce sont des encoches alignées sur les axes, pas des volumes à
 * soustraire.
 *
 * ── Ce que le §9.4 a changé, et POURQUOI ──
 *
 *  1. ÉPAISSEUR 0,20 → 0,32 m. Vingt centimètres, c'est une cloison ; le musée
 *     est en béton banché. Surtout, une tranche trop fine ne se voit pas depuis
 *     une porte, et un mur dont on ne voit jamais la tranche lit comme du carton
 *     découpé quelle que soit sa cote réelle.
 *
 *  2. OUVERTURES EN ENCOCHE, plus en trou. Toutes nos ouvertures descendent au
 *     plancher (`Opening` n'a pas d'allège), donc leur arête basse est confondue
 *     avec celle du mur. Les traiter comme des `Shape.holes` faisait produire à
 *     `ExtrudeGeometry` une facette horizontale parasite à `v = 0` en travers de
 *     chaque porte, EXACTEMENT coplanaire avec la face supérieure de la dalle :
 *     du z-fighting dans toutes les portes du bâtiment. En découpant l'encoche
 *     dans le CONTOUR, cette facette n'existe plus, et le seuil est réellement
 *     libre. Une ouverture qui monte jusqu'au plafond ne laisse aucun linteau :
 *     elle sépare alors le mur en plusieurs morceaux, chacun sa `Shape`.
 *
 *  3. CHANFREIN de 3 mm sur toutes les arêtes vives, via le biseau
 *     d'`ExtrudeGeometry` — le même mécanisme qui était le piège n°1 ci-dessous,
 *     ici enfin utilisé pour ce qu'il sait faire. Une arête parfaitement nette ne
 *     capte aucune lumière : elle rend le même pixel quel que soit l'éclairage et
 *     trahit le procédural au premier coup d'œil. Trois millimètres suffisent à
 *     lui donner une facette à 45° qui, elle, accroche.
 *
 *     Le biseau de three place les DEUX FACES sur le contour tel qu'on l'écrit et
 *     dilate le CŒUR de `bevelSize` — pas l'inverse. Conséquence heureuse : les
 *     faces du mur restent exactement `length × height`, l'accrochage des œuvres
 *     et l'aire percée sont inchangés au millimètre près, et seul le cœur déborde
 *     de 3 mm dans le volume des voisins (dalle, mur d'à côté), où il est par
 *     construction invisible. La bounding box, elle, mesure le cœur : elle vaut
 *     donc `length + 2·CHAMFER` sur `height + 2·CHAMFER`.
 *
 *  4. PLINTHE de 12 cm sur la face intérieure. Une jonction mur/sol nette et
 *     sans plinthe est un des signaux les plus forts du procédural : dans un
 *     bâtiment réel, quelque chose vient toujours masquer ce joint. Elle est
 *     interrompue au droit des ouvertures, et fait partie de la même géométrie —
 *     donc du même draw call.
 *
 * ── Les deux pièges d'`ExtrudeGeometry` (spec §8), tous deux SILENCIEUX ──
 *
 *  1. `bevelEnabled` vaut VRAI par défaut, avec un biseau de 0,2 m : un mur
 *     demandé en 10 × 4 × 0,2 sortait en 10,2 × 4,2 × 0,6. On l'active désormais
 *     volontairement, mais avec des cotes explicites (`CHAMFER`) et une
 *     profondeur diminuée d'autant, pour que l'épaisseur totale reste juste.
 *     Aucun test d'aire en 2D ne verrait un biseau qui dérape — seule la
 *     BOUNDING BOX 3D l'attrape, d'où les tests qui l'exigent au millimètre.
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
 * La plinthe, elle, saille de `PLINTH_PROJECTION` AU-DELÀ de la face intérieure :
 * c'est le seul élément qui dépasse de l'emprise du mur.
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
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Opening, Wall } from '../domain/types'

// ── Constantes ───────────────────────────────────────────────────────────

/** Épaisseur d'un mur, en mètres (spec §9.4). Béton banché, pas cloison. */
export const WALL_THICKNESS = 0.32

/**
 * Chanfrein des arêtes vives, en mètres (spec §9.4).
 *
 * Trois millimètres : assez pour qu'une facette à 45° existe et prenne la
 * lumière rasante, assez peu pour ne jamais se lire comme un pan coupé.
 */
export const CHAMFER = 0.003

/** Hauteur de la plinthe au pied de la face intérieure, en mètres. */
export const PLINTH_HEIGHT = 0.12

/** Saillie de la plinthe devant la face intérieure, en mètres. */
export const PLINTH_PROJECTION = 0.02

/**
 * De combien la plinthe s'enfonce DANS le mur, en mètres.
 *
 * Elle pourrait affleurer, mais son dos serait alors exactement coplanaire avec
 * la face du mur : deux surfaces confondues, latentes en z-fighting le jour où
 * un matériau passera en `DoubleSide`, et une face intérieure dont l'aire
 * mesurée ne serait plus celle du mur. Cinq millimètres de recouvrement coûtent
 * zéro pixel — le dos est dans la matière — et suppriment le problème.
 */
const PLINTH_EMBED = 0.005

/**
 * Tolérance géométrique. En deçà, deux cotes sont la même : c'est ce qui évite
 * les jambages d'un micromètre entre deux ouvertures jointives, dont la
 * triangulation ne saurait rien faire.
 */
const EPS = 1e-6

/**
 * Épaisseur minimale d'un linteau. En dessous, on considère que l'ouverture
 * monte au plafond et on SÉPARE le mur en deux morceaux.
 *
 * Le seuil ne peut pas être `EPS` : le chanfrein mange `CHAMFER` de chaque côté
 * du bandeau restant. Un linteau de 2 mm biseauté deux fois est une bande
 * d'épaisseur négative, c'est-à-dire un contour qui se croise lui-même — et
 * `ExtrudeGeometry` ne s'en plaint pas, il sort des triangles retournés.
 */
const MIN_LINTEL = 4 * CHAMFER

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
 * Deux ouvertures qui se chevauchent ne peuvent PAS devenir deux encoches
 * indépendantes : leurs contours se croiseraient et la triangulation échouerait
 * en silence, l'aire percée n'étant alors plus celle qu'on croit. On les fusionne
 * donc en un seul escalier, ce qui est exactement leur union.
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
 * ouverture est une ENCOCHE du contour et non un trou flottant — son arête basse
 * est confondue avec celle du mur. Le jour où le modèle gagnera une allège, il
 * faudra rouvrir de vrais `Shape.holes` ET leur donner un seuil ; le §9.4 le
 * prévoit (« le seuil pour les baies qui ne descendent pas au sol »), le modèle
 * de données pas encore.
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
 * Un morceau de mur d'un seul tenant : `[from, to]`, avec les encoches qu'il
 * porte. Une ouverture qui monte au plafond ne laisse pas de linteau, donc pas
 * de matière au-dessus d'elle : elle CASSE le mur en deux morceaux, qu'on ne
 * peut pas décrire par un contour unique sans le pincer.
 */
interface Piece {
  from: number
  to: number
  steps: Step[]
}

function wallPieces(length: number, height: number, groups: Step[][]): Piece[] {
  const pieces: Piece[] = []
  let debut = 0
  let steps: Step[] = []

  const fermer = (fin: number): void => {
    if (fin - debut > EPS) pieces.push({ from: debut, to: fin, steps })
    steps = []
  }

  for (const marches of groups.flat()) {
    if (height - marches.h < MIN_LINTEL) {
      fermer(marches.from) // coupe franche : rien ne relie les deux bords
      debut = marches.to
    } else {
      steps.push(marches)
    }
  }
  fermer(length)

  return pieces
}

/**
 * Le contour d'un morceau, parcouru dans le sens TRIGONOMÉTRIQUE : escalier du
 * bas (le plancher, remonté au droit de chaque ouverture), montant droit, retour
 * par le haut. Partir en sens horaire donnerait des faces retournées.
 *
 * Toutes les cotes sont VRAIES : c'est le biseau d'`ExtrudeGeometry` qui, seul,
 * dilatera le cœur de `CHAMFER`. Écrire ici des cotes déjà corrigées ferait
 * flotter les faces du mur de 3 mm au-dessus du sol, et le §9.4 y gagnerait un
 * jour de traque de fentes lumineuses.
 */
function pieceShape(piece: Piece, height: number): THREE.Shape {
  // Le profil bas : une hauteur par intervalle, 0 sur le plein.
  const profil: Step[] = []
  let u = piece.from
  for (const s of piece.steps) {
    if (s.from - u > EPS) profil.push({ from: u, to: s.from, h: 0 })
    profil.push(s)
    u = s.to
  }
  if (piece.to - u > EPS) profil.push({ from: u, to: piece.to, h: 0 })

  const points: THREE.Vector2[] = [new THREE.Vector2(piece.from, profil[0].h)]
  for (let i = 1; i < profil.length; i++) {
    points.push(new THREE.Vector2(profil[i].from, profil[i - 1].h))
    points.push(new THREE.Vector2(profil[i].from, profil[i].h))
  }
  points.push(new THREE.Vector2(piece.to, profil[profil.length - 1].h))
  points.push(new THREE.Vector2(piece.to, height))
  points.push(new THREE.Vector2(piece.from, height))

  return new THREE.Shape(points)
}

/**
 * Les tronçons de plinthe : le complément des ouvertures sur `[0, length]`.
 * Une plinthe qui traverserait une porte serait la première chose qu'on
 * remarque en la franchissant.
 */
function plinthSpans(length: number, groups: Step[][]): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  let u = 0
  for (const marches of groups) {
    const from = marches[0].from
    const to = marches[marches.length - 1].to
    if (from - u > EPS) spans.push([u, from])
    u = Math.max(u, to)
  }
  if (length - u > EPS) spans.push([u, length])
  return spans
}

// ── Assemblage ───────────────────────────────────────────────────────────

/**
 * Extrusion chanfreinée, en cotes vraies.
 *
 * `depth` est la profondeur TOTALE voulue : le biseau en consomme `CHAMFER` à
 * chaque extrémité, on ne demande donc à three que le reste. Le résultat occupe
 * `w ∈ [−CHAMFER, depth − CHAMFER]`, ce que l'appelant recale.
 */
function extrudeChanfreine(shapes: THREE.Shape[], depth: number): THREE.ExtrudeGeometry {
  return new THREE.ExtrudeGeometry(shapes, {
    depth: depth - 2 * CHAMFER,
    steps: 1,
    // ── Piège n°1 (spec §8) : le biseau par défaut vaut 0,2 m. Ici il est
    // choisi, et compensé sur `depth` pour que l'épaisseur totale reste juste.
    bevelEnabled: true,
    bevelThickness: CHAMFER,
    bevelSize: CHAMFER,
    bevelOffset: 0,
    bevelSegments: 1,
  })
}

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
 * pour ce qu'on heurte. Corps et plinthe sont fusionnés AVANT indexation : un
 * mur reste un seul `BufferGeometry`, donc un seul draw call, ce que le budget
 * du §9 compte.
 */
export function buildWall(wall: Wall): BuiltWall {
  const frame = wallFrame(wall)
  if (frame.length < EPS || wall.height <= EPS) return emptyWall()

  const groups = openingGroups(wall.openings, frame.length, wall.height)
  const pieces = wallPieces(frame.length, wall.height, groups)
  if (pieces.length === 0) return emptyWall() // entièrement percé : plus de mur

  // L'extrusion part toujours vers `+z` local. Quand cet axe regarde le dos du
  // mur, on RECULE les plaques au lieu de les mirroiter : un miroir retournerait
  // toutes les faces et inverserait le collider.
  const versLInterieur = frame.ez.dot(frame.inward) >= 0 ? 1 : -1

  const morceaux: THREE.BufferGeometry[] = []

  const corps = extrudeChanfreine(
    pieces.map((p) => pieceShape(p, wall.height)),
    WALL_THICKNESS,
  )
  // Sortie brute en `[−CHAMFER, T − CHAMFER]` : on la recale sur `[0, T]` ou
  // `[−T, 0]` selon le côté que regarde `ez`.
  corps.translate(0, 0, versLInterieur > 0 ? CHAMFER : CHAMFER - WALL_THICKNESS)
  morceaux.push(corps)

  const spans = plinthSpans(frame.length, groups)
  if (spans.length > 0 && wall.height > PLINTH_HEIGHT) {
    const plinthe = extrudeChanfreine(
      spans.map(([from, to]) =>
        new THREE.Shape([
          new THREE.Vector2(from, 0),
          new THREE.Vector2(to, 0),
          new THREE.Vector2(to, PLINTH_HEIGHT),
          new THREE.Vector2(from, PLINTH_HEIGHT),
        ]),
      ),
      PLINTH_PROJECTION + PLINTH_EMBED,
    )
    // Sa face vue est à `T + PLINTH_PROJECTION` du segment, son dos noyé de
    // `PLINTH_EMBED` dans le mur.
    plinthe.translate(
      0,
      0,
      versLInterieur > 0
        ? WALL_THICKNESS - PLINTH_EMBED + CHAMFER
        : CHAMFER - WALL_THICKNESS - PLINTH_PROJECTION,
    )
    morceaux.push(plinthe)
  }

  const brute = morceaux.length === 1 ? morceaux[0] : mergeGeometries(morceaux, false)!
  if (morceaux.length > 1) for (const m of morceaux) m.dispose()

  // ── Piège n°2 (spec §8) : `ExtrudeGeometry` ne produit aucun index. ──
  // La soudure garde les arêtes vives — deux sommets de normales différentes ne
  // fusionnent pas — donc les facettes du chanfrein restent lisibles.
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
