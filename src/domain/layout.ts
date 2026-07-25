/**
 * LOT 1 — Disposition du bâtiment (spec §7.1, §7.2, §7.3, §7.5).
 *
 * Un atrium rectangulaire centré sur l'origine, un anneau de salles autour, une
 * rampe hélicoïdale dans le vide. Le bâtiment prend la forme du compte GitHub :
 * cinq dépôts donnent un plateau unique, deux mille donnent une tour.
 *
 * Trois invariants portent tout le reste :
 *
 *  - L'élévation est CALCULÉE depuis le niveau, jamais saisie. Deux étages ne
 *    peuvent donc pas se chevaucher, quoi qu'on écrive dans la configuration.
 *  - L'anneau est une PARTITION : Nord et Sud prennent les angles sur toute la
 *    largeur extérieure, Est et Ouest se limitent à la profondeur de l'atrium.
 *    Aucune emprise n'en recouvre une autre, sinon deux salles se disputeraient
 *    le même mètre carré de plancher.
 *  - Une salle est dimensionnée par son BESOIN, pas par la longueur du côté qui
 *    l'accueille. Le reliquat du côté part en galeries aveugles (§7.2), qui
 *    ferment l'enveloppe sans faire semblant d'être des salles. Étirer une salle
 *    de onze œuvres sur trente-huit mètres donnait un couloir vide : le bâtiment
 *    doit rester une PARTITION du côté, mais pas au prix de son échelle.
 *
 * Les placements sont laissés VIDES : l'accrochage est le travail de
 * `hanging.ts`. Ici on ne produit que la géométrie et les ouvertures.
 *
 * Aucun aléa, aucune horloge : deux exécutions sur la même entrée produisent le
 * même bâtiment, octet pour octet. Les départages se font par ordre
 * alphabétique d'identifiant de cluster.
 */
import type { Cluster } from './clustering'
import type {
  Floor,
  MuseumConfig,
  Opening,
  Ramp,
  Rect,
  RepoKey,
  Room,
  Side,
  ThemeId,
  Vec2,
  Wall,
  WallKind,
} from './types'
import { MIN_ARTWORK_GAP, WALL_CORNER_MARGIN } from './types'
import { AVERAGE_ARTWORK_HEIGHT, DEFAULT_ASPECT, wallCapacity } from './hanging'

// ── Contrat public ───────────────────────────────────────────────────────

export interface LayoutInput {
  clusters: Cluster[]
  /** Les œuvres maîtresses, pour la salle d'honneur du rez-de-chaussée. */
  featured: RepoKey[]
  /** Forks et archivés : ils descendent en réserve, au niveau −1. */
  vault: RepoKey[]
  config: MuseumConfig
}

export interface BuildingPlan {
  floors: Floor[]
  ramps: Ramp[]
  atrium: Rect
}

// ── Constantes de disposition ────────────────────────────────────────────

/** Largeur de la rampe (spec §7.5). */
const RAMP_WIDTH = 2.2

/** Retrait de la rampe par rapport au bord de l'atrium : rayon = atriumW/2 − ça. */
const RAMP_INNER_MARGIN = 1.2

/**
 * En dessous de ce rayon l'hélice devient un colimaçon injouable. On préfère
 * un atrium plus large qu'une rampe que le contrôleur ne sait pas monter.
 */
const RAMP_MIN_RADIUS = 1.5

/**
 * Pente visée. Le contrôleur cinématique bloque à 45° et le spec exige un test
 * sous 40° : viser 32° laisse la marge intacte même sur un plafond aberrant.
 */
const RAMP_TARGET_SLOPE = (32 * Math.PI) / 180

/** Garde-fou de boucle : au-delà, l'hélice ferait plus de trente tours. */
const RAMP_MAX_HALF_TURNS = 64

const DOOR_WIDTH = 2
const DOOR_HEIGHT = 2.1

/** Baie sur l'atrium : étroite par décision de conception (spec §2). */
const MAX_BAY_WIDTH = 2.4
const BAY_WIDTH_RATIO = 0.25

/** Retombée laissée au-dessus d'une baie, pour que la dalle ait de quoi porter. */
const BAY_HEAD_MARGIN = 0.6

const ATRIUM_GROWTH_STEP = 2
const MAX_LAYOUT_ITERATIONS = 10

/**
 * Largeur de l'œuvre de référence, celle dont `hanging.ts` se sert pour annoncer
 * la capacité d'un mur. Le dimensionnement des salles DOIT partir de la même :
 * deux références concurrentes et une salle taillée « juste » ici serait déclarée
 * trop petite là-bas, ce qui ferait grandir l'atrium sans fin.
 */
const REF_ARTWORK_WIDTH = AVERAGE_ARTWORK_HEIGHT * DEFAULT_ASPECT

/** Pas d'élargissement d'une salle dont la capacité mesurée reste insuffisante. */
const SIZING_GROWTH_STEP = 0.5

/**
 * Garde-fou de la boucle de dimensionnement d'un côté. Chaque passe élargit au
 * moins d'un pas les salles en manque ; au-delà, on retombe sur la subdivision
 * proportionnelle du lot 1 et c'est l'atrium qui grandira.
 */
const MAX_SIZING_PASSES = 16

/** Nom porté par toutes les galeries aveugles. Elles ne sont pas des salles. */
export const BLIND_GALLERY_NAME = 'Galerie aveugle'

/** Tolérance de comparaison : on manipule des mètres, le micron suffit. */
const EPS = 1e-9

// ── Utilitaires numériques ───────────────────────────────────────────────

/**
 * Les coordonnées sont arrondies au micromètre AVANT d'être utilisées, jamais
 * après : deux salles voisines partagent ainsi exactement la même frontière et
 * l'anneau reste une partition exacte, sans liseré ni recouvrement.
 */
function round(v: number): number {
  return Math.round(v * 1e6) / 1e6
}

function overlap(a0: number, a1: number, b0: number, b1: number): [number, number] | null {
  const lo = Math.max(a0, b0)
  const hi = Math.min(a1, b1)
  return hi > lo ? [lo, hi] : null
}

// ── Élévations ───────────────────────────────────────────────────────────

/**
 * Élévation du plancher d'un niveau. Le rez-de-chaussée est l'origine ; la
 * réserve est SOUS lui, donc en négatif. La formule est la somme des hauteurs
 * des niveaux inférieurs, ce qui se réduit ici à un produit puisque tous les
 * niveaux partagent la même hauteur sous plafond.
 */
export function elevationOf(level: number, config: MuseumConfig): number {
  const { ceilingHeight, slabThickness } = config.building
  return round(level * (ceilingHeight + slabThickness))
}

// ── Anneau ───────────────────────────────────────────────────────────────

/**
 * Un côté de l'anneau, décrit dans son propre paramétrage : `axis` est l'axe
 * le long duquel il se subdivise en salles, `outer`/`inner` sont les deux bords
 * sur l'axe perpendiculaire.
 */
