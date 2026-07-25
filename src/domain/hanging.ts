/**
 * LOT 1 — Accrochage des œuvres sur les murs (spec § 7.4).
 *
 * Module purement arithmétique : aucun import de `three` ni de `react`, il doit
 * tourner dans vitest sans canvas et dans Node au moment du build.
 *
 * Trois garanties tenues par tout ce fichier :
 *
 *   1. DÉTERMINISME. Aucun aléa, aucune horloge. Les départages d'égalité se
 *      font par clé alphabétique, si bien que le résultat ne dépend même pas de
 *      l'ordre dans lequel les entrées arrivent.
 *   2. AUCUN CHEVAUCHEMENT. Deux placements d'un même mur ne se recouvrent
 *      jamais, `pinned` compris, et tiennent entièrement dans les segments
 *      utiles (donc hors marges d'angle et hors ouvertures).
 *   3. TOTALITÉ. Aucune exception, jamais. Quand la place manque vraiment —
 *      après les 5 réductions autorisées — la fonction accroche ce qui rentre et
 *      abandonne le reste, en commençant par les dépôts les moins étoilés.
 *
 * L'abandon est censé rester théorique : la boucle de capacité de § 7.2
 * (`wallCapacity(mur) ≥ taille du cluster`, sinon on agrandit l'atrium) garantit
 * la place en amont. Mais `hangWall` reste appelable seul, notamment par
 * l'éditeur, et un éditeur ne doit pas pouvoir faire tomber la scène.
 */
import type { Placement, RepoKey, Room, Wall } from './types'
import {
  MAX_ARTWORK_GAP,
  MIN_ARTWORK_GAP,
  MIN_USABLE_SEGMENT,
  MUSEUM_HANG_HEIGHT,
  WALL_CORNER_MARGIN,
} from './types'

// ── Constantes propres à l'accrochage ────────────────────────────────────

/** Ratio largeur/hauteur par défaut : celui des OG images GitHub. */
export const DEFAULT_ASPECT = 2

/** Bornes de la taille d'une œuvre, en mètres (§ 7.4). */
export const MIN_ARTWORK_HEIGHT = 0.5
export const MAX_ARTWORK_HEIGHT = 1.6

/**
 * Hauteur de l'œuvre de référence servant à estimer la capacité d'un mur.
 *
 * 0,90 m correspond à ~40 étoiles. C'est très au-dessus de la médiane d'un
 * corpus réel (la moitié des dépôts n'ont aucune étoile et mesurent donc 0,50 m)
 * : la capacité annoncée est volontairement pessimiste, pour que la boucle
 * d'agrandissement de l'atrium se termine du bon côté — une salle trop grande
 * est un défaut esthétique, une salle trop petite perd des œuvres.
 */
export const AVERAGE_ARTWORK_HEIGHT = 0.9

/** Nombre maximal de réductions de 10 % avant d'abandonner une œuvre. */
export const MAX_SHRINK_STEPS = 5
const SHRINK_FACTOR = 0.9
const MIN_SHRINK = SHRINK_FACTOR ** MAX_SHRINK_STEPS

/** Tolérance de comparaison : on manipule des mètres, le micron suffit. */
const EPS = 1e-9

// ── Types publics ────────────────────────────────────────────────────────

export interface HangEntry {
  key: RepoKey
  stars: number
  aspect: number
  atlas: number
  layer: number
  /**
   * Position imposée par la curation. `wallId` n'est lu que par `hangRoom`,
   * qui doit savoir sur quel mur router l'épingle ; `hangWall` l'ignore, son
   * appelant a déjà choisi le mur.
   */
  pinned?: { u: number; scale?: number; wallId?: string }
}

export interface HangOptions {
  /** Hauteur d'axe imposée. Par défaut `MUSEUM_HANG_HEIGHT` (§ 7.4). */
  centerHeight?: number
}

/** Intervalle le long du mur, en mètres depuis l'extrémité `a`. */
export interface Segment {
  start: number
  end: number
}

