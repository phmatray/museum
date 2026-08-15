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
  /**
   * Les tronçons RÉELLEMENT posés, trémies de passage déduites.
   *
   * Rendus parce qu'ils sont la seule mesure honnête de ce que le garde-corps
   * protège : le nombre de sommets ne le dit pas — découper un segment en deux
   * en AJOUTE, alors même que la longueur protégée diminue.
   */
  segments: RailingSegment[]
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

/**
 * Épaisseur du panneau.
 *
 * 21 mm : c'est l'épaisseur réelle d'un feuilleté 10+10 de garde-corps, et
 * depuis que le panneau est en VERRE l'épaisseur se voit — c'est elle qui donne
 * la tranche vert pâle sur le chant, le seul endroit où une vitre montre sa
 * matière. Les 60 mm précédents étaient l'épaisseur d'un bahut plein, dont
 * personne n'aurait pu dire de quoi il était fait.
 */
const RAILING_THICKNESS = 0.021

/** Section carrée de la main courante, qui couronne le panneau. */
const HANDRAIL_SIZE = 0.08

/**
 * Index de groupe du PANNEAU — la vitre.
 *
 * ── Pourquoi le garde-corps est passé en verre ──
 *
 * La vue d'entrée du musée est barrée, sur toute sa largeur, par un bandeau
 * opaque de 1,10 m : le garde-corps de la trémie. Il masquait exactement ce que
 * le hall est censé donner à voir — le vide central, l'escalier, les étages. Et
 * il portait `Metal063`, un acier ROUILLÉ : sur vingt mètres de panneau, les
 * traînées d'oxyde s'étiraient en un dégradé bleu-orange qui lisait comme du
 * corten. Un musée contemporain n'a pas de corten autour de son atrium.
 *
 * Un garde-corps de verre est aussi la réponse ARCHITECTURALE juste : il est
 * réglementaire, il est ce qu'on met réellement autour d'un vide qu'on veut
 * montrer, et il rend au hall la profondeur que le bandeau lui prenait.
 *
 * Le panneau et la main courante étaient déjà deux boîtes distinctes ; il ne
 * manquait que les groupes pour leur donner deux matières. La main courante
 * RESTE métallique — une vitre sans couronnement se lit comme une erreur de
 * rendu, et c'est le métal qui dit où finit le verre.
 */
export const RAILING_GROUP_PANEL = 0

/** Index de groupe de la main courante. */
export const RAILING_GROUP_HANDRAIL = 1

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
/**
 * Une TRÉMIE dans le garde-corps : l'endroit où l'escalier arrive, et où il faut
 * donc pouvoir passer.
 *
 * Un cercle de centre `centre` et de rayon `rayon` : tout ce qui tombe dedans
 * est retiré du garde-corps. Un cercle et non un segment, parce que l'escalier
 * aborde la dalle sous un angle quelconque et qu'aucun côté de la trémie n'est
 * privilégié.
 */
export interface RailingGap {
  centre: Vec2
  rayon: number
}

/**
 * Découpe un segment de garde-corps par les trémies, et rend ce qui reste.
 *
 * On travaille en abscisse le long du segment : chaque trémie y projette un
 * intervalle, on retire l'union de ces intervalles.
 */
function decouperSegment(segment: RailingSegment, gaps: RailingGap[]): RailingSegment[] {
  const dx = segment.b.x - segment.a.x
  const dz = segment.b.z - segment.a.z
  const longueur = Math.hypot(dx, dz)
  if (longueur <= MIN_EXTENT) return []
  const ux = dx / longueur
  const uz = dz / longueur

  const trous: [number, number][] = []
  for (const g of gaps) {
    // Distance du centre à la droite support, et abscisse de sa projection.
    const t = (g.centre.x - segment.a.x) * ux + (g.centre.z - segment.a.z) * uz
    const px = segment.a.x + ux * t
    const pz = segment.a.z + uz * t
    const d = Math.hypot(g.centre.x - px, g.centre.z - pz)
    if (d >= g.rayon) continue
    // Demi-corde de l'intersection cercle/droite.
    const demi = Math.sqrt(g.rayon * g.rayon - d * d)
    trous.push([t - demi, t + demi])
  }
  if (trous.length === 0) return [segment]

  trous.sort((p, q) => p[0] - q[0])
  const restants: RailingSegment[] = []
  const au = (t: number): Vec2 => ({ x: segment.a.x + ux * t, z: segment.a.z + uz * t })
  let curseur = 0
  for (const [lo, hi] of trous) {
    if (lo > curseur + MIN_EXTENT) restants.push({ a: au(curseur), b: au(Math.min(lo, longueur)) })
    curseur = Math.max(curseur, hi)
    if (curseur >= longueur) break
  }
  if (longueur - curseur > MIN_EXTENT) restants.push({ a: au(curseur), b: au(longueur) })

  // Un moignon plus court qu'un passage d'homme n'est pas un garde-corps, c'est
  // un obstacle : on le jette plutôt que de le laisser en travers de l'accès.
  return restants.filter(
    (s) => Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z) > MIN_RAILING_SEGMENT,
  )
}

/** En dessous, un tronçon de garde-corps gêne le passage sans rien protéger. */
const MIN_RAILING_SEGMENT = 0.35

