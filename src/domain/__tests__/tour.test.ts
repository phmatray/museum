// @vitest-environment node — l'itinéraire se calcule sans DOM et sans canvas.
/**
 * Tests de l'itinéraire de visite (spec §7.2, §7.4, §7.5).
 *
 * Trois propriétés portent tout le fichier, dans cet ordre d'importance :
 *
 *  1. RIEN N'EST OUBLIÉ, RIEN N'EST VU DEUX FOIS. Chaque salle non aveugle a un
 *     arrêt et un seul. C'est la promesse faite au visiteur.
 *  2. LE PARCOURS EST CONTINU. Les niveaux s'enchaînent par la rampe, la caméra
 *     ne traverse jamais une dalle, et l'ordre des étages ne saute pas.
 *  3. LE MÊME MUSÉE DONNE LE MÊME PARCOURS. Deux appels, deux itinéraires
 *     identiques octet pour octet — sans quoi rien de ce qui précède n'est
 *     testable.
 *
 * Le dernier bloc rejoue tout sur le musée réel — 4 niveaux, 17 salles, 100
 * œuvres accrochées. Un musée inventé n'a ni galerie aveugle héritée d'un côté
 * vide, ni réserve sous le rez-de-chaussée, ni salle de 30 m de profondeur.
 */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PAUSE_DURATION,
  bestWall,
  buildTour,
  tourFloorOrder,
  visitableRooms,
  type TourStop,
} from '../tour'
import { isBlindGallery } from '../layout'
import { MUSEUM_HANG_HEIGHT } from '../types'
import type { Floor, Museum, MuseumConfig, Ramp, Rect, Room, Wall } from '../types'
import brut from '../../../public/data/museum.json'

const MUSEE_REEL = brut as unknown as Museum

// ── Fixtures ─────────────────────────────────────────────────────────────

function config(): MuseumConfig {
  return {
    schemaVersion: 1,
    name: 'Test',
    owners: ['acme'],
    filters: { excludeForks: true, excludeArchived: false },
    building: {
      roomDepth: 9,
      ceilingHeight: 4.3,
      slabThickness: 0.4,
      minAtriumSize: 12,
      minRoomWidth: 6,
      roomsPerFloor: 4,
    },
    clustering: { minClusterSize: 4, maxClusterSize: 14 },
  }
}

/** Un mur horizontal orienté vers l'intérieur, avec `count` œuvres dessus. */
function mur(id: string, a: Rect, count: number, normal: { x: number; z: number }): Wall {
  return {
    id,
    a: { x: a.x, z: a.z },
    b: { x: a.x + a.width, z: a.z + a.depth },
    height: 4.3,
    kind: 'outer',
    normal,
    openings: [],
    placements: Array.from({ length: count }, (_, i) => ({
      key: `acme/${id}-${i}`,
      u: i + 1,
      centerHeight: MUSEUM_HANG_HEIGHT,
      width: 1.2,
      height: 0.6,
      atlas: 0,
      layer: i,
      pinned: false,
    })),
  }
}

/**
 * Une salle rectangulaire à deux murs : celui du fond, garni de `count` œuvres,
 * et un mur latéral nu. Le second existe pour que `bestWall` ait à choisir.
 */
function salle(id: string, footprint: Rect, count: number): Room {
  return {
    id,
    name: id,
    side: 'north',
    footprint,
    theme: 'classic',
    topics: [],
    keys: [],
    walls: [
      // Mur du fond, au nord (z minimal), normale vers +z.
      mur(
        `${id}-outer`,
        { x: footprint.x, z: footprint.z, width: footprint.width, depth: 0 },
        count,
        { x: 0, z: 1 },
      ),
      // Mur latéral ouest, normale vers +x, toujours moins garni.
      mur(
        `${id}-side`,
        { x: footprint.x, z: footprint.z, width: 0, depth: footprint.depth },
        0,
        { x: 1, z: 0 },
      ),
    ],
  }
}

function galerieAveugle(id: string, footprint: Rect): Room {
  const r = salle(id, footprint, 0)
  return { ...r, id: `${id}-galerie-0`, name: 'Galerie aveugle' }
}

function niveau(id: string, level: number, rooms: Room[]): Floor {
  return {
    id,
    name: id,
    level,
    elevation: level * 4.7,
    ceilingHeight: 4.3,
    rooms,
    enclosure: [],
    slabHoles: [],
    footprint: { x: -15, z: -15, width: 30, depth: 30 },
  }
}

