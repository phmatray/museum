/**
 * LOT 2 — La rampe hélicoïdale (spec §7.5, §8).
 *
 * Une hélice autour du vide de l'atrium, du niveau `n` au niveau `n+1`. Le
 * `Ramp` est une DONNÉE calculée par `domain/layout.ts` ; ce module n'en décide
 * rien, il l'habille de triangles et de boîtes de collision.
 *
 * Trois partis pris portent tout le fichier :
 *
 *  1. **Le tablier est balayé à la main, pas extrudé.** `ExtrudeGeometry`
 *     extrude une section le long d'une droite (ou d'une courbe, via
 *     `extrudePath`, qui impose alors des repères de Frenet vrillés) : une
 *     hélice n'est ni l'un ni l'autre, on la balaye station par station. Cela
 *     nous évite au passage les deux pièges du spec §8 — encore faut-il ne pas
 *     les réintroduire, d'où les deux règles suivantes.
 *
 *  2. **Aucun gonflement d'emprise.** Le chanfrein d'`ExtrudeGeometry`
 *     (`bevelEnabled: true` par défaut) ajoute 0,1 m de débord et double
 *     l'épaisseur. Ici l'emprise est exactement `radius ± width/2` et
 *     l'épaisseur exactement `RAMP_DECK_THICKNESS` : la *bounding box* 3D le
 *     prouve, une mesure d'aire en 2D ne l'aurait pas vu.
 *
 *  3. **La géométrie est INDEXÉE, en `Uint32Array`.** `ColliderDesc.trimesh()`
 *     exige des indices ; une géométrie non indexée (`geometry.index === null`,
 *     ce que produit `ExtrudeGeometry`) donne un collider vide et le joueur
 *     traverse le sol. Le tablier n'utilise pas de trimesh — sa collision est
 *     convexe, cf. plus bas — mais tout consommateur en aval doit pouvoir en
 *     dériver un sans se faire piéger.
 *
 * **La collision est une décomposition en convexes**, pas un trimesh (spec
 * §7.5) : le `KinematicCharacterController` de Rapier grimpe proprement une
 * suite de cuboids inclinés, alors qu'il accroche aux arêtes d'un maillage de
 * collision. Une boîte orientée par pas de ~10° de balayage, avec recouvrement
 * explicite aux jonctions.
 *
 * Déterminisme total : aucune horloge, aucun aléa, aucun état global.
 */
import * as THREE from 'three'

import type { Ramp, Vec3 } from '../domain/types'

// ── Contrat public ───────────────────────────────────────────────────────

/**
 * Boîte orientée, dans le repère monde.
 *
 * `rotation` est un triplet d'Euler dans l'ordre **XYZ**, la convention par
 * défaut de three et celle qu'attend la prop `rotation` de
 * `@react-three/rapier`. La composition vaut `Ry(lacet) · Rz(pente)` : le
 * lacet oriente la boîte le long de la tangente, la pente la bascule vers le
 * haut autour de son axe latéral.
 */
export interface OrientedBox {
  position: Vec3
  rotation: [number, number, number]
  halfExtents: Vec3
}

export interface RampBuild {
  /** Le tablier : dalle hélicoïdale fermée, indexée. */
  geometry: THREE.BufferGeometry
  /** Décomposition convexe du tablier (spec §7.5). */
  colliders: OrientedBox[]
  /** Les deux garde-corps, fusionnés en un seul maillage (un seul draw call). */
  railingGeometry: THREE.BufferGeometry
  /**
   * Les garde-corps sont SOLIDES : sans eux le joueur bascule dans l'atrium
   * depuis la rampe. Ce sont des boîtes verticales, pas inclinées.
   */
  railingColliders: OrientedBox[]
  /** Pente réelle, en degrés. Diagnostic : au-delà de 40° la rampe est refusée. */
  slopeDegrees: number
  /** Anomalies non bloquantes, dans l'esprit de `Museum.warnings`. */
  warnings: string[]
}

// ── Constantes de construction ───────────────────────────────────────────

/** Épaisseur du limon. Une dalle de béton, pas une feuille de papier. */
export const RAMP_DECK_THICKNESS = 0.25