// ── Géométrie du mur ─────────────────────────────────────────────────────

export function wallLength(wall: Wall): number {
  const dx = wall.b.x - wall.a.x
  const dz = wall.b.z - wall.a.z
  return Math.hypot(dx, dz)
}

/**
 * Les intervalles du mur réellement accrochables : longueur totale moins les
 * marges d'angle, moins les ouvertures, et seulement ce qui reste plus long que
 * `MIN_USABLE_SEGMENT`.
 *
 * Une ouverture est retirée sur toute la hauteur du mur, quelle que soit la
 * sienne : accrocher au-dessus d'une porte est un choix de scénographe, pas un
 * choix d'algorithme.
 */
export function usableSegments(wall: Wall): Segment[] {
  const length = wallLength(wall)
  const span: Segment = { start: WALL_CORNER_MARGIN, end: length - WALL_CORNER_MARGIN }
  if (span.end - span.start < MIN_USABLE_SEGMENT) return []

  const holes = (wall.openings ?? []).map((o) => ({
    start: Math.min(o.start, o.end),
    end: Math.max(o.start, o.end),
  }))
  return carve([span], holes).filter((s) => s.end - s.start >= MIN_USABLE_SEGMENT - EPS)
}

/**
 * Combien d'œuvres de taille moyenne ce mur peut recevoir, espacement minimal
 * compris. Sert à la vérification de capacité de § 7.2, avant même que les
 * œuvres soient connues — d'où l'œuvre de référence plutôt que des tailles
 * réelles.
 */
export function wallCapacity(wall: Wall, averageHeight: number = AVERAGE_ARTWORK_HEIGHT): number {
  const width = Math.max(0, averageHeight) * DEFAULT_ASPECT
  if (!(width > 0)) return 0
  let total = 0
  for (const seg of usableSegments(wall)) {
    const length = seg.end - seg.start
    total += Math.max(0, Math.floor((length - MIN_ARTWORK_GAP) / (width + MIN_ARTWORK_GAP)))
  }
  return total
}

// ── Taille d'une œuvre ───────────────────────────────────────────────────

/** h = clamp(0.50 + 0.25 × log10(1 + étoiles), 0.50, 1.60) (§ 7.4). */
export function artworkHeight(stars: number): number {
  const safe = Number.isFinite(stars) && stars > 0 ? stars : 0
  const h = MIN_ARTWORK_HEIGHT + 0.25 * Math.log10(1 + safe)
  return Math.min(MAX_ARTWORK_HEIGHT, Math.max(MIN_ARTWORK_HEIGHT, h))
}

/**
 * Taille finale d'une œuvre. `shrink` est le facteur de réduction commun au
 * segment ; le `scale` d'un `pinned` s'y multiplie, c'est la seule volonté
 * humaine que l'algorithme n'a pas le droit de renégocier.
 */
export function artworkSize(entry: HangEntry, shrink = 1): { width: number; height: number } {
  const aspect =
    Number.isFinite(entry.aspect) && entry.aspect > 0 ? entry.aspect : DEFAULT_ASPECT
  const scale = entry.pinned && Number.isFinite(entry.pinned.scale ?? 1) ? (entry.pinned.scale ?? 1) : 1
  const height = artworkHeight(entry.stars) * shrink * Math.max(0, scale)
  return { width: height * aspect, height }
}

// ── Accrochage d'un mur ──────────────────────────────────────────────────

/**
 * Accroche `entries` sur `wall` et renvoie les placements triés le long du mur.
 *
 * Déroulé : les `pinned` d'abord, à leur `u` imposé (ceux qui débordent d'un
 * segment utile ou qui en recouvrent un autre sont écartés) ; puis les segments
 * restants sont recreusés autour d'eux, avec `MIN_ARTWORK_GAP` de réserve, et
 * les œuvres automatiques y sont réparties.
 *
 * Ne lève jamais. Les œuvres qui ne rentrent nulle part sont simplement absentes
 * du résultat.
 */