function rampe(from: string, to: string, baseElevation: number, startAngle: number): Ramp {
  return {
    id: `ramp-${from}-${to}`,
    fromFloor: from,
    toFloor: to,
    centre: { x: 0, z: 0 },
    radius: 4.8,
    startAngle,
    sweep: Math.PI,
    width: 2.2,
    rise: 4.7,
    baseElevation,
  }
}

function musee(floors: Floor[], ramps: Ramp[] = []): Museum {
  return {
    config: config(),
    generatedAt: '2026-07-25T00:00:00Z',
    floors,
    ramps,
    atrium: { x: -6, z: -6, width: 12, depth: 12 },
    spawn: { floorId: floors[0].id, position: { x: 0, y: 0, z: 10 }, yaw: 0 },
    artworks: {},
    stats: {
      artworkCount: 0,
      roomCount: floors.reduce((n, f) => n + f.rooms.length, 0),
      floorCount: floors.length,
      excludedCount: 0,
      vaultCount: 0,
    },
    warnings: [],
  }
}

/** Les quatre côtés d'un anneau, en salles de collection garnies. */
function anneau(id: string): Room[] {
  return [
    salle(`${id}-north-0`, { x: -15, z: -15, width: 30, depth: 9 }, 5),
    salle(`${id}-east-0`, { x: 6, z: -6, width: 9, depth: 12 }, 3),
    salle(`${id}-south-0`, { x: -15, z: 6, width: 30, depth: 9 }, 4),
    salle(`${id}-west-0`, { x: -15, z: -6, width: 9, depth: 12 }, 2),
  ]
}

function arrets(stops: TourStop[]): TourStop[] {
  return stops.filter((s) => s.kind === 'room')
}

// ── Couverture ───────────────────────────────────────────────────────────

describe('buildTour — couverture', () => {
  it('visite toutes les salles non aveugles, une fois chacune', () => {
    const m = musee([niveau('rdc', 0, [...anneau('rdc'), galerieAveugle('rdc-x', { x: 0, z: 0, width: 3, depth: 3 })])])
    const visitees = arrets(buildTour(m)).map((s) => s.roomId)

    expect(visitees).toHaveLength(4)
    expect(new Set(visitees).size).toBe(4)
    expect(visitees).not.toContain('rdc-x-galerie-0')
  })

  it('ne s’arrête jamais dans une galerie aveugle', () => {
    const m = musee([
      niveau('rdc', 0, [
        galerieAveugle('a', { x: -15, z: -15, width: 30, depth: 9 }),
        salle('rdc-east-0', { x: 6, z: -6, width: 9, depth: 12 }, 3),
        galerieAveugle('b', { x: -15, z: 6, width: 30, depth: 9 }),
      ]),
    ])
    expect(arrets(buildTour(m)).map((s) => s.roomId)).toEqual(['rdc-east-0'])
  })

  it('rend une visite vide quand toutes les salles sont aveugles', () => {
    const m = musee([
      niveau('rdc', 0, [
        galerieAveugle('a', { x: -15, z: -15, width: 30, depth: 9 }),
        galerieAveugle('b', { x: -15, z: 6, width: 30, depth: 9 }),
      ]),
    ])
    expect(buildTour(m)).toEqual([])
  })

  it('visite un musée d’une seule salle', () => {
    const m = musee([niveau('rdc', 0, [salle('unique', { x: -15, z: -15, width: 30, depth: 9 }, 7)])])
    const tour = buildTour(m)

    expect(tour).toHaveLength(1)
    expect(tour[0].roomId).toBe('unique')
    expect(tour[0].kind).toBe('room')
  })

  it('rend une visite vide pour un musée sans salle du tout', () => {
    expect(buildTour(musee([niveau('rdc', 0, [])]))).toEqual([])
  })
})

// ── Ordre des niveaux ────────────────────────────────────────────────────

