/**
 * LOT 1 — Disposition du bâtiment (spec §7.1, §7.2, §7.3, §7.5).
 *
 * Un atrium rectangulaire centré sur l'origine, un anneau de salles autour, une
 * rampe hélicoïdale dans le vide. Le bâtiment prend la forme du compte GitHub :
 * cinq dépôts donnent un plateau unique, deux mille donnent une tour.
 *
 * Deux invariants portent tout le reste :
 *
 *  - L'élévation est CALCULÉE depuis le niveau, jamais saisie. Deux étages ne
 *    peuvent donc pas se chevaucher, quoi qu'on écrive dans la configuration.
 *  - L'anneau est une PARTITION : Nord et Sud prennent les angles sur toute la
 *    largeur extérieure, Est et Ouest se limitent à la profondeur de l'atrium.
 *    Aucune emprise n'en recouvre une autre, sinon deux salles se disputeraient
 *    le même mètre carré de plancher.
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
import { WALL_CORNER_MARGIN } from './types'
import { wallCapacity } from './hanging'

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
 * Répartition en quatre bacs (spec §7.2.1) : clusters par poids décroissant,
 * chacun dans le côté le moins chargé.
 *
 * Un garde-fou en plus du spec : un côté ne peut pas recevoir plus de salles
 * qu'il n'en tient à `minRoomWidth`. Sans lui, l'Est et l'Ouest — qui ne font
 * que la profondeur de l'atrium — se verraient attribuer des salles de deux
 * mètres pendant que le Nord reste à moitié vide.
 */
function distributeToSides(clusters: Cluster[], strips: Strip[], minRoomWidth: number): Cluster[][] {
  const bins: Cluster[][] = strips.map(() => [])
  const loads = strips.map(() => 0)
  const capacity = strips.map((s) => Math.max(1, Math.floor(s.length / Math.max(0.1, minRoomWidth))))

  for (const cluster of sortClusters(clusters)) {
    let chosen = -1
    for (let i = 0; i < bins.length; i++) {
      if (bins[i].length >= capacity[i]) continue
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
  hasPrev: boolean,
  hasNext: boolean,
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
  const surAtrium = overlap(along[0], along[1], atriumSpan[0], atriumSpan[1])
  if (surAtrium) {
    const bay = centeredOpening(surAtrium[0], surAtrium[1], bayWidth, 'bay', bayHeight)
    if (bay) innerOpenings.push(bay)
  }
  // Portions d'angle : seuls le Nord et le Sud en ont, par construction de la
  // partition. `roomDepth` est la profondeur de l'aile perpendiculaire.
  if (strip.axis === 'x') {
    const depth = Math.abs(strip.outer - strip.inner)
    const corners: [number, number][] = [
      [round(atriumSpan[0] - depth), atriumSpan[0]],
      [atriumSpan[1], round(atriumSpan[1] + depth)],
    ]
    for (const [cLo, cHi] of corners) {
      const zone = overlap(along[0], along[1], cLo, cHi)
      if (!zone) continue
      const porte = clampedOpening(zone[0], zone[1], cLo, cHi, DOOR_WIDTH, 'door', DOOR_HEIGHT)
      if (porte) innerOpenings.push(porte)
    }
  }

  /**
   * Mur mitoyen : porte vers la salle voisine du même côté. En bout de côté,
   * l'Est et l'Ouest débouchent sur l'angle du Nord ou du Sud — la porte y est
   * la contrepartie du passage d'angle percé en face. Le Nord et le Sud, eux,
   * finissent sur la façade : rien à percer.
   */
  const sideOpenings = (voisin: boolean): OpeningSpec[] => {
    const lo = strip.axis === 'x' ? zMin : xMin
    const hi = strip.axis === 'x' ? zMax : xMax
    if (!voisin && strip.axis === 'x') return []
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
      { id: `${roomId}-side-a`, p: { x: xMin, z: zMin }, q: { x: xMin, z: zMax }, kind: 'side', openings: sideOpenings(hasPrev) },
      { id: `${roomId}-side-b`, p: { x: xMax, z: zMin }, q: { x: xMax, z: zMax }, kind: 'side', openings: sideOpenings(hasNext) },
      { id: `${roomId}-inner`, p: { x: xMin, z: zInner }, q: { x: xMax, z: zInner }, kind: 'inner', openings: innerOpenings },
    )
  } else {
    const xOuter = outerIsMax ? xMax : xMin
    const xInner = outerIsMax ? xMin : xMax
    specs.push(
      { id: `${roomId}-outer`, p: { x: xOuter, z: zMin }, q: { x: xOuter, z: zMax }, kind: 'outer', openings: [] },
      { id: `${roomId}-side-a`, p: { x: xMin, z: zMin }, q: { x: xMax, z: zMin }, kind: 'side', openings: sideOpenings(hasPrev) },
      { id: `${roomId}-side-b`, p: { x: xMin, z: zMax }, q: { x: xMax, z: zMax }, kind: 'side', openings: sideOpenings(hasNext) },
      { id: `${roomId}-inner`, p: { x: xInner, z: zMin }, q: { x: xInner, z: zMax }, kind: 'inner', openings: innerOpenings },
    )
  }

  return specs.map((s) => finalizeWall(s, centre, ceilingHeight))
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

/** Les salles d'un plateau de collections, réparties sur les quatre côtés. */
function collectionRooms(
  id: string,
  clusters: Cluster[],
  atrium: Rect,
  config: MuseumConfig,
): Room[] {
  const { roomDepth, minRoomWidth, ceilingHeight } = config.building
  const strips = ringStrips(atrium, roomDepth)
  const bins = distributeToSides(clusters, strips, minRoomWidth)
  const rooms: Room[] = []

  strips.forEach((strip, s) => {
    const bin = bins[s]
    if (bin.length === 0) return
    const widths = subdivideSide(strip.length, bin.map(clusterWeight), minRoomWidth)

    // Les frontières sont calculées en cumulé puis arrondies, et la dernière est
    // forcée sur la fin du côté : la somme des salles vaut exactement le côté.
    const bornes: number[] = [strip.start]
    let cumul = 0
    for (let i = 0; i < widths.length; i++) {
      cumul += widths[i]
      bornes.push(i === widths.length - 1 ? round(strip.start + strip.length) : round(strip.start + cumul))
    }

    bin.forEach((cluster, i) => {
      const roomId = `${id}-${strip.side}-${i}`
      const footprint = roomFootprint(strip, bornes[i], bornes[i + 1])
      rooms.push({
        id: roomId,
        name: cluster.name,
        side: strip.side,
        footprint,
        theme: defaultTheme('collection'),
        walls: ringRoomWalls(
          roomId,
          footprint,
          strip,
          atrium,
          ceilingHeight,
          i > 0,
          i < bin.length - 1,
        ),
        topics: [...cluster.topics],
        keys: [...cluster.keys],
      })
    })
  })

  return rooms
}

/**
 * Salle d'honneur : tout le côté Nord du rez-de-chaussée. Elle est seule à son
 * niveau — c'est le niveau d'accueil, on ne le charge pas.
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
    walls: ringRoomWalls(roomId, footprint, strip, atrium, ceilingHeight, false, false),
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
  const floors: Floor[] = niveaux.map(({ level, rooms }) => ({
    id: floorId(level),
    name: floorName(level),
    level,
    elevation: elevationOf(level, config),
    ceilingHeight: round(ceilingHeight),
    rooms,
    // La dalle la plus basse est pleine : il n'y a rien en dessous à découvrir.
    slabHoles: level === plusBas ? [] : [{ ...atrium }],
    footprint: { ...footprint },
  }))

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
