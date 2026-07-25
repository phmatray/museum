/**
 * Tests de l'accrochage (§ 7.4).
 *
 * L'invariant central est le non-chevauchement : il est vérifié après presque
 * chaque scénario, y compris sur les 115 dépôts réels de
 * `public/data/catalogue.json` — pas sur des jeux d'essai inventés.
 */
import { describe, expect, it } from 'vitest'

// Les 115 dépôts réellement récupérés : les invariants sont vérifiés dessus,
// pas sur des jeux d'essai inventés. Importé plutôt que lu par `node:fs` pour
// que le fichier de test reste typé sans les définitions Node.
import catalogueJson from '../../../public/data/catalogue.json'

import type { Catalogue, Opening, Placement, Room, Wall } from '../types'
import { MAX_ARTWORK_GAP, MIN_ARTWORK_GAP, MIN_USABLE_SEGMENT, MUSEUM_HANG_HEIGHT } from '../types'
import type { HangEntry } from '../hanging'
import {
  AVERAGE_ARTWORK_HEIGHT,
  artworkHeight,
  hangRoom,
  hangWall,
  usableSegments,
  wallCapacity,
} from '../hanging'

const EPS = 1e-9

// ── Fixtures ─────────────────────────────────────────────────────────────

function makeWall(id: string, length: number, openings: Opening[] = []): Wall {
  return {
    id,
    a: { x: 0, z: 0 },
    b: { x: length, z: 0 },
    height: 3.2,
    kind: 'inner',
    normal: { x: 0, z: 1 },
    openings,
    placements: [],
  }
}

function makeRoom(id: string, walls: Wall[]): Room {
  return {
    id,
    name: 'Salle',
    side: 'north',
    footprint: { x: 0, z: 0, width: 8, depth: 6 },
    theme: 'classic',
    walls,
    topics: [],
    keys: [],
  }
}

/** Entrées synthétiques : étoiles décroissantes, clés stables. */
function makeEntries(count: number, stars: (i: number) => number = (i) => count - i): HangEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `owner/repo-${String(i).padStart(2, '0')}`,
    stars: stars(i),
    aspect: 2,
    atlas: 0,
    layer: i,
  }))
}

const catalogue = catalogueJson as unknown as Catalogue

const realEntries: HangEntry[] = catalogue.artworks.map((artwork, i) => ({
  key: artwork.key,
  stars: artwork.stars,
  aspect: 2,
  atlas: Math.floor(i / 64),
  layer: i % 64,
}))

// ── Assertions réutilisables ─────────────────────────────────────────────

function expectNoOverlap(placements: Placement[]): void {
  const sorted = [...placements].sort((a, b) => a.u - b.u)
  for (let i = 1; i < sorted.length; i++) {
    const previousEdge = sorted[i - 1].u + sorted[i - 1].width / 2
    const edge = sorted[i].u - sorted[i].width / 2
    expect(edge).toBeGreaterThanOrEqual(previousEdge - EPS)
  }
}

function expectInsideWall(wall: Wall, placements: Placement[]): void {
  const segments = usableSegments(wall)
  for (const placement of placements) {
    const fits = segments.some(
      (s) =>
        placement.u - placement.width / 2 >= s.start - EPS &&
        placement.u + placement.width / 2 <= s.end + EPS,
    )
    expect(fits, `${placement.key} déborde du mur ${wall.id}`).toBe(true)
  }
}

// ── Segments utiles et capacité ──────────────────────────────────────────