describe('buildTour — ordre des niveaux', () => {
  const sousSol = musee(
    [
      niveau('reserve', -1, [salle('reserve-salle', { x: -15, z: -15, width: 30, depth: 30 }, 9)]),
      niveau('rdc', 0, anneau('rdc')),
      niveau('e1', 1, anneau('e1')),
      niveau('e2', 2, anneau('e2')),
    ],
    [
      rampe('reserve', 'rdc', -4.7, 0),
      rampe('rdc', 'e1', 0, Math.PI),
      rampe('e1', 'e2', 4.7, 0),
    ],
  )

  it('commence au rez-de-chaussée, monte, et finit par la réserve', () => {
    expect(tourFloorOrder(sousSol).map((f) => f.id)).toEqual(['rdc', 'e1', 'e2', 'reserve'])
  })

  it('ne mélange pas deux niveaux : chaque étage est un bloc continu', () => {
    const suite = arrets(buildTour(sousSol)).map((s) => s.floorId)
    const blocs = suite.filter((id, i) => i === 0 || suite[i - 1] !== id)
    expect(blocs).toEqual(['rdc', 'e1', 'e2', 'reserve'])
    expect(new Set(blocs).size).toBe(blocs.length)
  })

  it('monte d’un niveau à la fois', () => {
    const parNiveau = new Map(sousSol.floors.map((f) => [f.id, f.level]))
    const suite = arrets(buildTour(sousSol)).map((s) => parNiveau.get(s.floorId)!)
    const blocs = suite.filter((n, i) => i === 0 || suite[i - 1] !== n)

    // Montée stricte jusqu'au sommet, puis descente vers les niveaux enterrés :
    // jamais un saut arbitraire d'un étage à l'autre.
    const sommet = blocs.indexOf(Math.max(...blocs))
    for (let i = 1; i <= sommet; i++) expect(blocs[i]).toBe(blocs[i - 1] + 1)
    for (let i = sommet + 1; i < blocs.length; i++) expect(blocs[i]).toBeLessThan(blocs[i - 1])
  })

  it('part du niveau le plus bas quand il n’y a pas de rez-de-chaussée', () => {
    const m = musee([niveau('e2', 2, anneau('e2')), niveau('e1', 1, anneau('e1'))])
    expect(tourFloorOrder(m).map((f) => f.id)).toEqual(['e1', 'e2'])
  })

  it('traverse les niveaux sans salle visitable sans s’y arrêter', () => {
    const m = musee(
      [
        niveau('rdc', 0, anneau('rdc')),
        niveau('e1', 1, [galerieAveugle('e1-a', { x: -15, z: -15, width: 30, depth: 9 })]),
        niveau('e2', 2, anneau('e2')),
      ],
      [rampe('rdc', 'e1', 0, 0), rampe('e1', 'e2', 4.7, Math.PI)],
    )
    const tour = buildTour(m)

    expect(new Set(arrets(tour).map((s) => s.floorId))).toEqual(new Set(['rdc', 'e2']))
    // Les DEUX rampes sont empruntées : la caméra ne saute pas le palier vide.
    const rampesSuivies = new Set(
      tour.filter((s) => s.kind === 'transit').map((s) => s.id.replace(/-(up|down)-\d+$/, '')),
    )
    expect(rampesSuivies).toEqual(new Set(['transit-ramp-rdc-e1', 'transit-ramp-e1-e2']))
  })
})

// ── Rampes ───────────────────────────────────────────────────────────────

describe('buildTour — passage entre niveaux', () => {
  it('intercale des points de passage sur la rampe, sans pause', () => {
    const m = musee(
      [niveau('rdc', 0, anneau('rdc')), niveau('e1', 1, anneau('e1'))],
      [rampe('rdc', 'e1', 0, 0)],
    )
    const transit = buildTour(m).filter((s) => s.kind === 'transit')

    expect(transit.length).toBeGreaterThan(0)
    for (const s of transit) {
      expect(s.pauseDuration).toBe(0)
      expect(s.roomId).toBeNull()
      // Sur l'hélice : à la distance du rayon de l'axe de l'atrium, et entre
      // les deux planchers qu'elle relie.
      // Tolérance au micromètre : les coordonnées sortent arrondies.
      expect(Math.hypot(s.position.x, s.position.z)).toBeCloseTo(4.8, 5)
      expect(s.position.y).toBeGreaterThan(0)
      expect(s.position.y).toBeLessThan(4.7 + 1.6)
    }
  })

  it('monte le long de la rampe dans le sens du parcours', () => {
    const m = musee(
      [niveau('rdc', 0, anneau('rdc')), niveau('e1', 1, anneau('e1'))],
      [rampe('rdc', 'e1', 0, 0)],
    )
    const ys = buildTour(m)
      .filter((s) => s.kind === 'transit')
      .map((s) => s.position.y)
    expect(ys).toEqual([...ys].sort((a, b) => a - b))
  })

  it('descend la rampe dans l’autre sens quand la visite redescend', () => {
    const m = musee(
      [
        niveau('reserve', -1, [salle('reserve-salle', { x: -15, z: -15, width: 30, depth: 30 }, 4)]),
        niveau('rdc', 0, anneau('rdc')),
      ],
      [rampe('reserve', 'rdc', -4.7, 0)],
    )
    const ys = buildTour(m)
      .filter((s) => s.kind === 'transit')
      .map((s) => s.position.y)
    expect(ys.length).toBeGreaterThan(0)
    expect(ys).toEqual([...ys].sort((a, b) => b - a))
  })

  it('visite quand même un musée sans rampe', () => {
    const m = musee([niveau('rdc', 0, anneau('rdc')), niveau('e1', 1, anneau('e1'))])
    const tour = buildTour(m)

    expect(tour.filter((s) => s.kind === 'transit')).toEqual([])
    expect(arrets(tour)).toHaveLength(8)
    expect(new Set(arrets(tour).map((s) => s.floorId))).toEqual(new Set(['rdc', 'e1']))
  })
})