/**
 * Hauteur de marche visée.
 *
 * ── Pourquoi cet ouvrage a des marches ──
 *
 * Il était lisse, et se nommait « rampe ». Mesuré sur le musée réel : 4,70 m de
 * montée pour 15,08 m d'arc, soit **17,3° — 31 % de dénivelé**. Une rampe
 * accessible plafonne à 6 % ; à 31 % on est cinq fois au-dessus, et personne ne
 * construit ça. Un plan incliné à 31 % qu'on gravit à pied, dans un bâtiment
 * par ailleurs réaliste, se lit immédiatement comme une incohérence : c'est un
 * escalier auquel on a oublié les marches.
 *
 * 15 cm de contremarche pour 48 cm de giron : c'est un ESCALIER MONUMENTAL, la
 * proportion des emmarchements de musée et de palais, et c'est exactement ce
 * que 31 % de pente veut dire quand on la traduit en marches. Un escalier
 * courant (17/28) exigerait une pente de 60 %, donc un tout autre bâtiment.
 */
const TARGET_RISER = 0.15

/**
 * En dessous, l'ouvrage est trop plat pour être marché : une contremarche de
 * quelques centimètres est un piège, pas une marche. On le laisse alors lisse —
 * ce qui est le bon geste, puisqu'à cette pente c'est une vraie rampe.
 */
const MIN_RISER = 0.08

/** Pas angulaire du maillage : 4°, soit 45 stations sur un demi-tour. */
const GEOMETRY_STEP = (4 * Math.PI) / 180

/** Pas angulaire des colliders — « un cuboid incliné par pas de 10° » (spec §7.5). */
export const COLLIDER_STEP = (10 * Math.PI) / 180

/**
 * Rallonge tangentielle ajoutée à chaque boîte, en mètres.
 *
 * Deux boîtes qui se touchent exactement laissent, au flottant près, une arête
 * vive où le personnage accroche. Le recouvrement est donc EXPLICITE et non
 * laissé au hasard de la géométrie (qui en fournit déjà un peu, la corde
 * extérieure étant plus longue que la corde médiane).
 */
export const COLLIDER_OVERLAP = 0.06

/** Garde-corps réglementaire (spec §8). */
export const RAILING_HEIGHT = 1.1
export const RAILING_THICKNESS = 0.06

/**
 * Le `KinematicCharacterController` bloque à 45° ; le spec §7.5 impose de
 * tester sous 40°, pour garder la marge. Au-delà, on construit quand même —
 * un bâtiment à moitié dessiné est pire qu'un bâtiment signalé — mais on le
 * dit dans `warnings`.
 */
export const RAMP_MAX_SLOPE_DEG = 40

/**
 * En deçà, le bord intérieur de l'hélice traverse son propre axe : la surface
 * se replie et les normales s'inversent.
 */
const MIN_INNER_RADIUS = 0.05

// ── Maillage : accumulateur de quadrilatères ─────────────────────────────

interface MeshBuffer {
  positions: number[]
  indices: number[]
}

/**
 * Chaque quadrilatère porte ses PROPRES sommets, jamais partagés avec la face
 * voisine : une dalle a des arêtes vives, et des normales moyennées aux coins
 * donneraient un tablier savonneux. Le coût est de 4 sommets par face au lieu
 * d'un maillage soudé — négligeable devant le budget du spec §9.
 *
 * `pivot` choisit la diagonale de découpe. Sur un hélicoïde, les faces d'une
 * même tranche ne sont PAS planes : dessus et dessous découpés selon des
 * diagonales opposées se bombent en sens contraire et le solide gagne du
 * volume au lieu d'être un prisme. Les deux faces radiales partagent donc la
 * même diagonale, et le tablier retrouve exactement l'épaisseur demandée.
 */
function pushQuad(
  mesh: MeshBuffer,
  a: Vec3,
  b: Vec3,
  c: Vec3,
  d: Vec3,
  flip: boolean,
  pivot: 0 | 1 = 0,
): void {
  const base = mesh.positions.length / 3
  const coins = flip ? [a, d, c, b] : [a, b, c, d]
  for (const p of coins) mesh.positions.push(p.x, p.y, p.z)
  // La diagonale est la même liste inversée ou non : [a,b,c,d] coupé en a–c
  // devient [a,d,c,b] coupé en a–c. `flip` ne change que le sens des faces.
  if (pivot === 0) {
    mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  } else {
    mesh.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base)
  }
}