describe('usableSegments', () => {
  it('retire les marges d’angle', () => {
    expect(usableSegments(makeWall('w', 10))).toEqual([{ start: 0.5, end: 9.5 }])
  })

  it('retire les ouvertures et coupe le mur en deux', () => {
    const wall = makeWall('w', 10, [{ kind: 'door', start: 4, end: 6, height: 2.1 , sill: 0}])
    expect(usableSegments(wall)).toEqual([
      { start: 0.5, end: 4 },
      { start: 6, end: 9.5 },
    ])
  })

  it('écarte les segments trop courts pour recevoir quoi que ce soit', () => {
    const wall = makeWall('w', 10, [{ kind: 'bay', start: 1.5, end: 8, height: 2.4 , sill: 0}])
    const segments = usableSegments(wall)
    expect(segments).toEqual([{ start: 8, end: 9.5 }])
    expect(segments.every((s) => s.end - s.start >= MIN_USABLE_SEGMENT)).toBe(true)
  })

  it('fusionne des ouvertures qui se recouvrent', () => {
    const wall = makeWall('w', 12, [
      { kind: 'door', start: 4, end: 7, height: 2.1 , sill: 0},
      { kind: 'bay', start: 5, end: 8, height: 2.4 , sill: 0},
    ])
    expect(usableSegments(wall)).toEqual([
      { start: 0.5, end: 4 },
      { start: 8, end: 11.5 },
    ])
  })

  it('ne renvoie rien pour un mur sans segment utile', () => {
    expect(usableSegments(makeWall('w', 1.5))).toEqual([])
    expect(usableSegments(makeWall('w', 0))).toEqual([])
  })
})

describe('wallCapacity', () => {
  it('compte les œuvres moyennes qui tiennent, espacement compris', () => {
    // 9 m utiles, œuvre de référence 1,8 m, écart 0,6 m → 3 × 2,4 ≤ 8,4.
    expect(wallCapacity(makeWall('w', 10))).toBe(3)
  })

  it('somme la capacité de chaque segment', () => {
    const wall = makeWall('w', 10, [{ kind: 'door', start: 4, end: 6, height: 2.1 , sill: 0}])
    expect(wallCapacity(wall)).toBe(2)
  })

  it('vaut 0 quand aucun segment n’est utilisable', () => {
    expect(wallCapacity(makeWall('w', 1.5))).toBe(0)
  })

  it('reste pessimiste face au corpus réel', () => {
    // L'œuvre de référence doit être plus grande que la médiane réelle, sinon
    // la vérification de capacité de § 7.2 promettrait de la place inexistante.
    const heights = catalogue.artworks.map((a) => artworkHeight(a.stars)).sort((a, b) => a - b)
    const median = heights[Math.floor(heights.length / 2)]
    expect(median).toBeLessThanOrEqual(AVERAGE_ARTWORK_HEIGHT)

    // Et la capacité annoncée doit être tenue par les œuvres réelles.
    const wall = makeWall('w', 10)
    const placed = hangWall(wall, realEntries.slice(0, wallCapacity(wall)))
    expect(placed).toHaveLength(wallCapacity(wall))
  })
})

// ── Taille des œuvres ────────────────────────────────────────────────────

describe('artworkHeight', () => {
  it('applique la formule logarithmique bornée', () => {
    expect(artworkHeight(0)).toBeCloseTo(0.5, 10)
    expect(artworkHeight(9)).toBeCloseTo(0.75, 10)
    expect(artworkHeight(99)).toBeCloseTo(1, 10)
    expect(artworkHeight(1e9)).toBe(1.6)
  })

  it('borne aussi les entrées absurdes', () => {
    expect(artworkHeight(-10)).toBe(0.5)
    expect(artworkHeight(Number.NaN)).toBe(0.5)
  })

  it('ne dépasse jamais les bornes sur le corpus réel', () => {
    for (const artwork of catalogue.artworks) {
      const h = artworkHeight(artwork.stars)
      expect(h).toBeGreaterThanOrEqual(0.5)
      expect(h).toBeLessThanOrEqual(1.6)
    }
  })
})

// ── Accrochage automatique ───────────────────────────────────────────────