// ── Cadrage d'un arrêt ───────────────────────────────────────────────────

describe('buildTour — cadrage', () => {
  const footprint: Rect = { x: -15, z: -15, width: 30, depth: 9 }
  const m = musee([niveau('rdc', 0, [salle('rdc-north-0', footprint, 5)])])

  it('se place dans la salle, face au mur le plus garni', () => {
    const [arret] = buildTour(m)
    // Le mur garni est celui du fond (z = −15), sa normale pointe vers +z : on
    // recule donc DANS la salle.
    expect(arret.position.z).toBeGreaterThan(footprint.z)
    expect(arret.position.z).toBeLessThanOrEqual(footprint.z + footprint.depth / 2)
    expect(arret.position.x).toBeCloseTo(0, 6)
  })

  it('vise la hauteur d’accrochage, pas le milieu du mur', () => {
    const [arret] = buildTour(m)
    expect(arret.lookAt.y).toBeCloseTo(MUSEUM_HANG_HEIGHT, 6)
    expect(arret.lookAt.z).toBeCloseTo(footprint.z, 6)
  })

  it('remonte la position à l’élévation du niveau', () => {
    const deuxNiveaux = musee([niveau('rdc', 0, anneau('rdc')), niveau('e1', 1, anneau('e1'))])
    for (const arret of arrets(buildTour(deuxNiveaux))) {
      const attendu = arret.floorId === 'e1' ? 4.7 : 0
      expect(arret.position.y).toBeCloseTo(attendu + 1.6, 6)
      expect(arret.lookAt.y).toBeCloseTo(attendu + MUSEUM_HANG_HEIGHT, 6)
    }
  })

  it('ne recule pas au-delà du milieu d’une salle étroite', () => {
    const etroite = musee([niveau('rdc', 0, [salle('cabinet', { x: -2, z: -3, width: 4, depth: 2 }, 3)])])
    const [arret] = buildTour(etroite)
    expect(arret.position.z).toBeLessThanOrEqual(-3 + 1 + 1e-9)
  })

  it('choisit le mur le plus garni, à départage stable', () => {
    const r = salle('s', footprint, 2)
    expect(bestWall(r)?.id).toBe('s-outer')
    // À égalité de garnissage, le plus long l'emporte — et à longueur égale, le
    // plus petit identifiant, pour que l'ordre du JSON n'entre pas en jeu.
    const egal: Room = { ...r, walls: [r.walls[0], { ...r.walls[0], id: 's-zzz' }] }
    expect(bestWall(egal)?.id).toBe('s-outer')
    expect(bestWall({ ...r, walls: [] })).toBeNull()
  })

  it('applique la durée de pause par défaut, et celle qu’on lui donne', () => {
    expect(buildTour(m)[0].pauseDuration).toBe(DEFAULT_PAUSE_DURATION)
    expect(buildTour(m, { pauseDuration: 2.5 })[0].pauseDuration).toBe(2.5)
  })
})

// ── Déterminisme ─────────────────────────────────────────────────────────

describe('buildTour — déterminisme', () => {
  it('rend deux fois le même itinéraire, octet pour octet', () => {
    const a = JSON.stringify(buildTour(MUSEE_REEL))
    const b = JSON.stringify(buildTour(MUSEE_REEL))
    expect(a).toBe(b)
  })

  it('ne dépend pas de l’ordre d’écriture des salles', () => {
    const droit = musee([niveau('rdc', 0, anneau('rdc'))])
    const inverse = musee([niveau('rdc', 0, [...anneau('rdc')].reverse())])
    expect(buildTour(inverse)).toEqual(buildTour(droit))
  })

  it('ne consulte ni horloge ni aléa', () => {
    const source = buildTour.toString() + tourFloorOrder.toString()
    expect(source).not.toMatch(/Math\.random|Date\.now/)
  })
})