function toGeometry(mesh: MeshBuffer): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.positions), 3))
  // Indexation explicite en Uint32Array : c'est le format exigé par
  // `ColliderDesc.trimesh`, et le piège n°2 du spec §8.
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.indices), 1))
  geometry.computeVertexNormals()
  projeterUvEnBoite(geometry)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * Projette des UV en MÈTRES depuis la position, sur l'axe dominant de chaque
 * normale.
 *
 * ── Pourquoi ce n'est pas facultatif ──
 *
 * Le balayage hélicoïdal ne produisait que des positions. Une géométrie sans
 * attribut `uv` n'échantillonne pas « rien » : elle échantillonne le texel
 * (0, 0), c'est-à-dire un aplat de la couleur du coin haut-gauche de la carte.
 * Toute matière texturée posée sur la rampe sortait donc en aplat, ce qui est
 * précisément ce à quoi ressemblait le garde-corps.
 *
 * ── Pourquoi une projection et pas un vrai dépliage ──
 *
 * Le dépliage naturel d'une hélice est (abscisse curviligne, position dans le
 * profil). Il faudrait le porter à travers tout le balayage, alors qu'une rampe
 * en béton n'a pas de motif directionnel : sur du béton banché et du métal
 * brossé, la projection en boîte est indiscernable d'un dépliage — ses coutures
 * ne tombent que là où la normale change d'axe dominant, c'est-à-dire sur des
 * arêtes vives déjà marquées.
 *
 * Les UV sont en mètres, comme ceux d'`ExtrudeGeometry` : l'échelle se règle
 * ensuite avec `repetitionMetrique`, sans que l'appelant ait à savoir d'où vient
 * la géométrie.
 */