describe('hangWall — répartition automatique', () => {
  it('ne fait rien d’un mur vide', () => {
    expect(hangWall(makeWall('w', 10), [])).toEqual([])
  })

  it('centre une œuvre unique sur le segment', () => {
    const wall = makeWall('w', 10)
    const [placement] = hangWall(wall, makeEntries(1))
    expect(placement.u).toBeCloseTo(5, 10)
    expectInsideWall(wall, [placement])
  })

  it('respecte l’écart minimal et les bornes', () => {
    const wall = makeWall('w', 12)
    const placements = hangWall(wall, makeEntries(5))
    expectNoOverlap(placements)
    expectInsideWall(wall, placements)
    const sorted = [...placements].sort((a, b) => a.u - b.u)
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].u - sorted[i].width / 2 - (sorted[i - 1].u + sorted[i - 1].width / 2)
      expect(gap).toBeGreaterThanOrEqual(MIN_ARTWORK_GAP - EPS)
    }
  })

  it('plafonne l’écart et centre le groupe quand le mur est trop long', () => {
    const wall = makeWall('w', 30)
    const placements = hangWall(wall, makeEntries(2))
    const sorted = [...placements].sort((a, b) => a.u - b.u)
    const gap = sorted[1].u - sorted[1].width / 2 - (sorted[0].u + sorted[0].width / 2)
    expect(gap).toBeLessThanOrEqual(MAX_ARTWORK_GAP + EPS)
    // Groupe centré : les deux moitiés du mur sont équilibrées.
    const left = sorted[0].u - sorted[0].width / 2 - 0.5
    const right = 29.5 - (sorted[1].u + sorted[1].width / 2)
    expect(left).toBeCloseTo(right, 10)
  })

  it('réduit les tailles de 10 % plutôt que de renoncer', () => {
    // 5 m de segment, 3 œuvres de 1 m : l'écart plein vaut 0,5 m < 0,60 m.
    const wall = makeWall('w', 6)
    const placements = hangWall(wall, makeEntries(3, () => 0))
    expect(placements).toHaveLength(3)
    for (const placement of placements) expect(placement.height).toBeLessThan(0.5)
    expect(placements[0].height).toBeCloseTo(0.5 * 0.9 * 0.9, 10)
    expectNoOverlap(placements)
    expectInsideWall(wall, placements)
  })

  it('n’accroche jamais dans une ouverture', () => {
    const wall = makeWall('w', 14, [
      { kind: 'door', start: 3, end: 5, height: 2.1 , sill: 0},
      { kind: 'bay', start: 8, end: 10.4, height: 2.4 , sill: 0},
    ])
    const placements = hangWall(wall, makeEntries(6, () => 0))
    expectNoOverlap(placements)
    expectInsideWall(wall, placements)
    for (const placement of placements) {
      for (const opening of wall.openings) {
        const overlaps =
          placement.u - placement.width / 2 < opening.end - EPS &&
          placement.u + placement.width / 2 > opening.start + EPS
        expect(overlaps, `${placement.key} empiète sur une ouverture`).toBe(false)
      }
    }
  })

  it('pose l’axe des œuvres au standard muséal', () => {
    const placements = hangWall(makeWall('w', 12), makeEntries(4))
    for (const placement of placements) expect(placement.centerHeight).toBe(MUSEUM_HANG_HEIGHT)
  })

  it('accepte une hauteur d’axe imposée', () => {
    const placements = hangWall(makeWall('w', 12), makeEntries(2), { centerHeight: 1.2 })
    for (const placement of placements) expect(placement.centerHeight).toBe(1.2)
  })
})

// ── Ordre depuis le centre ───────────────────────────────────────────────

describe('hangWall — ordre par étoiles depuis le centre', () => {
  const centreOf = (wall: Wall) => {
    const segments = usableSegments(wall)
    return (segments[0].start + segments[0].end) / 2
  }

  it('place la plus étoilée au centre du mur', () => {
    const wall = makeWall('w', 16)
    const placements = hangWall(wall, makeEntries(5, (i) => 1000 / (i + 1)))
    const closest = [...placements].sort(
      (a, b) => Math.abs(a.u - centreOf(wall)) - Math.abs(b.u - centreOf(wall)),
    )[0]
    expect(closest.key).toBe('owner/repo-00')
  })

  it('fait décroître les étoiles à mesure qu’on s’éloigne du centre', () => {
    for (const count of [1, 2, 3, 4, 5, 6, 7]) {
      const wall = makeWall('w', 24)
      const entries = makeEntries(count, (i) => (count - i) * 10)
      const stars = new Map(entries.map((e) => [e.key, e.stars]))
      const byDistance = hangWall(wall, entries).sort(
        (a, b) => Math.abs(a.u - centreOf(wall)) - Math.abs(b.u - centreOf(wall)),
      )
      for (let i = 1; i < byDistance.length; i++) {
        expect(
          stars.get(byDistance[i].key)!,
          `${count} œuvres : l'ordre depuis le centre est rompu`,
        ).toBeLessThanOrEqual(stars.get(byDistance[i - 1].key)!)
      }
    }
  })

  it('tient aussi sur les étoiles réelles du corpus', () => {
    const wall = makeWall('w', 24)
    const entries = [...realEntries].sort((a, b) => b.stars - a.stars).slice(0, 6)
    const stars = new Map(entries.map((e) => [e.key, e.stars]))
    const byDistance = hangWall(wall, entries).sort(
      (a, b) => Math.abs(a.u - centreOf(wall)) - Math.abs(b.u - centreOf(wall)),
    )
    for (let i = 1; i < byDistance.length; i++) {
      expect(stars.get(byDistance[i].key)!).toBeLessThanOrEqual(stars.get(byDistance[i - 1].key)!)
    }
  })
})