// ── Le musée réel ────────────────────────────────────────────────────────

describe('buildTour — musée réel', () => {
  const tour = buildTour(MUSEE_REEL)

  it('couvre exactement les salles non aveugles du bâtiment', () => {
    const attendues = MUSEE_REEL.floors
      .flatMap((f) => f.rooms)
      .filter((r) => !isBlindGallery(r))
      .map((r) => r.id)
    const visitees = arrets(tour).map((s) => s.roomId)

    expect(visitees).toHaveLength(attendues.length)
    expect(new Set(visitees)).toEqual(new Set(attendues))
  })

  it('ouvre par la salle d’honneur et ferme par la réserve', () => {
    const salles = arrets(tour)
    expect(salles[0].floorId).toBe('rdc')
    expect(salles[salles.length - 1].floorId).toBe('reserve')
  })

  it('emprunte les trois rampes du bâtiment, dans les deux sens', () => {
    const suivies = tour
      .filter((s) => s.kind === 'transit')
      .map((s) => s.id.replace(/-(up|down)-\d+$/, ''))
    for (const ramp of MUSEE_REEL.ramps) {
      expect(suivies).toContain(`transit-${ramp.id}`)
    }
    // La rampe réserve↔rdc est empruntée en DESCENTE, à la toute fin.
    const derniere = tour[tour.length - 1]
    expect(derniere.kind).toBe('room')
    expect(derniere.floorId).toBe('reserve')
  })

  it('pose chaque arrêt de salle DANS sa salle', () => {
    const salles = new Map(
      MUSEE_REEL.floors.flatMap((f) => f.rooms.map((r) => [r.id, { r, f }] as const)),
    )
    for (const arret of arrets(tour)) {
      const entree = salles.get(arret.roomId!)!
      const fp = entree.r.footprint
      expect(arret.position.x).toBeGreaterThanOrEqual(fp.x)
      expect(arret.position.x).toBeLessThanOrEqual(fp.x + fp.width)
      expect(arret.position.z).toBeGreaterThanOrEqual(fp.z)
      expect(arret.position.z).toBeLessThanOrEqual(fp.z + fp.depth)
      expect(arret.position.y).toBeCloseTo(entree.f.elevation + 1.6, 6)
    }
  })

  it('regarde un mur qui porte des œuvres', () => {
    const salles = new Map(MUSEE_REEL.floors.flatMap((f) => f.rooms.map((r) => [r.id, r] as const)))
    for (const arret of arrets(tour)) {
      const r = salles.get(arret.roomId!)!
      const mieux = bestWall(r)!
      expect(mieux.placements.length).toBeGreaterThan(0)
    }
  })

  it('ne laisse aucun trou de plus de 20 m entre deux arrêts consécutifs', () => {
    // Le seuil n'est pas cosmétique : au-delà, la spline qui relie deux arrêts
    // traverse forcément une dalle ou un mur. 20 m est la diagonale d'un côté
    // de l'anneau, soit le plus grand pas légitime.
    for (let i = 1; i < tour.length; i++) {
      const a = tour[i - 1].position
      const b = tour[i].position
      expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)).toBeLessThan(20)
    }
  })

  it('annonce un nom de salle et un nom de niveau à chaque arrêt', () => {
    for (const arret of arrets(tour)) {
      expect(arret.label.length).toBeGreaterThan(0)
      expect(arret.floorName.length).toBeGreaterThan(0)
    }
  })

  it('accepte un musée dont on a retiré les rampes', () => {
    const sansRampe: Museum = { ...MUSEE_REEL, ramps: [] }
    const t = buildTour(sansRampe)
    expect(t.filter((s) => s.kind === 'transit')).toEqual([])
    expect(arrets(t)).toHaveLength(arrets(tour).length)
  })

  it('ne visite aucune galerie aveugle du bâtiment réel', () => {
    const aveugles = MUSEE_REEL.floors.flatMap((f) => f.rooms.filter(isBlindGallery))
    expect(aveugles.length).toBeGreaterThan(0) // le bâtiment réel en a
    for (const g of aveugles) {
      expect(tour.some((s) => s.roomId === g.id)).toBe(false)
    }
  })

  it('visitableRooms rend les salles d’un niveau sans les galeries', () => {
    const e1 = MUSEE_REEL.floors.find((f) => f.id === 'etage-1')!
    expect(visitableRooms(e1)).toHaveLength(e1.rooms.filter((r) => !isBlindGallery(r)).length)
  })
})