function projeterUvEnBoite(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  if (!position || !normal) return

  const uv = new Float32Array(position.count * 2)
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const ax = Math.abs(normal.getX(i))
    const ay = Math.abs(normal.getY(i))
    const az = Math.abs(normal.getZ(i))

    let u: number
    let v: number
    if (ay >= ax && ay >= az) {
      // Face horizontale — le tablier. On la déplie à plat, vue de dessus.
      u = x
      v = z
    } else if (ax >= az) {
      // Face tournée vers ±X : la hauteur reste en V, pour qu'un motif
      // directionnel monte bien à la verticale.
      u = z
      v = y
    } else {
      u = x
      v = y
    }
    uv[i * 2] = u
    uv[i * 2 + 1] = v
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

// ── Balayage hélicoïdal ──────────────────────────────────────────────────

/** Section rectangulaire balayée le long de l'hélice. */
interface SweptProfile {
  innerRadius: number
  outerRadius: number
  /** Altitude du dessous et du dessus au paramètre `t ∈ [0,1]` du balayage. */
  bottom: (t: number) => number
  top: (t: number) => number
}

/**
 * Balaye un solide FERMÉ (4 flancs + 2 capuchons) le long de l'hélice.
 *
 * Le repère local d'une station est direct : `u` radial sortant, `v` vertical,
 * `w = u × v` tangentiel dans le sens du balayage. Les boucles sont écrites
 * pour ce repère ; si le balayage est négatif, `w` s'inverse et l'orientation
 * de toutes les faces avec lui — d'où `flip`, sans quoi le tablier serait
 * retourné et invisible en `FrontSide`.
 */
function sweepSolid(
  mesh: MeshBuffer,
  ramp: Ramp,
  profile: SweptProfile,
  steps: number,
  t0 = 0,
  t1 = 1,
): void {
  const flip = ramp.sweep < 0

  const station = (t: number): [Vec3, Vec3, Vec3, Vec3] => {
    const angle = ramp.startAngle + ramp.sweep * t
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const yb = profile.bottom(t)
    const yt = profile.top(t)
    const at = (r: number, y: number): Vec3 => ({
      x: ramp.centre.x + r * cos,
      y,
      z: ramp.centre.z + r * sin,
    })
    return [
      at(profile.innerRadius, yb),
      at(profile.outerRadius, yb),
      at(profile.outerRadius, yt),
      at(profile.innerRadius, yt),
    ]
  }

  let prev = station(t0)
  // Capuchon de départ : sa normale regarde vers l'arrière, boucle inversée.
  pushQuad(mesh, prev[3], prev[2], prev[1], prev[0], flip)

  for (let i = 1; i <= steps; i++) {
    const cur = station(t0 + ((t1 - t0) * i) / steps)
    for (let k = 0; k < 4; k++) {
      const l = (k + 1) % 4
      // k = 0 est le dessous (intérieur→extérieur), k = 2 le dessus
      // (extérieur→intérieur) : leurs listes de coins tournent en sens
      // inverse, il faut donc des pivots opposés pour que la diagonale de
      // découpe tombe au même endroit dessus et dessous. Les faces k = 1 et
      // k = 3 sont verticales, donc planes : le pivot leur est indifférent.
      pushQuad(mesh, prev[k], prev[l], cur[l], cur[k], flip, k === 2 ? 1 : 0)
    }
    prev = cur
  }

  // Capuchon d'arrivée.
  pushQuad(mesh, prev[0], prev[1], prev[2], prev[3], flip)
}

// ── Géométrie analytique de l'hélice ─────────────────────────────────────

/**
 * Nombre de segments couvrant `sweepAbs` par pas de `step`, au moins un.
 *
 * La tolérance relative n'est pas cosmétique : `museum.json` stocke les angles
 * arrondis au micro-radian, si bien qu'un demi-tour y vaut 3,141593 et non π.
 * Sans elle, ce millionième de radian en trop ferait un dix-neuvième segment
 * pour un demi-tour censé en compter dix-huit. En échange, le pas réel peut
 * dépasser le pas nominal d'un dix-millième — invisible.
 */
function stepsFor(sweepAbs: number, step: number): number {
  return Math.max(1, Math.ceil((sweepAbs / step) * (1 - 1e-4)))
}

/**
 * Point de la SURFACE DE MARCHE au paramètre `t`, éventuellement décalé
 * radialement de `radialOffset` (0 = axe de la rampe, ±width/2 = les bords).
 *
 * L'altitude d'un hélicoïde ne dépend que de l'angle, pas du rayon : toute la
 * largeur de la rampe est à la même hauteur, ce qui est exactement ce qu'on
 * veut d'un plan incliné — pas de dévers.
 */
export function rampSurfacePoint(ramp: Ramp, t: number, radialOffset = 0): Vec3 {
  const angle = ramp.startAngle + ramp.sweep * t
  const r = ramp.radius + radialOffset
  return {
    x: ramp.centre.x + r * Math.cos(angle),
    y: ramp.baseElevation + ramp.rise * t,
    z: ramp.centre.z + r * Math.sin(angle),
  }
}

/**
 * Pente géométrique, en radians (spec §7.5 : `atan(rise / (radius × sweep))`).
 *
 * `Math.abs(sweep)` parce que la pente est une propriété du plan incliné, pas
 * du sens de parcours : une hélice descendante dans l'autre sens a la même
 * pente. `domain/layout.rampSlope` applique la même formule sur des balayages
 * toujours positifs ; un test croise les deux pour qu'elles ne divergent pas.
 */
export function rampSlopeRadians(ramp: Ramp): number {
  return Math.atan(ramp.rise / (ramp.radius * Math.abs(ramp.sweep)))
}

/**
 * Lacet orientant l'axe local +X sur la tangente de parcours.
 *
 * `Ry(lacet)` envoie (1,0,0) sur (cos lacet, 0, −sin lacet) ; la tangente au
 * paramètre d'angle θ vaut `sens × (−sin θ, 0, cos θ)`. D'où l'identification
 * ci-dessous, valable dans les deux sens de parcours.
 */
function yawAt(angle: number, sens: number): number {
  return Math.atan2(-sens * Math.cos(angle), -sens * Math.sin(angle))
}

/** Axe local +Y d'une boîte de rotation `Ry(lacet) · Rz(pente)`, en monde. */
function localUp(yaw: number, pitch: number): Vec3 {
  const sp = Math.sin(pitch)
  return { x: -sp * Math.cos(yaw), y: Math.cos(pitch), z: sp * Math.sin(yaw) }
}

// ── Construction ─────────────────────────────────────────────────────────

/**
 * Une construction vide reste une construction UTILISABLE : les attributs
 * existent, ils sont seulement de longueur nulle. Un `BufferGeometry` nu
 * ferait planter tout consommateur qui lit `attributes.position.count`, ce qui
 * transformerait une rampe douteuse en écran blanc.
 */
function emptyBuild(warnings: string[]): RampBuild {
  const vide = (): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1))
    return g
  }
  return {
    geometry: vide(),
    colliders: [],
    railingGeometry: vide(),
    railingColliders: [],
    slopeDegrees: 0,
    warnings,
  }
}