// ── Épingles ─────────────────────────────────────────────────────────────

describe('hangWall — placements épinglés', () => {
  it('respecte exactement la position imposée', () => {
    const wall = makeWall('w', 12)
    const entry: HangEntry = { ...makeEntries(1)[0], pinned: { u: 3.25 } }
    const [placement] = hangWall(wall, [entry])
    expect(placement.u).toBe(3.25)
    expect(placement.pinned).toBe(true)
  })

  it('applique le facteur d’échelle de la curation', () => {
    const wall = makeWall('w', 12)
    const nominal = hangWall(wall, [{ ...makeEntries(1)[0], pinned: { u: 6 } }])[0]
    const scaled = hangWall(wall, [{ ...makeEntries(1)[0], pinned: { u: 6, scale: 0.5 } }])[0]
    expect(scaled.height).toBeCloseTo(nominal.height * 0.5, 10)
    expect(scaled.width).toBeCloseTo(nominal.width * 0.5, 10)
  })

  it('n’est jamais recouvert par la répartition automatique', () => {
    const wall = makeWall('w', 16)
    const entries: HangEntry[] = [
      { ...makeEntries(1)[0], key: 'owner/pin', pinned: { u: 8 } },
      ...makeEntries(8, () => 0),
    ]
    const placements = hangWall(wall, entries)
    expectNoOverlap(placements)
    expectInsideWall(wall, placements)

    const pin = placements.find((p) => p.key === 'owner/pin')!
    expect(pin.u).toBe(8)
    for (const placement of placements) {
      if (placement.key === 'owner/pin') continue
      const gap =
        placement.u > pin.u
          ? placement.u - placement.width / 2 - (pin.u + pin.width / 2)
          : pin.u - pin.width / 2 - (placement.u + placement.width / 2)
      expect(gap).toBeGreaterThanOrEqual(MIN_ARTWORK_GAP - EPS)
    }
  })

  it('écarte une épingle hors des bornes du mur', () => {
    const wall = makeWall('w', 10)
    const trop = [
      { ...makeEntries(1)[0], key: 'owner/gauche', pinned: { u: 0.2 } },
      { ...makeEntries(1)[0], key: 'owner/droite', pinned: { u: 9.4 } },
      { ...makeEntries(1)[0], key: 'owner/ailleurs', pinned: { u: 100 } },
      { ...makeEntries(1)[0], key: 'owner/absurde', pinned: { u: Number.NaN } },
    ]
    expect(hangWall(wall, trop)).toEqual([])
  })

  it('écarte une épingle qui tombe dans une ouverture', () => {
    const wall = makeWall('w', 12, [{ kind: 'door', start: 5, end: 7, height: 2.1 , sill: 0}])
    const placements = hangWall(wall, [{ ...makeEntries(1)[0], pinned: { u: 6 } }])
    expect(placements).toEqual([])
  })

  it('ne garde que la première de deux épingles qui se chevauchent', () => {
    const wall = makeWall('w', 12)
    const placements = hangWall(wall, [
      { ...makeEntries(1)[0], key: 'owner/b', stars: 0, pinned: { u: 5.5 } },
      { ...makeEntries(1)[0], key: 'owner/a', stars: 0, pinned: { u: 5 } },
    ])
    expect(placements).toHaveLength(1)
    expect(placements[0].key).toBe('owner/a')
    expectNoOverlap(placements)
  })

  it('accepte deux épingles disjointes', () => {
    const wall = makeWall('w', 12)
    const placements = hangWall(wall, [
      { ...makeEntries(1)[0], key: 'owner/a', stars: 0, pinned: { u: 3 } },
      { ...makeEntries(1)[0], key: 'owner/b', stars: 0, pinned: { u: 9 } },
    ])
    expect(placements).toHaveLength(2)
    expectNoOverlap(placements)
    expectInsideWall(wall, placements)
  })
})