interface Strip {
  side: Side
  axis: 'x' | 'z'
  start: number
  length: number
  outer: number
  inner: number
}

/**
 * Partition des côtés (spec §7.2). Nord et Sud prennent toute la largeur
 * extérieure — donc les quatre angles ; Est et Ouest se limitent à la
 * profondeur de l'atrium. C'est cette asymétrie qui évite le recouvrement.
 */
export function ringStrips(atrium: Rect, roomDepth: number): Strip[] {
  const xMin = round(atrium.x)
  const xMax = round(atrium.x + atrium.width)
  const zMin = round(atrium.z)
  const zMax = round(atrium.z + atrium.depth)
  const outerXMin = round(xMin - roomDepth)
  const outerXMax = round(xMax + roomDepth)
  const outerZMin = round(zMin - roomDepth)
  const outerZMax = round(zMax + roomDepth)
  const fullWidth = round(outerXMax - outerXMin)

  return [
    { side: 'north', axis: 'x', start: outerXMin, length: fullWidth, outer: outerZMin, inner: zMin },
    { side: 'east', axis: 'z', start: zMin, length: round(zMax - zMin), outer: outerXMax, inner: xMax },
    { side: 'south', axis: 'x', start: outerXMin, length: fullWidth, outer: outerZMax, inner: zMax },
    { side: 'west', axis: 'z', start: zMin, length: round(zMax - zMin), outer: outerXMin, inner: xMin },
  ]
}

/** Emprise d'une salle occupant `[t0, t1]` le long de son côté. */
function roomFootprint(strip: Strip, t0: number, t1: number): Rect {
  const lo = Math.min(strip.outer, strip.inner)
  const depth = round(Math.abs(strip.outer - strip.inner))
  return strip.axis === 'x'
    ? { x: t0, z: lo, width: round(t1 - t0), depth }
    : { x: lo, z: t0, width: depth, depth: round(t1 - t0) }
}

// ── Répartition des clusters ─────────────────────────────────────────────

/**
 * Le poids d'un cluster est son nombre d'œuvres : c'est ce que la salle devra
 * accrocher, donc la seule grandeur qui doive dicter sa taille.
 */
function clusterWeight(c: Cluster): number {
  return c.keys.length
}

/**
 * Ordre canonique : poids décroissant, puis identifiant alphabétique. C'est lui
 * qui décide de l'étage ET du côté ; l'ordre dans lequel `clustering.ts` a émis
 * les clusters n'a donc aucune influence sur le bâtiment.
 */