export function hangWall(wall: Wall, entries: HangEntry[], options: HangOptions = {}): Placement[] {
  const segments = usableSegments(wall)
  const centerHeight = axisHeight(wall, options)
  const placements: Placement[] = []

  // Les épingles se posent dans l'ordre du mur : à conflit égal, c'est celle qui
  // est le plus près de `a` qui gagne, et non celle qui est arrivée la première
  // dans le tableau — sinon le résultat dépendrait de l'ordre d'entrée.
  const pinned = entries.filter((e) => e.pinned).sort(byPinnedPosition)
  const taken: Segment[] = []
  for (const entry of pinned) {
    const size = artworkSize(entry)
    const u = entry.pinned!.u
    const span: Segment = { start: u - size.width / 2, end: u + size.width / 2 }
    if (!Number.isFinite(u) || !(size.width > 0)) continue
    const inside = segments.some((s) => span.start >= s.start - EPS && span.end <= s.end + EPS)
    if (!inside) continue
    if (taken.some((t) => span.start < t.end - EPS && span.end > t.start + EPS)) continue
    taken.push(span)
    placements.push({
      key: entry.key,
      u,
      centerHeight,
      width: size.width,
      height: size.height,
      atlas: entry.atlas,
      layer: entry.layer,
      pinned: true,
    })
  }

  const free = freeSegments(segments, taken)
  const autos = entries.filter((e) => !e.pinned).sort(byStarsDesc)
  const buckets = allocate(free, autos)
  for (let i = 0; i < free.length; i++) {
    placements.push(...layoutSegment(free[i], buckets[i], centerHeight))
  }

  return placements.sort((a, b) => a.u - b.u || compareKeys(a.key, b.key))
}

/**
 * Répartit `entries` sur les murs de `room` et renvoie une COPIE de la salle :
 * ni la salle ni ses murs d'origine ne sont modifiés, l'éditeur a besoin de
 * pouvoir comparer avant/après.
 *
 * Une épingle dont le `wallId` ne désigne aucun mur de la salle est rattachée au
 * premier mur (dans l'ordre de `room.walls`) où son `u` tient ; si aucun mur ne
 * l'accepte, elle redevient une œuvre ordinaire plutôt que de disparaître.
 */
export function hangRoom(room: Room, entries: HangEntry[], options: HangOptions = {}): Room {
  const walls = room.walls ?? []
  const perWall = new Map<string, HangEntry[]>()
  for (const wall of walls) perWall.set(wall.id, [])

  const segmentsByWall = walls.map((wall) => usableSegments(wall))
  const autos: HangEntry[] = []

  for (const entry of [...entries].sort(byKey)) {
    if (!entry.pinned) {
      autos.push(entry)
      continue
    }
    const width = artworkSize(entry).width
    const u = entry.pinned.u
    const fits = (i: number) =>
      segmentsByWall[i].some((s) => u - width / 2 >= s.start - EPS && u + width / 2 <= s.end + EPS)
    let index = walls.findIndex((w) => w.id === entry.pinned!.wallId)
    if (index < 0 || !fits(index)) index = segmentsByWall.findIndex((_, i) => fits(i))
    if (index < 0) {
      // L'épingle est inaccrochable telle quelle : on la dégrade en œuvre
      // automatique. Perdre la position voulue vaut mieux que perdre l'œuvre.
      autos.push({
        key: entry.key,
        stars: entry.stars,
        aspect: entry.aspect,
        atlas: entry.atlas,
        layer: entry.layer,
      })
      continue
    }
    perWall.get(walls[index].id)!.push(entry)
  }

  // Répartition globale : on alloue sur l'union des segments libres de tous les
  // murs, pour que les grands murs prennent plus d'œuvres que les petits.
  const flatSegments: Segment[] = []
  const flatWalls: string[] = []
  walls.forEach((wall, i) => {
    const taken = perWall
      .get(wall.id)!
      .map((e) => {
        const w = artworkSize(e).width
        return { start: e.pinned!.u - w / 2, end: e.pinned!.u + w / 2 }
      })
    for (const seg of freeSegments(segmentsByWall[i], taken)) {
      flatSegments.push(seg)
      flatWalls.push(wall.id)
    }
  })

  const buckets = allocate(flatSegments, autos.sort(byStarsDesc))
  buckets.forEach((bucket, i) => perWall.get(flatWalls[i])!.push(...bucket))

  return {
    ...room,
    walls: walls.map((wall) => ({
      ...wall,
      placements: hangWall(wall, perWall.get(wall.id)!, options),
    })),
  }
}