export function buildRailing(
  segments: RailingSegment[],
  height: number,
  gaps: RailingGap[] = [],
): RailingResult {
  if (height <= HANDRAIL_SIZE) {
    throw new RangeError(
      `buildRailing: hauteur (${height}) inférieure à la main courante (${HANDRAIL_SIZE})`,
    )
  }

  const panelHeight = height - HANDRAIL_SIZE
  // Deux listes et non une : la fusion doit produire des plages d'index
  // CONTIGUËS par matière, sinon un groupe ne peut pas les décrire. Alterner
  // panneau/main courante comme avant obligerait à un groupe par segment.
  const panneaux: THREE.BufferGeometry[] = []
  const mains: THREE.BufferGeometry[] = []

  /*
    LE GARDE-CORPS S'OUVRE LÀ OÙ L'ESCALIER ARRIVE.

    Sans ça il ceinture la trémie sur tout son périmètre — et comme l'escalier
    hélicoïdal est DANS la trémie, il devient purement et simplement
    inaccessible. Constaté sur le musée réel : la première marche est en
    (−4,8 ; 0), le vide va de −6 à 6, et le visiteur se tenait derrière
    1,10 m de garde-corps continu. Il n'y avait aucun moyen de monter d'un étage.

    C'est le genre de défaut qu'aucun test de géométrie n'attrape : chaque pièce
    était juste, c'est leur RENCONTRE qui ne l'était pas.
  */
  const ouverts =
    gaps.length === 0 ? segments : segments.flatMap((s) => decouperSegment(s, gaps))

  for (const segment of ouverts) {
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

    panneaux.push(
      orientedBox(length, panelHeight, RAILING_THICKNESS, cx, panelHeight / 2, cz, yaw),
    )
    mains.push(
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

  const geometry = mergeIndexed([...panneaux, ...mains])
  const indicesPanneaux = panneaux.reduce((n, p) => n + (p.getIndex()?.count ?? 0), 0)
  const indicesMains = mains.reduce((n, p) => n + (p.getIndex()?.count ?? 0), 0)
  if (indicesPanneaux > 0) {
    geometry.addGroup(0, indicesPanneaux, RAILING_GROUP_PANEL)
  }
  if (indicesMains > 0) {
    geometry.addGroup(indicesPanneaux, indicesMains, RAILING_GROUP_HANDRAIL)
  }

  /*
    Le COLLIDER, lui, ignore les groupes — et il le doit.

    Le verre est traversé par la lumière, pas par le visiteur. Un garde-corps
    dont on ne rendrait solide que la main courante laisserait tomber dans le
    vide quiconque marche à moins de 1,02 m du sol, c'est-à-dire tout le monde.
    La trimesh porte donc panneaux ET couronnement, exactement comme avant.
  */
  return { geometry, collider: toTrimesh(geometry), segments: ouverts }
}

// ── Palier ───────────────────────────────────────────────────────────────

/**
 * La plateforme qui relie le bord de la dalle à la première marche.
 *
 * ── Pourquoi elle est indispensable ──
 *
 * L'escalier est inscrit dans la trémie, son bord extérieur passe à 5,90 m de
 * l'axe et le bord du vide est à 6,00 m : il restait **10 cm de vide au-dessus
 * d'une chute de 4,70 m**, à franchir en montant une marche de 15 cm. Ouvrir le
 * garde-corps ne suffisait donc pas — mesuré en marchant : le visiteur arrivait
 * dans l'ouverture, voyait les marches devant lui, et s'arrêtait net.
 *
 * Aucun bâtiment ne se construit comme ça. Un escalier rencontre un plancher sur
 * un PALIER, et c'est ce que cette dalle est.
 *
 * Sa face supérieure est au niveau du plancher : on y arrive de plain-pied, et
 * la première contremarche reste la première contremarche.
 */
export function buildLanding(
  centre: Vec2,
  angle: number,
  largeur: number,
  epaisseur: number,
): SlabResult {
  // Le palier déborde vers l'EXTÉRIEUR de l'hélice, là où se trouve la dalle.
  // Un mètre : la trémie est carrée et l'escalier circulaire, si bien que la
  // distance du bord du vide varie selon l'angle. Trop court, le palier ne
  // rejoint pas la dalle dans les angles ; le recouvrement, lui, est sans effet
  // — les deux sont à la même altitude.
  const DEBORD = 1.2
  const demiLargeur = largeur / 2

  const shape = new THREE.Shape([
    new THREE.Vector2(-demiLargeur, 0),
    new THREE.Vector2(demiLargeur, 0),
    new THREE.Vector2(demiLargeur, DEBORD),
    new THREE.Vector2(-demiLargeur, DEBORD),
  ])

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: epaisseur,
    bevelEnabled: false,
    steps: 1,
  })
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, -epaisseur, 0)
  /*
    Le palier doit s'étendre le long du RAYON, vers l'extérieur de l'hélice —
    c'est de ce côté que se trouve la dalle. Écrit `rotateY(−angle)` du premier
    coup, il partait TANGENTIELLEMENT, à quatre-vingt-dix degrés du seul endroit
    utile, et le visiteur restait bloqué au même centimètre qu'avant.

    Après `rotateX(−π/2)`, le +v local regarde −z. On veut l'envoyer sur
    (cos a, sin a) : une rotation d'angle θ envoie (0, −v) sur (−v sin θ,
    −v cos θ), d'où −sin θ = cos a et −cos θ = sin a, soit θ = −(a + π/2).
  */
  geometry.rotateY(-(angle + Math.PI / 2))
  geometry.translate(centre.x, 0, centre.z)

  indexSequentially(geometry)
  groupByFacing(geometry)

  return { geometry, collider: toTrimesh(geometry), railingSegments: [] }
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
 *
 * Exporté parce que la soudure est la MÊME règle partout dans le bâtiment :
 * `builders/plinth.ts` la consomme. Une seconde copie divergerait à la première
 * correction appliquée d'un seul côté.
 */
export function toTrimesh(geometry: THREE.BufferGeometry): TrimeshCollider {
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