function sortClusters(clusters: Cluster[]): Cluster[] {
  return [...clusters].sort((a, b) => {
    const d = clusterWeight(b) - clusterWeight(a)
    if (d !== 0) return d
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/**
 * Longueur de mur qu'un cluster réclame, en mètres : `n` œuvres de référence
 * séparées d'un écart minimal, marges comprises aux deux bouts (spec §7.2.4).
 *
 * C'est la grandeur qui doit dicter la taille d'une salle. Un compte d'œuvres
 * n'en dit rien : ce qui remplit un mur est une longueur, pas un cardinal.
 */
export function linearNeed(count: number): number {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  if (n === 0) return 0
  return round(n * REF_ARTWORK_WIDTH + (n + 1) * MIN_ARTWORK_GAP)
}

/**
 * Largeur visée par une salle de l'anneau qui doit accrocher `count` œuvres.
 *
 * On inverse l'offre de mur d'une salle de largeur `W` et de profondeur `d` :
 *
 *   offre(W) = (W − 2m)          mur extérieur
 *            + (W − 2m − baie)   mur intérieur, baie déduite
 *            + 2 × (d − 2m − p)  murs mitoyens, porte déduite
 *
 * La baie est comptée à son maximum et la porte comme si elle existait toujours :
 * on préfère viser un peu large et laisser la mesure de capacité — la vraie,
 * celle de `hanging.ts` — trancher ensuite. Le résultat n'est qu'un POINT DE
 * DÉPART : il ignore la perte de granularité (un segment de 2 m n'accroche rien
 * même s'il fait 2 m), que la boucle de `sideRooms` corrige en mesurant.
 */
export function targetRoomWidth(
  count: number,
  roomDepth: number,
  minRoomWidth: number,
  maxWidth: number,
): number {
  const mitoyens = 2 * Math.max(0, roomDepth - 2 * WALL_CORNER_MARGIN - DOOR_WIDTH)
  const restant = linearNeed(count) - mitoyens
  const voulue = (restant + 4 * WALL_CORNER_MARGIN + MAX_BAY_WIDTH) / 2
  return round(Math.min(Math.max(voulue, minRoomWidth), Math.max(maxWidth, 0)))
}

/**
 * Répartition en quatre bacs (spec §7.2.1) : clusters par poids décroissant,
 * chacun dans le côté le moins chargé.
 *
 * Un garde-fou en plus du spec : un côté ne peut recevoir un cluster que s'il
 * lui reste de quoi loger la LARGEUR VISÉE de sa salle. Sans lui, l'Est et
 * l'Ouest — qui ne font que la profondeur de l'atrium — se verraient attribuer
 * des salles de deux mètres pendant que le Nord reste à moitié vide. La borne
 * porte bien sur une longueur cumulée et non sur un nombre de salles : deux
 * cabinets et une grande galerie n'occupent pas la même chose.
 */
function distributeToSides(
  clusters: Cluster[],
  strips: Strip[],
  minRoomWidth: number,
  roomDepth: number,
): Cluster[][] {
  const bins: Cluster[][] = strips.map(() => [])
  const loads = strips.map(() => 0)
  const used = strips.map(() => 0)

  for (const cluster of sortClusters(clusters)) {
    const largeurs = strips.map((s) =>
      targetRoomWidth(clusterWeight(cluster), roomDepth, minRoomWidth, s.length),
    )
    let chosen = -1
    for (let i = 0; i < bins.length; i++) {
      // Le premier cluster d'un côté y entre toujours : un côté qui ne peut
      // loger personne bloquerait la répartition au lieu de la faire grandir.
      if (bins[i].length > 0 && used[i] + largeurs[i] > strips[i].length + EPS) continue
      if (chosen < 0 || loads[i] < loads[chosen]) chosen = i
    }
    // Tous les côtés sont pleins : on charge quand même le moins chargé, et la
    // boucle de capacité fera grandir l'atrium au tour suivant.
    if (chosen < 0) {
      chosen = 0
      for (let i = 1; i < bins.length; i++) if (loads[i] < loads[chosen]) chosen = i
    }
    bins[chosen].push(cluster)
    loads[chosen] += clusterWeight(cluster)
    used[chosen] += largeurs[chosen]
  }

  return bins
}

/**
 * Subdivision d'un côté proportionnellement aux poids, avec plancher à
 * `minRoomWidth` (spec §7.2.2). Les salles remontées au plancher prélèvent
 * leur déficit sur les autres, au prorata de ce qu'elles ont au-dessus du
 * plancher.
 *
 * Si le côté ne tient même pas `n × minRoomWidth`, on partage à parts égales :
 * mieux vaut des salles trop étroites — que la boucle de capacité corrigera en
 * agrandissant l'atrium — que des emprises qui se chevauchent.
 */
export function subdivideSide(length: number, weights: number[], minRoomWidth: number): number[] {
  const n = weights.length
  if (n === 0) return []
  const egal = (): number[] => new Array<number>(n).fill(length / n)
  if (n * minRoomWidth > length + 1e-9) return egal()

  const total = weights.reduce((s, w) => s + w, 0)
  if (total <= 0) return egal()

  const widths = weights.map((w) => (length * w) / total)
  for (let pass = 0; pass < n; pass++) {
    const sous = widths.map((w, i) => (w < minRoomWidth - 1e-9 ? i : -1)).filter((i) => i >= 0)
    if (sous.length === 0) break

    let deficit = 0
    for (const i of sous) deficit += minRoomWidth - widths[i]
    for (const i of sous) widths[i] = minRoomWidth

    const sur = widths.map((w, i) => (w > minRoomWidth + 1e-9 ? i : -1)).filter((i) => i >= 0)
    let disponible = 0
    for (const i of sur) disponible += widths[i] - minRoomWidth
    if (disponible <= deficit + 1e-9) return egal()
    for (const i of sur) widths[i] -= (deficit * (widths[i] - minRoomWidth)) / disponible
  }
  return widths
}

/**
 * Un emplacement le long d'un côté. `cluster` est l'indice du cluster dans le
 * bac, ou −1 pour une galerie aveugle.
 */
interface Slot {
  width: number
  cluster: number
}

/**
 * Découpe un côté en salles à leur largeur visée et en galeries aveugles pour le
 * reliquat (spec §7.2, invariant d'enveloppe).
 *
 * Les salles sont CENTRÉES sur le côté, ce qui n'est pas un choix esthétique :
 * sur le Nord et le Sud, les deux bouts du côté sont les zones d'angle, celles
 * qui longent l'aile perpendiculaire et non le vide. Y reléguer l'aveuglement
 * laisse toutes les salles de collection face à l'atrium, donc toutes avec une
 * baie qui donne sur quelque chose.
 *
 * Renvoie `null` quand les largeurs visées ne tiennent pas : c'est le signal de
 * repli vers la subdivision proportionnelle, et de là vers l'agrandissement de
 * l'atrium.
 */
export function planSideSlots(length: number, targets: number[], minRoomWidth: number): Slot[] | null {
  if (targets.length === 0) return null
  const total = targets.reduce((s, w) => s + w, 0)
  if (total > length - EPS) return null

  const rooms: Slot[] = targets.map((width, cluster) => ({ width, cluster }))
  const bord = (length - total) / 2

  // Deux galeries symétriques, une seule en tête, ou aucune : une galerie plus
  // étroite que `minRoomWidth` n'est pas une pièce, c'est un interstice. Le
  // reliquat qu'on ne peut pas murer retourne aux salles, au prorata.
  if (bord >= minRoomWidth - EPS) {
    return [{ width: bord, cluster: -1 }, ...rooms, { width: bord, cluster: -1 }]
  }
  if (2 * bord >= minRoomWidth - EPS) {
    return [{ width: 2 * bord, cluster: -1 }, ...rooms]
  }
  const rendu = 2 * bord
  return rooms.map((slot) => ({ ...slot, width: slot.width + (rendu * slot.width) / total }))
}

// ── Murs ─────────────────────────────────────────────────────────────────

/** Ouverture décrite en coordonnées monde, avant projection sur le mur. */
interface OpeningSpec {
  kind: Opening['kind']
  from: number
  to: number
  height: number
}

interface WallSpec {
  id: string
  p: Vec2
  q: Vec2
  kind: WallKind
  openings: OpeningSpec[]
}

/**
 * Oriente le mur puis projette ses ouvertures.
 *
 * L'orientation n'est pas cosmétique : `a` est l'origine du paramétrage `u` de
 * tous les accrochages, et la normale est déduite du sens `a → b` par une
 * rotation d'un quart de tour. On choisit donc le sens qui fait pointer cette
 * normale vers l'intérieur de la salle — le seul côté du mur qui reçoive des
 * œuvres et sur lequel le visiteur puisse se tenir.
 */
function finalizeWall(spec: WallSpec, centre: Vec2, height: number): Wall {
  let a = spec.p
  let b = spec.q
  const longueur = Math.hypot(b.x - a.x, b.z - a.z)
  let dir: Vec2 = { x: (b.x - a.x) / longueur, z: (b.z - a.z) / longueur }
  let normal: Vec2 = { x: dir.z, z: -dir.x }
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }
  if (normal.x * (centre.x - mid.x) + normal.z * (centre.z - mid.z) < 0) {
    ;[a, b] = [b, a]
    dir = { x: -dir.x, z: -dir.z }
    normal = { x: -normal.x, z: -normal.z }
  }

  const axis: 'x' | 'z' = Math.abs(dir.x) > Math.abs(dir.z) ? 'x' : 'z'
  const sign = axis === 'x' ? Math.sign(dir.x) : Math.sign(dir.z)
  const origin = axis === 'x' ? a.x : a.z
  const openings: Opening[] = []
  for (const o of spec.openings) {
    const u0 = (o.from - origin) * sign
    const u1 = (o.to - origin) * sign
    const start = round(Math.max(0, Math.min(u0, u1)))
    const end = round(Math.min(longueur, Math.max(u0, u1)))
    if (end - start < 0.05) continue
    openings.push({ kind: o.kind, start, end, height: round(Math.min(o.height, height)) })
  }
  openings.sort((x, y) => x.start - y.start)

  return {
    id: spec.id,
    a: { x: round(a.x), z: round(a.z) },
    b: { x: round(b.x), z: round(b.z) },
    height: round(height),
    kind: spec.kind,
    normal: { x: round(normal.x), z: round(normal.z) },
    openings,
    placements: [],
  }
}

/** Ouverture centrée sur `[lo, hi]`, ou rien si le segment est trop court. */
function centeredOpening(
  lo: number,
  hi: number,
  width: number,
  kind: Opening['kind'],
  height: number,
): OpeningSpec | null {
  if (hi - lo < width + 2 * WALL_CORNER_MARGIN - 1e-9) return null
  const centre = (lo + hi) / 2
  return { kind, from: round(centre - width / 2), to: round(centre + width / 2), height }
}

/**
 * Ouverture de largeur `width` centrée sur `[cLo, cHi]` mais contrainte à tenir
 * dans `[lo, hi]`. Sert aux passages d'angle, dont le centre naturel est celui
 * de la zone d'angle et non celui du mur qui la porte.
 */
function clampedOpening(
  lo: number,
  hi: number,
  cLo: number,
  cHi: number,
  width: number,
  kind: Opening['kind'],
  height: number,
): OpeningSpec | null {
  if (hi - lo < width + 2 * WALL_CORNER_MARGIN - 1e-9) return null
  const min = lo + WALL_CORNER_MARGIN + width / 2
  const max = hi - WALL_CORNER_MARGIN - width / 2
  const centre = Math.min(max, Math.max(min, (cLo + cHi) / 2))
  return { kind, from: round(centre - width / 2), to: round(centre + width / 2), height }
}

/**
 * Ce que la salle ouvre. Une galerie aveugle passe tout à `false` : elle ferme
 * l'enveloppe et rien de plus, sans baie ni porte (spec §7.2).
 */
interface RoomOpenings {
  /** Porte dans le mur mitoyen du côté `min` de l'axe du côté. */
  doorA: boolean
  /** Porte dans le mur mitoyen du côté `max`. */
  doorB: boolean
  /** Baie sur l'atrium et passages d'angle. */
  inner: boolean
}

const BLIND: RoomOpenings = { doorA: false, doorB: false, inner: false }

/**
 * Les quatre murs d'une salle de l'anneau (spec §7.3).
 *
 * Le mur `inner` regarde le centre du bâtiment. Sur la portion qui longe
 * réellement l'atrium il porte une baie étroite ; sur les portions d'angle —
 * qui longent l'aile perpendiculaire, pas le vide — une baie ne donnerait sur
 * rien, on y met une porte de passage. Sans elle, les salles d'angle du Nord et
 * du Sud seraient des culs-de-sac.
 */
function ringRoomWalls(
  roomId: string,
  footprint: Rect,
  strip: Strip,
  atrium: Rect,
  ceilingHeight: number,
  ouvertures: RoomOpenings,
): Wall[] {
  const xMin = footprint.x
  const xMax = round(footprint.x + footprint.width)
  const zMin = footprint.z
  const zMax = round(footprint.z + footprint.depth)
  const centre: Vec2 = { x: (xMin + xMax) / 2, z: (zMin + zMax) / 2 }
  const bayHeight = Math.max(DOOR_HEIGHT, ceilingHeight - BAY_HEAD_MARGIN)

  const along = strip.axis === 'x' ? [xMin, xMax] : [zMin, zMax]
  const roomWidth = along[1] - along[0]
  const bayWidth = Math.min(MAX_BAY_WIDTH, roomWidth * BAY_WIDTH_RATIO)

  // Zones que le mur intérieur peut longer, sur l'axe du côté.
  const atriumSpan: [number, number] =
    strip.axis === 'x'
      ? [atrium.x, round(atrium.x + atrium.width)]
      : [atrium.z, round(atrium.z + atrium.depth)]

  const innerOpenings: OpeningSpec[] = []
  const surAtrium = ouvertures.inner
    ? overlap(along[0], along[1], atriumSpan[0], atriumSpan[1])
    : null
  if (surAtrium) {
    const bay = centeredOpening(surAtrium[0], surAtrium[1], bayWidth, 'bay', bayHeight)
    if (bay) innerOpenings.push(bay)
  }
  // Portions d'angle : seuls le Nord et le Sud en ont, par construction de la
  // partition. `roomDepth` est la profondeur de l'aile perpendiculaire.
  if (ouvertures.inner && strip.axis === 'x') {
    const depth = Math.abs(strip.outer - strip.inner)
    const corners: [number, number][] = [
      [round(atriumSpan[0] - depth), atriumSpan[0]],
      [atriumSpan[1], round(atriumSpan[1] + depth)],
    ]
    for (const [cLo, cHi] of corners) {
      // Le passage n'est percé que si la salle couvre l'angle EN ENTIER. Le mur
      // qui lui fait face est celui d'une salle de l'aile perpendiculaire, percé
      // au centre de la même zone : à couverture partielle les deux trous ne
      // seraient pas en vis-à-vis et la porte donnerait sur un mur plein.
      if (along[0] > cLo + EPS || along[1] < cHi - EPS) continue
      const porte = clampedOpening(cLo, cHi, cLo, cHi, DOOR_WIDTH, 'door', DOOR_HEIGHT)
      if (porte) innerOpenings.push(porte)
    }
  }

  /**
   * Mur mitoyen : porte vers ce qu'il y a de l'autre côté, quand il y a lieu de
   * l'ouvrir. C'est l'appelant qui le sait : lui seul voit si le voisin est une
   * salle, une galerie aveugle — qu'on ne perce jamais — ou le passage d'angle.
   */
  const sideOpenings = (ouvre: boolean): OpeningSpec[] => {
    if (!ouvre) return []
    const lo = strip.axis === 'x' ? zMin : xMin
    const hi = strip.axis === 'x' ? zMax : xMax
    const porte = centeredOpening(lo, hi, DOOR_WIDTH, 'door', DOOR_HEIGHT)
    return porte ? [porte] : []
  }

  const outerIsMax = strip.outer > strip.inner
  const specs: WallSpec[] = []

  if (strip.axis === 'x') {
    const zOuter = outerIsMax ? zMax : zMin
    const zInner = outerIsMax ? zMin : zMax
    specs.push(
      { id: `${roomId}-outer`, p: { x: xMin, z: zOuter }, q: { x: xMax, z: zOuter }, kind: 'outer', openings: [] },
      { id: `${roomId}-side-a`, p: { x: xMin, z: zMin }, q: { x: xMin, z: zMax }, kind: 'side', openings: sideOpenings(ouvertures.doorA) },
      { id: `${roomId}-side-b`, p: { x: xMax, z: zMin }, q: { x: xMax, z: zMax }, kind: 'side', openings: sideOpenings(ouvertures.doorB) },
      { id: `${roomId}-inner`, p: { x: xMin, z: zInner }, q: { x: xMax, z: zInner }, kind: 'inner', openings: innerOpenings },
    )
  } else {
    const xOuter = outerIsMax ? xMax : xMin
    const xInner = outerIsMax ? xMin : xMax
    specs.push(
      { id: `${roomId}-outer`, p: { x: xOuter, z: zMin }, q: { x: xOuter, z: zMax }, kind: 'outer', openings: [] },
      { id: `${roomId}-side-a`, p: { x: xMin, z: zMin }, q: { x: xMax, z: zMin }, kind: 'side', openings: sideOpenings(ouvertures.doorA) },
      { id: `${roomId}-side-b`, p: { x: xMin, z: zMax }, q: { x: xMax, z: zMax }, kind: 'side', openings: sideOpenings(ouvertures.doorB) },
      { id: `${roomId}-inner`, p: { x: xInner, z: zMin }, q: { x: xInner, z: zMax }, kind: 'inner', openings: innerOpenings },
    )
  }

  return specs.map((s) => finalizeWall(s, centre, ceilingHeight))
}

// ── Fermeture du pourtour ────────────────────────────────────────────────

/**
 * Les quatre arêtes de l'emprise, chacune avec l'axe le long duquel elle court
 * et la coordonnée fixe sur l'axe perpendiculaire.
 */
function footprintEdges(
  footprint: Rect,
): { id: string; axis: 'x' | 'z'; fixe: number; de: number; a: number }[] {
  const xMin = round(footprint.x)
  const xMax = round(footprint.x + footprint.width)
  const zMin = round(footprint.z)
  const zMax = round(footprint.z + footprint.depth)
  return [
    { id: 'n', axis: 'x', fixe: zMin, de: xMin, a: xMax },
    { id: 's', axis: 'x', fixe: zMax, de: xMin, a: xMax },
    { id: 'o', axis: 'z', fixe: xMin, de: zMin, a: zMax },
    { id: 'e', axis: 'z', fixe: xMax, de: zMin, a: zMax },
  ]
}

/**
 * Complément d'une union d'intervalles dans `[de, a]` : ce qui reste à couvrir.
 *
 * Les intervalles arrivent en désordre et peuvent se chevaucher — deux salles
 * voisines partagent leur arête à l'epsilon près. On les trie et on les fusionne
 * avant de prendre le complément, sinon un chevauchement d'un millimètre
 * fabriquerait un trou de la même taille et donc un mur de un millimètre.
 */
function gaps(
  couverts: [number, number][],
  de: number,
  a: number,
): [number, number][] {
  const tries = [...couverts].sort((p, q) => p[0] - q[0])
  const trous: [number, number][] = []
  let curseur = de
  for (const [lo, hi] of tries) {
    if (lo > curseur + EPS) trous.push([curseur, Math.min(lo, a)])
    curseur = Math.max(curseur, hi)
    if (curseur >= a - EPS) break
  }
  if (curseur < a - EPS) trous.push([curseur, a])
  // Un résidu sous le seuil n'est pas un trou dans un bâtiment, c'est du bruit
  // d'arrondi : le murer ferait des lamelles de quelques centimètres, coûteuses
  // en draw calls et invisibles.
  return trous.filter(([lo, hi]) => hi - lo > MIN_ENCLOSURE_SEGMENT)
}

/**
 * En dessous, un manque du pourtour ne vaut pas un mur. Un demi-mètre est plus
 * étroit que la moindre porte : rien de franchissable ne s'y cache.
 */
const MIN_ENCLOSURE_SEGMENT = 0.5

/** Vrai si le mur est posé, sur toute sa longueur, sur une arête de l'emprise. */
function surLePourtour(wall: Wall, footprint: Rect): boolean {
  return footprintEdges(footprint).some((edge) =>
    edge.axis === 'x'
      ? Math.abs(wall.a.z - edge.fixe) < EPS && Math.abs(wall.b.z - edge.fixe) < EPS
      : Math.abs(wall.a.x - edge.fixe) < EPS && Math.abs(wall.b.x - edge.fixe) < EPS,
  )
}

/**
 * Requalifie en `outer` les murs MITOYENS qui se trouvent sur le pourtour.
 *
 * Un mur mitoyen sépare normalement deux salles. Aux angles est et ouest, il n'a
 * pas de voisin : c'est lui qui ferme le bâtiment, et il est donc de la façade —
 * mais il était étiqueté `side`, donc habillé du plâtre du thème de sa salle.
 * Vue de l'extérieur, l'enveloppe alternait ainsi le béton des strips et le
 * plâtre teinté des angles, ce qui donnait à la façade son aspect de patchwork.
 * Sur le musée réel, dix murs sont dans ce cas.
 *
 * C'est une correction d'ÉTIQUETTE, pas de géométrie : les murs ne bougent pas,
 * leurs œuvres restent accrochées. Aucun d'eux ne porte d'ouverture — le poseur
 * ne perce que vers un voisin, et ceux-là n'en ont pas — donc requalifier ne
 * peut pas fermer un passage.
 */
function reclassifyPerimeterWalls(footprint: Rect, rooms: Room[]): Room[] {
  return rooms.map((room) => {
    const walls = room.walls.map((wall) =>
      wall.kind === 'side' && surLePourtour(wall, footprint)
        ? { ...wall, kind: 'outer' as const }
        : wall,
    )
    return walls.some((w, i) => w !== room.walls[i]) ? { ...room, walls } : room
  })
}

/**
 * Mure ce que les salles laissent ouvert sur le pourtour du niveau.
 *
 * Les murs d'enceinte naissent des salles, une salle ne couvrant que sa propre
 * longueur : rien ne garantit que le pourtour soit clos. Sur le musée réel il ne
 * l'était pas — rez-de-chaussée 25 %, étages 70 % —, faute de quoi le visiteur
 * apparaissait dehors et les cloisons intérieures faisaient office de façade.
 *
 * On ne remplace RIEN : les murs de salle restent tels quels, avec leurs œuvres
 * et leurs ouvertures. On n'ajoute que le complément, et deux murs ne peuvent
 * donc pas se superposer — ce qui donnerait le z-fighting le plus visible du
 * bâtiment, sur toute la façade.
 */
export function enclosureWalls(
  footprint: Rect,
  rooms: Room[],
  ceilingHeight: number,
): Wall[] {
  const centre: Vec2 = {
    x: round(footprint.x + footprint.width / 2),
    z: round(footprint.z + footprint.depth / 2),
  }
  const murs: Wall[] = []

  for (const edge of footprintEdges(footprint)) {
    const couverts: [number, number][] = []
    for (const room of rooms) {
      for (const wall of room.walls) {
        // Seuls comptent les murs qui sont EFFECTIVEMENT sur cette arête. Un mur
        // mitoyen perpendiculaire la touche en un point et ne la couvre pas.
        const surEdge =
          edge.axis === 'x'
            ? Math.abs(wall.a.z - edge.fixe) < EPS && Math.abs(wall.b.z - edge.fixe) < EPS
            : Math.abs(wall.a.x - edge.fixe) < EPS && Math.abs(wall.b.x - edge.fixe) < EPS
        if (!surEdge) continue
        const u0 = edge.axis === 'x' ? wall.a.x : wall.a.z
        const u1 = edge.axis === 'x' ? wall.b.x : wall.b.z
        if (Math.abs(u1 - u0) < EPS) continue
        couverts.push([Math.min(u0, u1), Math.max(u0, u1)])
      }
    }

    for (const [lo, hi] of gaps(couverts, edge.de, edge.a)) {
      const p = edge.axis === 'x' ? { x: round(lo), z: edge.fixe } : { x: edge.fixe, z: round(lo) }
      const q = edge.axis === 'x' ? { x: round(hi), z: edge.fixe } : { x: edge.fixe, z: round(hi) }
      murs.push(
        finalizeWall(
          {
            id: `enclos-${edge.id}-${round(lo)}`,
            p,
            q,
            kind: 'outer',
            openings: [],
          },
          centre,
          ceilingHeight,
        ),
      )
    }
  }

  return murs
}

/** Les quatre murs d'aveugle d'une salle rectangulaire isolée : la réserve. */
function boxWalls(roomId: string, footprint: Rect, ceilingHeight: number): Wall[] {
  const xMin = footprint.x
  const xMax = round(footprint.x + footprint.width)
  const zMin = footprint.z
  const zMax = round(footprint.z + footprint.depth)
  const centre: Vec2 = { x: (xMin + xMax) / 2, z: (zMin + zMax) / 2 }
  const specs: WallSpec[] = [
    { id: `${roomId}-outer-n`, p: { x: xMin, z: zMin }, q: { x: xMax, z: zMin }, kind: 'outer', openings: [] },
    { id: `${roomId}-outer-e`, p: { x: xMax, z: zMin }, q: { x: xMax, z: zMax }, kind: 'outer', openings: [] },
    { id: `${roomId}-outer-s`, p: { x: xMin, z: zMax }, q: { x: xMax, z: zMax }, kind: 'outer', openings: [] },
    { id: `${roomId}-outer-w`, p: { x: xMin, z: zMin }, q: { x: xMin, z: zMax }, kind: 'outer', openings: [] },
  ]
  return specs.map((s) => finalizeWall(s, centre, ceilingHeight))
}

// ── Capacité ─────────────────────────────────────────────────────────────

/**
 * Nombre d'œuvres qu'une salle peut recevoir, murs et ouvertures compris.
 *
 * Le compte par mur vient de `hanging.ts`, qui accrochera pour de bon : la
 * boucle d'agrandissement de l'atrium et l'accrochage final raisonnent ainsi
 * sur la MÊME définition de la capacité. Deux formules concurrentes, et la
 * garantie « quand on arrive au mur, la place est déjà là » ne vaudrait rien.
 */
export function roomCapacity(room: Room): number {
  let total = 0
  for (const wall of room.walls) total += wallCapacity(wall)
  return total
}

// ── Rampe ────────────────────────────────────────────────────────────────

/** Pente d'une rampe hélicoïdale, en radians. */
export function rampSlope(ramp: Ramp): number {
  return Math.atan(ramp.rise / (ramp.radius * ramp.sweep))
}

export function rampSlopeDegrees(ramp: Ramp): number {
  return (rampSlope(ramp) * 180) / Math.PI
}

/**
 * Une rampe par paire de niveaux consécutifs, en hélice continue : chaque volée
 * repart là où la précédente s'arrête.
 *
 * Le balayage est de π par niveau (demi-tour, spec §7.5) — sauf si la pente qui
 * en résulte dépasse la cible. On ajoute alors des demi-tours jusqu'à
 * redescendre sous la cible : sur un atrium minimal ou un plafond aberrant, un
 * demi-tour ne suffit pas et la sûreté prime sur la figure imposée.
 */
function planRamps(floors: Floor[], atrium: Rect, config: MuseumConfig): Ramp[] {
  const { ceilingHeight, slabThickness } = config.building
  const rise = round(ceilingHeight + slabThickness)
  const radius = round(Math.max(RAMP_MIN_RADIUS, atrium.width / 2 - RAMP_INNER_MARGIN))
  const centre: Vec2 = { x: round(atrium.x + atrium.width / 2), z: round(atrium.z + atrium.depth / 2) }

  let halfTurns = 1
  while (
    halfTurns < RAMP_MAX_HALF_TURNS &&
    Math.atan(rise / (radius * halfTurns * Math.PI)) >= RAMP_TARGET_SLOPE
  ) {
    halfTurns++
  }
  const sweep = round(halfTurns * Math.PI)

  const ramps: Ramp[] = []
  let angle = 0
  for (let i = 0; i + 1 < floors.length; i++) {
    const from = floors[i]
    const to = floors[i + 1]
    ramps.push({
      id: `ramp-${from.id}-${to.id}`,
      fromFloor: from.id,
      toFloor: to.id,
      centre,
      radius,
      startAngle: round(angle % (2 * Math.PI)),
      sweep,
      width: RAMP_WIDTH,
      rise,
      baseElevation: from.elevation,
    })
    angle += sweep
  }
  return ramps
}

// ── Assemblage ───────────────────────────────────────────────────────────

function floorId(level: number): string {
  if (level < 0) return 'reserve'
  if (level === 0) return 'rdc'
  return `etage-${level}`
}

function floorName(level: number): string {
  if (level < 0) return 'Réserve'
  if (level === 0) return 'Rez-de-chaussée'
  return `Étage ${level}`
}

/**
 * Thème par défaut d'une salle. La curation peut tout remplacer ; ce qui compte
 * ici est que la réserve et la salle d'honneur ne ressemblent pas aux autres.
 */
function defaultTheme(kind: 'vault' | 'honour' | 'collection'): ThemeId {
  if (kind === 'vault') return 'vault'
  if (kind === 'honour') return 'immersive'
  return 'classic'
}

/** Emprise hors tout du bâtiment : l'atrium plus l'anneau. */
function buildingFootprint(atrium: Rect, roomDepth: number): Rect {
  return {
    x: round(atrium.x - roomDepth),
    z: round(atrium.z - roomDepth),
    width: round(atrium.width + 2 * roomDepth),
    depth: round(atrium.depth + 2 * roomDepth),
  }
}

/** Découpe les clusters en plateaux de `roomsPerFloor` salles. */
function chunkClusters(clusters: Cluster[], roomsPerFloor: number): Cluster[][] {
  const taille = Math.max(1, Math.floor(roomsPerFloor))
  const plateaux: Cluster[][] = []
  for (let i = 0; i < clusters.length; i += taille) plateaux.push(clusters.slice(i, i + taille))
  return plateaux
}

/**
 * Frontières des emplacements le long d'un côté.
 *
 * Calculées en cumulé puis arrondies, la dernière forcée sur la fin du côté : la
 * somme des emprises vaut exactement la longueur, sans liseré ni recouvrement.
 */
function slotBounds(strip: Strip, widths: number[]): number[] {
  const bornes: number[] = [strip.start]
  let cumul = 0
  for (let i = 0; i < widths.length; i++) {
    cumul += widths[i]
    bornes.push(i === widths.length - 1 ? round(strip.start + strip.length) : round(strip.start + cumul))
  }
  return bornes
}

/**
 * Vrai si le passage d'angle est ouvert en face, c'est-à-dire si une salle de
 * l'aile perpendiculaire couvre entièrement l'emprise donnée. Toujours vrai pour
 * le Nord et le Sud, qui finissent sur la façade et n'ont pas d'angle en face.
 */
type CornerGate = (footprint: Rect, bout: 0 | 1) => boolean

const CORNER_ALWAYS: CornerGate = () => true

/** Bâtit les salles et les galeries d'un côté à partir d'un découpage donné. */
function buildSlots(
  id: string,
  strip: Strip,
  bin: Cluster[],
  slots: Slot[],
  atrium: Rect,
  ceilingHeight: number,
  angle: CornerGate = CORNER_ALWAYS,
): Room[] {
  const bornes = slotBounds(strip, slots.map((s) => s.width))
  let galerie = 0

  return slots.map((slot, i) => {
    const footprint = roomFootprint(strip, bornes[i], bornes[i + 1])
    if (slot.cluster < 0) {
      const roomId = `${id}-${strip.side}-galerie-${galerie++}`
      return {
        id: roomId,
        name: BLIND_GALLERY_NAME,
        side: strip.side,
        footprint,
        theme: defaultTheme('collection'),
        walls: ringRoomWalls(roomId, footprint, strip, atrium, ceilingHeight, BLIND),
        topics: [],
        keys: [],
      }
    }

    // Une porte ne s'ouvre que sur une salle de collection. En bout de côté,
    // l'Est et l'Ouest débouchent sur l'angle du Nord ou du Sud — la porte y est
    // la contrepartie du passage d'angle percé en face —, sauf si une galerie
    // aveugle occupe ce bout : elle mure le passage, l'ouvrir donnerait sur un
    // cul-de-sac. Le Nord et le Sud, eux, finissent sur la façade.
    const salleAvant = i > 0 && slots[i - 1].cluster >= 0
    const salleApres = i + 1 < slots.length && slots[i + 1].cluster >= 0
    const enAngle = strip.axis === 'z'
    const cluster = bin[slot.cluster]
    const roomId = `${id}-${strip.side}-${slot.cluster}`
    return {
      id: roomId,
      name: cluster.name,
      side: strip.side,
      footprint,
      theme: defaultTheme('collection'),
      walls: ringRoomWalls(roomId, footprint, strip, atrium, ceilingHeight, {
        doorA: salleAvant || (enAngle && i === 0 && angle(footprint, 0)),
        doorB: salleApres || (enAngle && i === slots.length - 1 && angle(footprint, 1)),
        inner: true,
      }),
      topics: [...cluster.topics],
      keys: [...cluster.keys],
    }
  })
}

/**
 * Les salles d'un côté, dimensionnées par leur besoin, plus les galeries
 * aveugles qui comblent le reliquat.
 *
 * La largeur visée n'est qu'une estimation : elle ignore la granularité des
 * segments — un mur de 2,4 m offert en deux morceaux de 1,2 m n'accroche rien.
 * On MESURE donc la capacité réelle, avec la fonction qui accrochera pour de
 * bon, et on élargit les salles en manque en prenant sur les galeries. Sans
 * cette boucle, la boucle d'atrium de `planBuilding` tournerait dans le vide :
 * agrandir l'atrium rallonge le côté mais n'élargit plus les salles, puisque
 * c'est désormais leur besoin qui les dimensionne.
 *
 * Repli quand rien ne tient : la subdivision proportionnelle du lot 1, qui étire
 * les salles sur tout le côté. Le bâtiment est alors moins beau mais toujours
 * juste, et c'est l'atrium qui grandira.
 */
function sideRooms(
  id: string,
  strip: Strip,
  bin: Cluster[],
  atrium: Rect,
  config: MuseumConfig,
  angle: CornerGate,
): Room[] {
  const { roomDepth, minRoomWidth, ceilingHeight } = config.building
  const targets = bin.map((c) =>
    targetRoomWidth(clusterWeight(c), roomDepth, minRoomWidth, strip.length),
  )

  for (let pass = 0; pass <= MAX_SIZING_PASSES; pass++) {
    const slots = planSideSlots(strip.length, targets, minRoomWidth)
    if (!slots) break

    const rooms = buildSlots(id, strip, bin, slots, atrium, ceilingHeight, angle)
    const manques = rooms.map((r) => (r.keys.length > 0 ? r.keys.length - roomCapacity(r) : 0))
    if (manques.every((m) => m <= 0)) return rooms

    // Élargissement proportionnel au manque : une salle à qui il manque trois
    // œuvres a besoin de trois fois plus de mur, réparti sur les deux murs longs.
    let bouge = false
    slots.forEach((slot, i) => {
      if (manques[i] <= 0 || slot.cluster < 0) return
      const gain = Math.max(SIZING_GROWTH_STEP, (manques[i] * (REF_ARTWORK_WIDTH + MIN_ARTWORK_GAP)) / 2)
      targets[slots[i].cluster] = round(targets[slots[i].cluster] + gain)
      bouge = true
    })
    if (!bouge) break
  }

  const widths = subdivideSide(strip.length, bin.map(clusterWeight), minRoomWidth)
  return buildSlots(
    id,
    strip,
    bin,
    widths.map((width, cluster) => ({ width, cluster })),
    atrium,
    ceilingHeight,
    angle,
  )
}

/**
 * Les salles d'un plateau de collections, réparties sur les quatre côtés.
 *
 * Les galeries aveugles sont rejetées en fin de liste : elles ne sont pas des
 * salles au sens du visiteur, et tout ce qui parcourt `floor.rooms` — cartels,
 * curation, statistiques — doit tomber sur les vraies d'abord.
 */
function collectionRooms(
  id: string,
  clusters: Cluster[],
  atrium: Rect,
  config: MuseumConfig,
): Room[] {
  const { roomDepth, minRoomWidth, ceilingHeight } = config.building
  const strips = ringStrips(atrium, roomDepth)
  const bins = distributeToSides(clusters, strips, minRoomWidth, roomDepth)

  /** Un côté à la fois, dans son ordre canonique, galeries comprises. */
  const parCote = (s: number, angle: CornerGate): Room[] => {
    const strip = strips[s]
    // Invariant d'enveloppe (spec §7.2) : les quatre côtés existent toujours. Un
    // côté dont le bac est vide — cas courant dès que `roomsPerFloor` descend
    // sous 4 — reçoit une galerie aveugle sur toute sa longueur. Sans elle, la
    // dalle s'arrête sans mur et le visiteur tombe.
    if (bins[s].length === 0) {
      if (strip.length < minRoomWidth) return []
      const tout: Slot[] = [{ width: strip.length, cluster: -1 }]
      return buildSlots(id, strip, [], tout, atrium, ceilingHeight)
    }
    return sideRooms(id, strip, bins[s], atrium, config, angle)
  }

  // Le Nord et le Sud d'abord : ce sont eux qui possèdent les quatre angles, et
  // l'Est et l'Ouest ont besoin de savoir ce qui s'y trouve avant de percer
  // leurs portes de bout. Une porte face à une galerie aveugle donnerait sur un
  // mur plein, puisque la galerie, elle, ne perce rien.
  const nord = parCote(0, CORNER_ALWAYS)
  const sud = parCote(2, CORNER_ALWAYS)

  /** Vrai si une salle de collection du Nord (bout 0) ou du Sud (bout 1) couvre tout l'angle. */
  const angle: CornerGate = (footprint, bout) =>
    (bout === 0 ? nord : sud).some(
      (r) =>
        !isBlindGallery(r) &&
        r.footprint.x <= footprint.x + EPS &&
        r.footprint.x + r.footprint.width >= footprint.x + footprint.width - EPS,
    )

  const parStrip = [nord, parCote(1, angle), sud, parCote(3, angle)]
  const rooms: Room[] = []
  const galeries: Room[] = []
  for (const room of parStrip.flat()) {
    if (isBlindGallery(room)) galeries.push(room)
    else rooms.push(room)
  }

  return [...rooms, ...galeries]
}

/**
 * Vrai pour une galerie aveugle : un volume qui ferme l'enveloppe, sans cluster,
 * sans accrochage, sans ouverture. Le test porte sur l'identifiant, seul champ
 * que la curation ne peut pas réécrire (elle peut renommer, pas renuméroter).
 *
 * `derive()` doit s'en servir pour ne pas les compter dans `stats.roomCount`
 * (spec §7.2) ni les proposer comme cible de curation.
 */
export function isBlindGallery(room: Room): boolean {
  return /-galerie-\d+$/.test(room.id)
}

/**
 * Salle d'honneur : tout le côté Nord du rez-de-chaussée. Elle est seule à son
 * niveau — c'est le niveau d'accueil, on ne le charge pas.
 *
 * Elle échappe volontairement au dimensionnement par le besoin : une salle
 * d'honneur est monumentale par définition, et c'est la seule du bâtiment dont
 * l'échelle soit un parti pris plutôt qu'un défaut.
 */
function honourRoom(featured: RepoKey[], atrium: Rect, config: MuseumConfig): Room {
  const { roomDepth, ceilingHeight } = config.building
  const strip = ringStrips(atrium, roomDepth)[0]
  const roomId = 'rdc-honneur'
  const footprint = roomFootprint(strip, strip.start, round(strip.start + strip.length))
  return {
    id: roomId,
    name: "Salle d'honneur",
    side: strip.side,
    footprint,
    theme: defaultTheme('honour'),
    walls: ringRoomWalls(roomId, footprint, strip, atrium, ceilingHeight, {
      doorA: false,
      doorB: false,
      inner: true,
    }),
    topics: [],
    keys: [...featured],
  }
}

/** Réserve : une seule grande salle occupant toute l'emprise (spec §7.1). */
function vaultRoom(vault: RepoKey[], atrium: Rect, config: MuseumConfig): Room {
  const footprint = buildingFootprint(atrium, config.building.roomDepth)
  const roomId = 'reserve-salle'
  return {
    id: roomId,
    name: 'Réserve',
    side: 'north',
    footprint,
    theme: defaultTheme('vault'),
    walls: boxWalls(roomId, footprint, config.building.ceilingHeight),
    topics: [],
    keys: [...vault],
  }
}

/** Une passe de disposition à taille d'atrium fixée. */
function layoutAttempt(input: LayoutInput, atriumSize: number): BuildingPlan {
  const { clusters, featured, vault, config } = input
  const { roomDepth, ceilingHeight, roomsPerFloor } = config.building
  const atrium: Rect = {
    x: round(-atriumSize / 2),
    z: round(-atriumSize / 2),
    width: round(atriumSize),
    depth: round(atriumSize),
  }
  const footprint = buildingFootprint(atrium, roomDepth)

  const niveaux: { level: number; rooms: Room[] }[] = []
  if (vault.length > 0) niveaux.push({ level: -1, rooms: [vaultRoom(vault, atrium, config)] })
  niveaux.push({ level: 0, rooms: featured.length > 0 ? [honourRoom(featured, atrium, config)] : [] })
  // Les collections montent par taille décroissante (spec §7.1) : les grosses
  // salles au premier étage, les cabinets tout en haut.
  chunkClusters(sortClusters(clusters), roomsPerFloor).forEach((plateau, i) => {
    const level = i + 1
    niveaux.push({ level, rooms: collectionRooms(floorId(level), plateau, atrium, config) })
  })

  const plusBas = niveaux[0].level
  const floors: Floor[] = niveaux.map(({ level, rooms: brutes }) => {
    // Avant tout le reste : un mur mitoyen posé sur le pourtour EST un mur de
    // façade, quel que soit son étiquetage d'origine.
    const rooms = reclassifyPerimeterWalls(footprint, brutes)
    return {
    id: floorId(level),
    name: floorName(level),
    level,
    elevation: elevationOf(level, config),
    ceilingHeight: round(ceilingHeight),
    rooms,
    // Après les salles, jamais avant : la fermeture se calcule sur ce qu'elles
    // laissent réellement ouvert.
    enclosure: enclosureWalls(footprint, rooms, round(ceilingHeight)),
    // La dalle la plus basse est pleine : il n'y a rien en dessous à découvrir.
    slabHoles: level === plusBas ? [] : [{ ...atrium }],
    footprint: { ...footprint },
    }
  })

  return { floors, ramps: planRamps(floors, atrium, config), atrium }
}

/**
 * Plan complet du bâtiment.
 *
 * La boucle de capacité (spec §7.2.3) est ce qui rend l'accrochage total :
 * tant qu'une salle ne peut pas recevoir son cluster, on élargit l'atrium de
 * deux mètres — ce qui rallonge les quatre côtés — et on recommence. Dix
 * itérations au plus ; au-delà, `derive()` doit réduire `maxClusterSize` et
 * relancer le clustering, ce qui n'est pas du ressort de ce module.
 *
 * La réserve est hors de la boucle : son accrochage est dense, sur plusieurs
 * rangs, et l'estimation à un rang la ferait grossir l'atrium indéfiniment.
 */
export function planBuilding(input: LayoutInput): BuildingPlan {
  const base = Math.max(
    input.config.building.minAtriumSize,
    // L'atrium doit au minimum loger l'hélice, sinon la rampe naît hors du vide.
    2 * (RAMP_MIN_RADIUS + RAMP_INNER_MARGIN),
  )

  let plan = layoutAttempt(input, base)
  for (let i = 1; i <= MAX_LAYOUT_ITERATIONS; i++) {
    const manque = plan.floors.some(
      (f) =>
        f.level >= 0 && f.rooms.some((r) => roomCapacity(r) < r.keys.length),
    )
    if (!manque) break
    plan = layoutAttempt(input, base + i * ATRIUM_GROWTH_STEP)
  }
  return plan
}