// ── Interne ──────────────────────────────────────────────────────────────

/**
 * Hauteur d'axe : le standard muséal, ramené dans le mur si celui-ci est trop
 * bas pour l'accepter (cas de la réserve, où les plafonds sont écrasés).
 */
function axisHeight(wall: Wall, options: HangOptions): number {
  const wanted = Number.isFinite(options.centerHeight ?? NaN)
    ? (options.centerHeight as number)
    : MUSEUM_HANG_HEIGHT
  const half = MAX_ARTWORK_HEIGHT / 2
  if (!Number.isFinite(wall.height) || wall.height < 2 * half) return wanted
  return Math.min(wall.height - half, Math.max(half, wanted))
}

/**
 * Les segments encore libres autour des œuvres déjà posées. Les intervalles pris
 * sont élargis de `MIN_ARTWORK_GAP` de chaque côté : c'est ce qui empêche une
 * œuvre automatique de venir se coller à une épingle.
 */
function freeSegments(segments: Segment[], taken: Segment[]): Segment[] {
  if (taken.length === 0) return segments
  const holes = taken.map((t) => ({
    start: t.start - MIN_ARTWORK_GAP,
    end: t.end + MIN_ARTWORK_GAP,
  }))
  return carve(segments, holes).filter((s) => s.end - s.start >= MIN_USABLE_SEGMENT - EPS)
}