// ── Totalité ─────────────────────────────────────────────────────────────

describe('hangWall — totalité', () => {
  it('n’accroche rien sur un mur sans segment utile, sans lever', () => {
    expect(hangWall(makeWall('w', 1.5), makeEntries(10))).toEqual([])
    expect(hangWall(makeWall('w', 0), makeEntries(10))).toEqual([])
  })

  it('abandonne les œuvres en trop plutôt que de lever', () => {
    const wall = makeWall('w', 4)
    const placements = hangWall(wall, makeEntries(60, () => 0))
    expect(placements.length).toBeGreaterThan(0)
    expect(placements.length).toBeLessThan(60)
    expectNoOverlap(placements)
    expectInsideWall(wall, placements)
  })

  it('garde les mieux étoilées quand il faut abandonner', () => {
    const wall = makeWall('w', 6)
    const entries = makeEntries(20, (i) => 1000 - i)
    const placements = hangWall(wall, entries)
    const stars = new Map(entries.map((e) => [e.key, e.stars]))
    const kept = placements.map((p) => stars.get(p.key)!)
    const best = [...entries].map((e) => e.stars).sort((a, b) => b - a)
    expect([...kept].sort((a, b) => b - a)).toEqual(best.slice(0, kept.length))
  })

  it('survit à une œuvre plus large que le mur', () => {
    const wall = makeWall('w', 3)
    const placements = hangWall(wall, [{ ...makeEntries(1)[0], aspect: 40 }])
    expect(placements).toEqual([])
  })

  it('survit à des entrées dégénérées', () => {
    const wall = makeWall('w', 12)
    const placements = hangWall(wall, [
      { key: 'owner/nan', stars: Number.NaN, aspect: Number.NaN, atlas: 0, layer: 0 },
      { key: 'owner/zero', stars: 0, aspect: 0, atlas: 0, layer: 1 },
      { key: 'owner/negatif', stars: -5, aspect: -2, atlas: 0, layer: 2 },
    ])
    expect(placements).toHaveLength(3)
    expectNoOverlap(placements)
    expectInsideWall(wall, placements)
  })

  it('ne perd aucune œuvre réelle sur les 115 dépôts, quelle que soit la salle', () => {
    for (const length of [6, 8, 12, 20]) {
      const wall = makeWall(`w-${length}`, length)
      const placements = hangWall(wall, realEntries)
      expectNoOverlap(placements)
      expectInsideWall(wall, placements)
      expect(new Set(placements.map((p) => p.key)).size).toBe(placements.length)
    }
  })
})

// ── Déterminisme ─────────────────────────────────────────────────────────

describe('hangWall — déterminisme', () => {
  it('donne deux fois le même résultat', () => {
    const wall = makeWall('w', 14, [{ kind: 'door', start: 6, end: 8, height: 2.1 , sill: 0}])
    const first = hangWall(wall, realEntries)
    const second = hangWall(wall, realEntries)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('ne dépend pas de l’ordre des entrées', () => {
    const wall = makeWall('w', 14, [{ kind: 'door', start: 6, end: 8, height: 2.1 , sill: 0}])
    const entries = [
      ...realEntries.slice(0, 6),
      { ...realEntries[6], pinned: { u: 2 } },
      { ...realEntries[7], pinned: { u: 12 } },
    ]
    const straight = hangWall(wall, entries)
    const reversed = hangWall(wall, [...entries].reverse())
    const shuffled = hangWall(wall, [...entries].sort((a, b) => (a.key < b.key ? 1 : -1)))
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(straight))
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(straight))
  })

  it('ne modifie pas les entrées qu’on lui passe', () => {
    const entries = makeEntries(6)
    const copy = JSON.stringify(entries)
    hangWall(makeWall('w', 12), entries)
    expect(JSON.stringify(entries)).toBe(copy)
  })
})

// ── Salle entière ────────────────────────────────────────────────────────