function finite(...valeurs: number[]): boolean {
  return valeurs.every((v) => Number.isFinite(v))
}

/**
 * Tablier + garde-corps + colliders convexes d'une rampe hélicoïdale.
 *
 * La fonction est TOTALE : elle ne lève jamais, y compris sur une rampe
 * aberrante écrite à la main dans `museum.json`. Une donnée invalide sort en
 * `warnings` avec une géométrie vide ; une rampe trop raide sort construite
 * mais signalée. Faire crasher le rendu du bâtiment entier pour une rampe
 * douteuse serait une punition disproportionnée.
 */
export function buildRamp(ramp: Ramp): RampBuild {
  const warnings: string[] = []

  if (
    !finite(
      ramp.centre.x,
      ramp.centre.z,
      ramp.radius,
      ramp.startAngle,
      ramp.sweep,
      ramp.width,
      ramp.rise,
      ramp.baseElevation,
    )
  ) {
    warnings.push(`rampe ${ramp.id} : paramètre non fini, rampe ignorée`)
    return emptyBuild(warnings)
  }

  const sweepAbs = Math.abs(ramp.sweep)
  if (sweepAbs < 1e-6 || ramp.radius <= 0 || ramp.width <= 0) {
    warnings.push(
      `rampe ${ramp.id} : géométrie dégénérée (rayon ${ramp.radius}, balayage ${ramp.sweep}, largeur ${ramp.width}), rampe ignorée`,
    )
    return emptyBuild(warnings)
  }

  const sens = Math.sign(ramp.sweep)
  const outerRadius = ramp.radius + ramp.width / 2
  let innerRadius = ramp.radius - ramp.width / 2
  if (innerRadius < MIN_INNER_RADIUS) {
    warnings.push(
      `rampe ${ramp.id} : largeur ${ramp.width} m trop grande pour un rayon de ${ramp.radius} m, bord intérieur ramené à ${MIN_INNER_RADIUS} m`,
    )
    innerRadius = MIN_INNER_RADIUS
  }

  const pitch = rampSlopeRadians(ramp)
  const slopeDegrees = (pitch * 180) / Math.PI
  if (Math.abs(slopeDegrees) > RAMP_MAX_SLOPE_DEG) {
    warnings.push(
      `rampe ${ramp.id} : pente ${slopeDegrees.toFixed(1)}° au-delà de la limite de ${RAMP_MAX_SLOPE_DEG}° — le contrôleur cinématique ne la montera pas`,
    )
  }

  // ── Limon : la dalle hélicoïdale qui porte les marches ──
  //
  // Sa face supérieure suit la ligne de foulée ; c'est sur elle que les marches
  // sont coulées, et sa sous-face reste lisse — c'est exactement ainsi qu'un
  // escalier hélicoïdal en béton est fait, et c'est aussi ce qui garde
  // l'intrados soigné qu'on voit depuis l'atrium.
  const deckTop = (t: number): number => ramp.baseElevation + ramp.rise * t
  const deckBottom = (t: number): number => deckTop(t) - RAMP_DECK_THICKNESS

  const geometrySteps = stepsFor(sweepAbs, GEOMETRY_STEP)
  const deck: MeshBuffer = { positions: [], indices: [] }
  sweepSolid(deck, ramp, { innerRadius, outerRadius, bottom: deckBottom, top: deckTop }, geometrySteps)

  // ── Marches ──
  //
  // Le nombre est choisi pour que la contremarche tombe au plus près de la
  // cible SANS jamais laisser de reste : `rise / n` exactement, si bien que la
  // dernière marche arrive PILE au niveau du plancher supérieur. Un arrondi
  // laisserait une marche bâtarde à l'arrivée, qui est le seul endroit où
  // personne ne la pardonne.
  const marches = Math.max(1, Math.round(ramp.rise / TARGET_RISER))
  const riser = ramp.rise / marches
  const aDesMarches = riser >= MIN_RISER

  if (aDesMarches) {
    // Assez de stations pour que le nez de marche reste un arc et non une
    // corde : au moins trois par marche, sans descendre sous le pas du maillage.
    const parMarche = Math.max(3, Math.ceil(geometrySteps / marches))
    for (let i = 0; i < marches; i++) {
      const t0 = i / marches
      const t1 = (i + 1) / marches
      const dessus = ramp.baseElevation + (i + 1) * riser
      sweepSolid(
        deck,
        ramp,
        {
          innerRadius,
          outerRadius,
          // La marche est un COIN : épaisse d'une contremarche à son départ,
          // nulle à son arrivée, puisque le limon la rattrape. C'est la forme
          // exacte du coffrage, et elle ne laisse aucun vide sous le giron.
          bottom: deckTop,
          top: () => dessus,
        },
        parMarche,
        t0,
        t1,
      )
    }
  } else {
    warnings.push(
      `rampe ${ramp.id} : pente de ${(100 * ramp.rise) / (sweepAbs * ramp.radius)} %, trop douce pour des marches — laissée en plan incliné`,
    )
  }

  // ── Garde-corps ──
  //
  // Les DEUX rives en portent un. Le spec ne nomme que la rive extérieure,
  // mais l'hélice est inscrite dans une trémie CARRÉE : le cercle extérieur ne
  // frôle les murs de l'atrium qu'en quatre points et s'en éloigne partout
  // ailleurs, tandis que la rive intérieure surplombe le vide central sur tout
  // le parcours. Les deux côtés donnent sur l'atrium, et une chute est une
  // chute. Les deux lisses sont fusionnées en un maillage, donc un draw call.
  const railings: MeshBuffer = { positions: [], indices: [] }
  const railingTop = (t: number): number => deckTop(t) + RAILING_HEIGHT
  sweepSolid(
    railings,
    ramp,
    { innerRadius: outerRadius - RAILING_THICKNESS, outerRadius, bottom: deckTop, top: railingTop },
    geometrySteps,
  )
  sweepSolid(
    railings,
    ramp,
    { innerRadius, outerRadius: innerRadius + RAILING_THICKNESS, bottom: deckTop, top: railingTop },
    geometrySteps,
  )

  // ── Colliders ──
  const colliderSteps = stepsFor(sweepAbs, COLLIDER_STEP)
  const colliders: OrientedBox[] = []
  const railingColliders: OrientedBox[] = []

  // Demi-ouverture angulaire d'un segment. La boîte doit contenir le SECTEUR :
  // radialement de `innerRadius·cos(demi)` (le point le plus rentrant, atteint
  // aux extrémités du segment) jusqu'à `outerRadius`.
  const half = sweepAbs / colliderSteps / 2
  const cosHalf = Math.cos(half)
  const sinHalf = Math.sin(half)
  const boxInner = innerRadius * cosHalf
  const boxRadius = (boxInner + outerRadius) / 2
  const halfRadial = (outerRadius - boxInner) / 2
  // Demi-longueur tangentielle : la corde du rayon EXTÉRIEUR, donc la plus
  // longue, plus la rallonge de recouvrement. Deux boîtes voisines dont les
  // centres sont distants de 2·boxRadius·sin(demi) se recouvrent alors de
  // 2·(outerRadius − boxRadius)·sin(demi) + 2·COLLIDER_OVERLAP.
  const halfTangential = outerRadius * sinHalf + COLLIDER_OVERLAP
  // Dénivelé d'un segment : sert à rallonger les boîtes du garde-corps, qui
  // restent verticales alors que le tablier monte sous elles.
  const riseParSegment = Math.abs(ramp.rise) / colliderSteps

  for (let k = 0; k < colliderSteps; k++) {
    const tm = (k + 0.5) / colliderSteps
    const angle = ramp.startAngle + ramp.sweep * tm
    const yaw = yawAt(angle, sens)
    const up = localUp(yaw, pitch)

    // Le centre de la boîte est le point de marche reculé d'une demi-épaisseur
    // le long de sa propre verticale : la FACE SUPÉRIEURE passe alors
    // exactement par la surface de marche, ce que le test de couverture vérifie.
    //
    // Une face plane ne peut pas épouser un hélicoïde vrillé : aux coins d'un
    // segment de 10°, l'écart atteint (width/2)·sin(demi)·sin(pente), soit
    // ~1,6 cm sur la rampe réelle. C'est un ordre de grandeur en dessous de
    // l'autostep du contrôleur, qui l'avale sans que le joueur le sente.
    if (!aDesMarches) {
      const surface = rampSurfacePoint(ramp, tm, boxRadius - ramp.radius)
      colliders.push({
        position: {
          x: surface.x - (RAMP_DECK_THICKNESS / 2) * up.x,
          y: surface.y - (RAMP_DECK_THICKNESS / 2) * up.y,
          z: surface.z - (RAMP_DECK_THICKNESS / 2) * up.z,
        },
        rotation: [0, yaw, pitch],
        halfExtents: { x: halfTangential, y: RAMP_DECK_THICKNESS / 2, z: halfRadial },
      })
    }

    // Les garde-corps ne sont pas inclinés : un garde-corps est vertical, seuls
    // son arase haute et son pied suivent la pente. On rallonge donc la boîte
    // du dénivelé du segment pour qu'elle reste plantée dans le tablier d'un
    // bout à l'autre, sans laisser de fente au point haut.
    const halfHeight = (RAILING_HEIGHT + riseParSegment) / 2
    const centreY = rampSurfacePoint(ramp, tm).y + RAILING_HEIGHT / 2
    for (const rBord of [outerRadius - RAILING_THICKNESS / 2, innerRadius + RAILING_THICKNESS / 2]) {
      // Une boîte est une corde, la lisse est un arc : aux extrémités du
      // segment l'arc s'écarte de la corde de r·(1 − cos(demi)), soit près de
      // 4 cm à 10° de pas — plus que l'épaisseur de la lisse elle-même. Sans
      // cette reprise, deux fentes par segment laisseraient passer le joueur.
      const rMax = rBord + RAILING_THICKNESS / 2
      const rMin = (rBord - RAILING_THICKNESS / 2) * cosHalf
      railingColliders.push({
        position: {
          x: ramp.centre.x + ((rMin + rMax) / 2) * Math.cos(angle),
          y: centreY,
          z: ramp.centre.z + ((rMin + rMax) / 2) * Math.sin(angle),
        },
        rotation: [0, yaw, 0],
        halfExtents: { x: halfTangential, y: halfHeight, z: (rMax - rMin) / 2 },
      })
    }
  }

  // ── Colliders de marche ──
  //
  // Une boîte HORIZONTALE par marche, dont la face supérieure est le giron.
  // Pas une boîte inclinée suivant la ligne de foulée : celle-ci passe jusqu'à
  // une contremarche SOUS le nez des girons, et le visiteur s'y enfoncerait de
  // quinze centimètres dans chaque marche — il verrait un escalier et
  // marcherait sur une rampe.
  //
  // Le contrôleur cinématique les monte sans rien de plus : son autostep est
  // réglé à 0,35 m, soit plus du double d'une contremarche de 0,15 m.
  if (aDesMarches) {
    const demiMarche = sweepAbs / marches / 2
    const cosDemi = Math.cos(demiMarche)
    const interieurMarche = innerRadius * cosDemi
    const rayonMarche = (interieurMarche + outerRadius) / 2
    const demiRadialMarche = (outerRadius - interieurMarche) / 2
    const demiTangentMarche = outerRadius * Math.sin(demiMarche) + COLLIDER_OVERLAP

    for (let i = 0; i < marches; i++) {
      const tm = (i + 0.5) / marches
      const angle = ramp.startAngle + ramp.sweep * tm
      const dessus = ramp.baseElevation + (i + 1) * riser
      // La boîte descend d'une contremarche ET de l'épaisseur du limon : elle
      // rejoint ainsi celle d'en dessous sans laisser de fente au nez, là où le
      // pied se pose.
      const epaisseur = riser + RAMP_DECK_THICKNESS
      colliders.push({
        position: {
          x: ramp.centre.x + rayonMarche * Math.cos(angle),
          y: dessus - epaisseur / 2,
          z: ramp.centre.z + rayonMarche * Math.sin(angle),
        },
        // Aucune pente : une marche est HORIZONTALE, c'est sa définition.
        rotation: [0, yawAt(angle, sens), 0],
        halfExtents: {
          x: demiTangentMarche,
          y: epaisseur / 2,
          z: demiRadialMarche,
        },
      })
    }
  }

  return {
    geometry: toGeometry(deck),
    colliders,
    railingGeometry: toGeometry(railings),
    railingColliders,
    slopeDegrees,
    warnings,
  }
}