/** Soustrait `holes` de `ranges`. Les trous peuvent se chevaucher ou déborder. */
function carve(ranges: Segment[], holes: Segment[]): Segment[] {
  const sorted = holes
    .filter((h) => h.end > h.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const out: Segment[] = []
  for (const range of ranges) {
    let cursor = range.start
    for (const hole of sorted) {
      if (hole.end <= cursor) continue
      if (hole.start >= range.end) break
      if (hole.start > cursor) out.push({ start: cursor, end: Math.min(hole.start, range.end) })
      cursor = Math.max(cursor, hole.end)
      if (cursor >= range.end) break
    }
    if (cursor < range.end) out.push({ start: cursor, end: range.end })
  }
  return out
}

/**
 * Distribue les œuvres, du plus étoilé au moins étoilé, sur le segment le moins
 * rempli qui peut encore les prendre — proportionnellement, donc, à la longueur
 * disponible. Une œuvre qui ne rentre nulle part, même en acceptant la réduction
 * maximale, est abandonnée : c'est ce qui rend l'accrochage total.
 */
function allocate(segments: Segment[], entries: HangEntry[]): HangEntry[][] {
  const buckets: HangEntry[][] = segments.map(() => [])
  const lengths = segments.map((s) => s.end - s.start)
  // `free` vaut à tout instant longueur − Σlargeurs − (n+1)×écart minimal :
  // il est positif exactement tant que le groupe tient à taille pleine.
  const free = lengths.map((l) => l - MIN_ARTWORK_GAP)

  for (const entry of entries) {
    const width = artworkSize(entry).width
    if (!(width > 0)) continue

    let best = -1
    let bestRatio = -Infinity
    for (let i = 0; i < segments.length; i++) {
      if (free[i] < width + MIN_ARTWORK_GAP - EPS) continue
      const ratio = free[i] / lengths[i]
      if (ratio > bestRatio) {
        bestRatio = ratio
        best = i
      }
    }

    // Second tour : plus rien ne rentre à taille pleine, mais les 5 réductions
    // autorisées peuvent encore sauver l'œuvre.
    if (best < 0) {
      for (let i = 0; i < segments.length; i++) {
        const widths = [...buckets[i], entry].reduce((sum, e) => sum + artworkSize(e).width, 0)
        const count = buckets[i].length + 1
        if (widths * MIN_SHRINK + (count + 1) * MIN_ARTWORK_GAP > lengths[i] + EPS) continue
        const ratio = free[i] / lengths[i]
        if (ratio > bestRatio) {
          bestRatio = ratio
          best = i
        }
      }
    }

    if (best < 0) continue
    buckets[best].push(entry)
    free[best] -= width + MIN_ARTWORK_GAP
  }
  return buckets
}

/**
 * Pose un groupe d'œuvres sur un segment.
 *
 * Boucle de § 7.4 : écart = (longueur − Σlargeurs) / (n + 1) ; trop serré on
 * réduit tout de 10 % (5 fois au plus), trop lâche on plafonne l'écart et on
 * centre le groupe. Si les 5 réductions ne suffisent pas, on retire la moins
 * étoilée et on reprend — la fonction se termine donc toujours, éventuellement
 * sur un tableau vide.
 */
function layoutSegment(segment: Segment, entries: HangEntry[], centerHeight: number): Placement[] {
  const length = segment.end - segment.start
  const kept = [...entries]

  while (kept.length > 0) {
    const row = centerOutward(kept)
    let shrink = 1
    for (let step = 0; step <= MAX_SHRINK_STEPS; step++) {
      const sizes = row.map((e) => artworkSize(e, shrink))
      const sum = sizes.reduce((total, s) => total + s.width, 0)
      const gap = (length - sum) / (row.length + 1)
      if (gap >= MIN_ARTWORK_GAP - EPS) {
        const spacing = Math.min(gap, MAX_ARTWORK_GAP)
        // Écart plafonné : le groupe ne remplit plus le segment, on le centre
        // plutôt que de l'étaler jusqu'aux angles.
        const span = sum + (row.length - 1) * spacing
        let cursor =
          gap > MAX_ARTWORK_GAP ? segment.start + (length - span) / 2 : segment.start + spacing
        return row.map((entry, i) => {
          const u = cursor + sizes[i].width / 2
          cursor += sizes[i].width + spacing
          return {
            key: entry.key,
            u,
            centerHeight,
            width: sizes[i].width,
            height: sizes[i].height,
            atlas: entry.atlas,
            layer: entry.layer,
            pinned: false,
          }
        })
      }
      shrink *= SHRINK_FACTOR
    }
    kept.pop()
  }
  return []
}

/**
 * Ordonne un groupe déjà trié par étoiles décroissantes en une rangée
 * gauche→droite où la plus étoilée occupe le centre et les suivantes s'éloignent
 * en alternance : « l'œil se pose au centre » (§ 7.4).
 */
function centerOutward<T>(sorted: T[]): T[] {
  const row: T[] = []
  sorted.forEach((entry, i) => {
    if (i % 2 === 0) row.push(entry)
    else row.unshift(entry)
  })
  return row
}

function compareKeys(a: RepoKey, b: RepoKey): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function byKey(a: HangEntry, b: HangEntry): number {
  return compareKeys(a.key, b.key)
}

function byStarsDesc(a: HangEntry, b: HangEntry): number {
  const sa = Number.isFinite(a.stars) ? a.stars : 0
  const sb = Number.isFinite(b.stars) ? b.stars : 0
  return sb - sa || compareKeys(a.key, b.key)
}

function byPinnedPosition(a: HangEntry, b: HangEntry): number {
  return (a.pinned?.u ?? 0) - (b.pinned?.u ?? 0) || compareKeys(a.key, b.key)
}