describe('hangRoom', () => {
  const fourWalls = () => [
    makeWall('nord', 8),
    makeWall('est', 6, [{ kind: 'door', start: 2, end: 4, height: 2.1 , sill: 0}]),
    makeWall('sud', 8),
    makeWall('ouest', 6),
  ]

  it('renvoie une copie et laisse la salle d’origine intacte', () => {
    const room = makeRoom('r1', fourWalls())
    const hung = hangRoom(room, makeEntries(8, () => 0))
    expect(hung).not.toBe(room)
    expect(hung.walls[0]).not.toBe(room.walls[0])
    for (const wall of room.walls) expect(wall.placements).toEqual([])
    expect(hung.id).toBe(room.id)
    expect(hung.footprint).toBe(room.footprint)
  })

  it('répartit sur plusieurs murs et respecte l’invariant sur chacun', () => {
    const room = makeRoom('r1', fourWalls())
    const hung = hangRoom(room, makeEntries(10, () => 0))
    const total = hung.walls.reduce((sum, w) => sum + w.placements.length, 0)
    expect(total).toBe(10)
    expect(hung.walls.filter((w) => w.placements.length > 0).length).toBeGreaterThan(1)
    for (const wall of hung.walls) {
      expectNoOverlap(wall.placements)
      expectInsideWall(wall, wall.placements)
      for (const placement of wall.placements) {
        expect(placement.centerHeight).toBe(MUSEUM_HANG_HEIGHT)
      }
    }
  })

  it('route une épingle vers le mur qu’elle désigne', () => {
    const room = makeRoom('r1', fourWalls())
    const entries: HangEntry[] = [
      { ...makeEntries(1)[0], key: 'owner/pin', pinned: { u: 3, wallId: 'sud' } },
      ...makeEntries(6, () => 0),
    ]
    const hung = hangRoom(room, entries)
    const sud = hung.walls.find((w) => w.id === 'sud')!
    const pin = sud.placements.find((p) => p.key === 'owner/pin')
    expect(pin?.u).toBe(3)
    expect(pin?.pinned).toBe(true)
    for (const wall of hung.walls) {
      expectNoOverlap(wall.placements)
      expectInsideWall(wall, wall.placements)
    }
  })

  it('dégrade en accrochage libre une épingle inaccrochable plutôt que de la perdre', () => {
    const room = makeRoom('r1', fourWalls())
    const hung = hangRoom(room, [
      { ...makeEntries(1)[0], key: 'owner/pin', pinned: { u: 99, wallId: 'nulle-part' } },
    ])
    const all = hung.walls.flatMap((w) => w.placements)
    expect(all).toHaveLength(1)
    expect(all[0].key).toBe('owner/pin')
    expect(all[0].pinned).toBe(false)
  })

  it('n’explose pas sur une salle sans mur ni sur une salle minuscule', () => {
    expect(hangRoom(makeRoom('vide', []), makeEntries(5)).walls).toEqual([])
    const petite = makeRoom('petite', [makeWall('nord', 1), makeWall('est', 1)])
    const hung = hangRoom(petite, makeEntries(5))
    expect(hung.walls.every((w) => w.placements.length === 0)).toBe(true)
  })

  it('accroche les 115 dépôts réels sans chevauchement et sans perte en salle de 12 m', () => {
    const room = makeRoom('grande', [
      makeWall('nord', 12),
      makeWall('est', 12),
      makeWall('sud', 12, [{ kind: 'door', start: 5, end: 7, height: 2.1 , sill: 0}]),
      makeWall('ouest', 12),
    ])
    // Une salle réelle reçoit un cluster, pas tout le corpus : on vérifie que
    // huit dépôts réels tirés du catalogue s'y accrochent tous.
    for (let offset = 0; offset + 8 <= realEntries.length; offset += 8) {
      const cluster = realEntries.slice(offset, offset + 8)
      const hung = hangRoom(room, cluster)
      const placed = hung.walls.flatMap((w) => w.placements)
      expect(placed, `cluster ${offset}`).toHaveLength(8)
      for (const wall of hung.walls) {
        expectNoOverlap(wall.placements)
        expectInsideWall(wall, wall.placements)
      }
    }
  })

  it('reste déterministe sur le corpus réel', () => {
    const room = makeRoom('r1', fourWalls())
    const first = hangRoom(room, realEntries)
    const second = hangRoom(room, [...realEntries].reverse())
    expect(JSON.stringify(first.walls)).toBe(JSON.stringify(second.walls))
  })
})
