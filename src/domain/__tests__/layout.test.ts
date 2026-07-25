/**
 * Tests de la disposition (spec §7).
 *
 * Le fil conducteur : un bâtiment est correct si personne ne se marche dessus.
 * Deux salles ne partagent pas un mètre carré, deux étages ne partagent pas une
 * altitude, aucune normale ne pointe vers le dehors, et la rampe reste montable
 * même sur une configuration absurde.
 *
 * Le dernier bloc rejoue tout ça sur le catalogue réel — 115 dépôts, clusterisés
 * par le vrai `clusterArtworks` : c'est la seule preuve qui vaille.
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { clusterArtworks, type Cluster } from '../clustering'
import {
  elevationOf,
  roomCapacity,
  planBuilding,
  rampSlopeDegrees,
  subdivideSide,
  type BuildingPlan,
} from '../layout'
import type { Artwork, Catalogue, MuseumConfig, Rect, Room, Wall } from '../types'

// ── Fixtures ─────────────────────────────────────────────────────────────

function config(overrides: Partial<MuseumConfig['building']> = {}): MuseumConfig {
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
      roomsPerFloor: 6,
      ...overrides,
    },
    clustering: { minClusterSize: 4, maxClusterSize: 14 },
  }
}

function cluster(id: string, taille: number): Cluster {
  return {
    id,
    name: id.toUpperCase(),
    topics: [id],
    keys: Array.from({ length: taille }, (_, i) => `acme/${id}-${i}`),
  }
}

function clusters(...tailles: number[]): Cluster[] {
  return tailles.map((t, i) => cluster(`c${String(i).padStart(2, '0')}`, t))
}

// ── Aides géométriques ───────────────────────────────────────────────────

/** Aire de l'intersection de deux rectangles. 0 = ils ne se recouvrent pas. */
function intersectionArea(a: Rect, b: Rect): number {
  const dx = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const dz = Math.min(a.z + a.depth, b.z + b.depth) - Math.max(a.z, b.z)
  return dx > 0 && dz > 0 ? dx * dz : 0
}

function contains(r: Rect, x: number, z: number, tol = 1e-6): boolean {
  return (
    x >= r.x - tol && x <= r.x + r.width + tol && z >= r.z - tol && z <= r.z + r.depth + tol
  )
}

function wallLength(w: Wall): number {
  return Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z)
}

function allRooms(plan: BuildingPlan): Room[] {
  return plan.floors.flatMap((f) => f.rooms)
}

/** Toutes les invariantes structurelles, en un seul endroit. */
function expectPlanSain(plan: BuildingPlan, cfg: MuseumConfig): void {
  for (const floor of plan.floors) {
    // Aucun recouvrement d'emprises entre salles d'un même niveau.
    for (let i = 0; i < floor.rooms.length; i++) {
      for (let j = i + 1; j < floor.rooms.length; j++) {
        expect(
          intersectionArea(floor.rooms[i].footprint, floor.rooms[j].footprint),
          `${floor.rooms[i].id} ∩ ${floor.rooms[j].id}`,
        ).toBeLessThan(1e-6)
      }
    }

    for (const room of floor.rooms) {
      expect(room.footprint.width).toBeGreaterThan(0)
      expect(room.footprint.depth).toBeGreaterThan(0)
      // La salle tient dans l'emprise du niveau.
      expect(intersectionArea(room.footprint, floor.footprint)).toBeCloseTo(
        room.footprint.width * room.footprint.depth,
        6,
      )
      // Aucune salle de l'anneau n'empiète sur le vide.
      if (room.id !== 'reserve-salle') {
        expect(intersectionArea(room.footprint, plan.atrium)).toBeLessThan(1e-6)
      }
      expectMursSains(room, cfg)
    }
  }
}

function expectMursSains(room: Room, cfg: MuseumConfig): void {
  expect(room.walls, `${room.id} : 4 murs`).toHaveLength(4)
  expect(new Set(room.walls.map((w) => w.id)).size).toBe(4)

  for (const wall of room.walls) {
    const L = wallLength(wall)
    expect(L).toBeGreaterThan(0)
    expect(wall.height).toBeCloseTo(cfg.building.ceilingHeight, 6)

    // Normale unitaire et perpendiculaire au mur.
    expect(Math.hypot(wall.normal.x, wall.normal.z)).toBeCloseTo(1, 6)
    const dx = (wall.b.x - wall.a.x) / L
    const dz = (wall.b.z - wall.a.z) / L
    expect(wall.normal.x * dx + wall.normal.z * dz).toBeCloseTo(0, 6)

    // Normale pointant vers l'INTÉRIEUR : un pas dans son sens depuis le milieu
    // du mur tombe dans la salle, un pas à l'opposé en sort.
    const mx = (wall.a.x + wall.b.x) / 2
    const mz = (wall.a.z + wall.b.z) / 2
    const pas = 0.05
    expect(
      contains(room.footprint, mx + wall.normal.x * pas, mz + wall.normal.z * pas),
      `${wall.id} : normale rentrante`,
    ).toBe(true)
    expect(contains(room.footprint, mx - wall.normal.x * pas, mz - wall.normal.z * pas)).toBe(
      false,
    )

    // Ouvertures dans les bornes du mur, ordonnées, sans recouvrement.
    let precedent = 0
    for (const o of wall.openings) {
      expect(o.start).toBeGreaterThanOrEqual(precedent - 1e-9)
      expect(o.end).toBeLessThanOrEqual(L + 1e-9)
      expect(o.end).toBeGreaterThan(o.start)
      expect(o.height).toBeGreaterThan(0)
      expect(o.height).toBeLessThanOrEqual(wall.height + 1e-9)
      precedent = o.end
    }
    // Un mur extérieur ne se perce pas : c'est la façade.
    if (wall.kind === 'outer') expect(wall.openings).toHaveLength(0)
  }
}

// ── Élévations ───────────────────────────────────────────────────────────

describe('élévations', () => {
  it('sont calculées depuis le niveau, jamais saisies', () => {
    const cfg = config()
    const pas = cfg.building.ceilingHeight + cfg.building.slabThickness
    expect(elevationOf(0, cfg)).toBe(0)
    expect(elevationOf(1, cfg)).toBeCloseTo(pas, 6)
    expect(elevationOf(3, cfg)).toBeCloseTo(3 * pas, 6)
    // La réserve est SOUS le rez-de-chaussée.
    expect(elevationOf(-1, cfg)).toBeCloseTo(-pas, 6)
  })

  it('croissent strictement d’un niveau au suivant, réserve comprise', () => {
    const cfg = config()
    const plan = planBuilding({
      clusters: clusters(8, 7, 6, 5, 4, 4, 9, 3),
      featured: ['acme/a', 'acme/b'],
      vault: ['acme/vieux'],
      config: cfg,
    })

    const pas = cfg.building.ceilingHeight + cfg.building.slabThickness
    expect(plan.floors[0].level).toBe(-1)
    expect(plan.floors[0].elevation).toBeLessThan(0)
    for (let i = 1; i < plan.floors.length; i++) {
      expect(plan.floors[i].level).toBe(plan.floors[i - 1].level + 1)
      expect(plan.floors[i].elevation - plan.floors[i - 1].elevation).toBeCloseTo(pas, 6)
      // Aucun chevauchement vertical : le plafond du dessous est sous le plancher.
      expect(plan.floors[i - 1].elevation + plan.floors[i - 1].ceilingHeight).toBeLessThanOrEqual(
        plan.floors[i].elevation + 1e-9,
      )
    }
    expect(plan.floors.find((f) => f.level === 0)?.elevation).toBe(0)
  })

  it('donne floorCount = 1 + ceil(clusters / roomsPerFloor) + réserve', () => {
    const cfg = config({ roomsPerFloor: 6 })
    const plan = planBuilding({
      clusters: clusters(...new Array<number>(13).fill(5)),
      featured: [],
      vault: ['acme/fork'],
      config: cfg,
    })
    expect(plan.floors).toHaveLength(1 + Math.ceil(13 / 6) + 1)
  })

  it('ne perce la dalle du niveau le plus bas d’aucune trémie', () => {
    const cfg = config()
    const plan = planBuilding({
      clusters: clusters(6, 6),
      featured: [],
      vault: ['acme/fork'],
      config: cfg,
    })
    expect(plan.floors[0].slabHoles).toHaveLength(0)
    for (const f of plan.floors.slice(1)) {
      expect(f.slabHoles).toHaveLength(1)
      expect(f.slabHoles[0]).toEqual(plan.atrium)
    }
  })
})

// ── Anneau ───────────────────────────────────────────────────────────────

describe('plan en anneau', () => {
  const cfg = config()
  const plan = planBuilding({
    clusters: clusters(12, 10, 9, 8, 7, 6),
    featured: ['acme/x', 'acme/y'],
    vault: ['acme/old'],
    config: cfg,
  })

  it('ne produit aucun recouvrement d’emprises', () => {
    expectPlanSain(plan, cfg)
  })

  it('couvre exactement le côté sur lequel il subdivise', () => {
    for (const floor of plan.floors.filter((f) => f.level >= 1)) {
      const rd = cfg.building.roomDepth
      const outer = floor.footprint
      for (const side of ['north', 'south'] as const) {
        const salles = floor.rooms.filter((r) => r.side === side)
        if (salles.length === 0) continue
        const total = salles.reduce((s, r) => s + r.footprint.width, 0)
        // Nord et Sud portent toute la largeur extérieure (spec §7.2).
        expect(total).toBeCloseTo(outer.width, 6)
        for (const r of salles) expect(r.footprint.depth).toBeCloseTo(rd, 6)
      }
      for (const side of ['east', 'west'] as const) {
        const salles = floor.rooms.filter((r) => r.side === side)
        if (salles.length === 0) continue
        const total = salles.reduce((s, r) => s + r.footprint.depth, 0)
        // Est et Ouest ne portent que la profondeur de l'atrium.
        expect(total).toBeCloseTo(plan.atrium.depth, 6)
        for (const r of salles) expect(r.footprint.width).toBeCloseTo(rd, 6)
      }
    }
  })

  it('ne fait jamais se recouvrir un côté Nord/Sud et un côté Est/Ouest', () => {
    // Le piège de la partition est aux quatre angles : ils appartiennent au
    // Nord et au Sud, jamais à l'Est ni à l'Ouest.
    for (const floor of plan.floors) {
      const ns = floor.rooms.filter((r) => r.side === 'north' || r.side === 'south')
      const eo = floor.rooms.filter((r) => r.side === 'east' || r.side === 'west')
      for (const a of ns) {
        for (const b of eo) {
          expect(intersectionArea(a.footprint, b.footprint), `${a.id} ∩ ${b.id}`).toBe(0)
        }
      }
    }
  })

  it('respecte le plancher de largeur de salle quand le côté le permet', () => {
    for (const floor of plan.floors.filter((f) => f.level >= 1)) {
      for (const room of floor.rooms) {
        const long = room.side === 'north' || room.side === 'south'
          ? room.footprint.width
          : room.footprint.depth
        expect(long).toBeGreaterThanOrEqual(cfg.building.minRoomWidth - 1e-6)
      }
    }
  })
})

describe('subdivideSide', () => {
  it('partage exactement la longueur du côté', () => {
    const w = subdivideSide(30, [10, 5, 1], 6)
    expect(w.reduce((s, x) => s + x, 0)).toBeCloseTo(30, 9)
    for (const x of w) expect(x).toBeGreaterThanOrEqual(6 - 1e-9)
    // Proportionnalité conservée entre les salles au-dessus du plancher.
    expect(w[0]).toBeGreaterThan(w[1])
  })

  it('partage à parts égales plutôt que de faire déborder les salles', () => {
    const w = subdivideSide(12, [10, 1, 1], 6)
    expect(w.reduce((s, x) => s + x, 0)).toBeCloseTo(12, 9)
    expect(w).toEqual([4, 4, 4])
  })

  it('supporte des poids nuls', () => {
    expect(subdivideSide(12, [0, 0], 6)).toEqual([6, 6])
    expect(subdivideSide(12, [], 6)).toEqual([])
  })
})

// ── Murs et ouvertures ───────────────────────────────────────────────────

describe('murs', () => {
  const cfg = config()
  const plan = planBuilding({
    clusters: clusters(10, 9, 8, 7),
    featured: ['acme/x'],
    vault: [],
    config: cfg,
  })

  it('produit 4 murs par salle, avec des normales rentrantes', () => {
    expectPlanSain(plan, cfg)
    for (const room of allRooms(plan)) {
      expect(room.walls.filter((w) => w.kind === 'outer').length).toBeGreaterThanOrEqual(1)
    }
  })

  it('perce une baie centrée sur le mur intérieur des salles de collection', () => {
    for (const floor of plan.floors.filter((f) => f.level >= 1)) {
      for (const room of floor.rooms) {
        const inner = room.walls.find((w) => w.kind === 'inner')
        expect(inner, `${room.id} : un mur inner`).toBeDefined()
        const baies = inner!.openings.filter((o) => o.kind === 'bay')
        expect(baies, `${room.id} : une baie`).toHaveLength(1)

        const largeurSalle =
          room.side === 'north' || room.side === 'south'
            ? room.footprint.width
            : room.footprint.depth
        const attendue = Math.min(2.4, largeurSalle * 0.25)
        expect(baies[0].end - baies[0].start).toBeCloseTo(attendue, 6)

        // Centrée sur la portion de mur qui longe réellement le vide : pour une
        // salle qui ne déborde pas sur un angle, c'est le milieu du mur.
        if (room.side === 'east' || room.side === 'west') {
          const milieu = wallLength(inner!) / 2
          expect((baies[0].start + baies[0].end) / 2).toBeCloseTo(milieu, 6)
        }
      }
    }
  })

  it('perce une porte de 2 m dans les murs mitoyens, et rien dans les façades', () => {
    for (const floor of plan.floors.filter((f) => f.level >= 1)) {
      for (const room of floor.rooms) {
        for (const wall of room.walls.filter((w) => w.kind === 'side')) {
          for (const o of wall.openings) {
            expect(o.kind).toBe('door')
            expect(o.end - o.start).toBeCloseTo(2, 6)
            // Centrée sur le mur.
            expect((o.start + o.end) / 2).toBeCloseTo(wallLength(wall) / 2, 6)
          }
        }
        for (const wall of room.walls.filter((w) => w.kind === 'outer')) {
          expect(wall.openings).toHaveLength(0)
        }
      }
    }
  })

  it('n’accroche rien : les placements sont laissés à hanging.ts', () => {
    for (const room of allRooms(plan)) {
      for (const wall of room.walls) expect(wall.placements).toEqual([])
    }
  })

  it('donne à la réserve une seule grande salle aveugle', () => {
    const avecReserve = planBuilding({
      clusters: clusters(6),
      featured: [],
      vault: ['acme/f1', 'acme/f2'],
      config: cfg,
    })
    const reserve = avecReserve.floors[0]
    expect(reserve.level).toBe(-1)
    expect(reserve.rooms).toHaveLength(1)
    expect(reserve.rooms[0].keys).toEqual(['acme/f1', 'acme/f2'])
    expect(reserve.rooms[0].theme).toBe('vault')
    expect(reserve.rooms[0].walls).toHaveLength(4)
    expect(reserve.rooms[0].footprint).toEqual(reserve.footprint)
  })
})

// ── Capacité ─────────────────────────────────────────────────────────────

describe('boucle de capacité', () => {
  it('garantit que chaque salle peut recevoir son cluster', () => {
    const cfg = config()
    const plan = planBuilding({
      clusters: clusters(14, 14, 13, 12, 11, 10),
      featured: [],
      vault: [],
      config: cfg,
    })
    for (const floor of plan.floors.filter((f) => f.level >= 0)) {
      for (const room of floor.rooms) {
        expect(roomCapacity(room), `${room.id}`).toBeGreaterThanOrEqual(room.keys.length)
      }
    }
  })

  it('agrandit l’atrium quand les salles sont trop serrées', () => {
    const cfg = config({ roomsPerFloor: 8 })
    const petit = planBuilding({ clusters: clusters(4), featured: [], vault: [], config: cfg })
    const gros = planBuilding({
      clusters: clusters(14, 14, 14, 14, 14, 14, 14, 14),
      featured: [],
      vault: [],
      config: cfg,
    })
    expect(gros.atrium.width).toBeGreaterThan(petit.atrium.width)
    // Dix itérations au plus, de deux mètres chacune.
    expect(gros.atrium.width).toBeLessThanOrEqual(petit.atrium.width + 10 * 2)
  })

  it('laisse l’atrium au minimum configuré quand tout tient', () => {
    const cfg = config()
    const plan = planBuilding({ clusters: clusters(5), featured: [], vault: [], config: cfg })
    expect(plan.atrium.width).toBe(cfg.building.minAtriumSize)
    expect(plan.atrium).toEqual({ x: -6, z: -6, width: 12, depth: 12 })
  })
})

// ── Rampe ────────────────────────────────────────────────────────────────

describe('rampe hélicoïdale', () => {
  it('relie chaque paire de niveaux consécutifs', () => {
    const cfg = config()
    const plan = planBuilding({
      clusters: clusters(6, 6, 6, 6, 6, 6, 6),
      featured: ['acme/x'],
      vault: ['acme/f'],
      config: cfg,
    })
    expect(plan.ramps).toHaveLength(plan.floors.length - 1)
    plan.ramps.forEach((r, i) => {
      expect(r.fromFloor).toBe(plan.floors[i].id)
      expect(r.toFloor).toBe(plan.floors[i + 1].id)
      expect(r.baseElevation).toBeCloseTo(plan.floors[i].elevation, 6)
      expect(r.rise).toBeCloseTo(
        plan.floors[i + 1].elevation - plan.floors[i].elevation,
        6,
      )
      expect(r.centre).toEqual({ x: 0, z: 0 })
      expect(r.radius).toBeCloseTo(plan.atrium.width / 2 - 1.2, 6)
      expect(r.width).toBe(2.2)
      // L'hélice reste dans le vide : bord extérieur sous le nu de l'atrium.
      expect(r.radius + r.width / 2).toBeLessThanOrEqual(plan.atrium.width / 2 + 1e-9)
    })
  })

  it('enchaîne les volées en hélice continue', () => {
    const cfg = config()
    const plan = planBuilding({
      clusters: clusters(6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6),
      featured: [],
      vault: [],
      config: cfg,
    })
    let angle = 0
    for (const r of plan.ramps) {
      expect(r.startAngle).toBeCloseTo(angle % (2 * Math.PI), 6)
      angle += r.sweep
    }
  })

  it('reste sous 40° sur les configurations extrêmes', () => {
    const extremes: MuseumConfig[] = [
      config(),
      // Atrium minimal : le rayon s'effondre.
      config({ minAtriumSize: 4, minRoomWidth: 2, roomDepth: 4 }),
      // Plafond de cathédrale.
      config({ ceilingHeight: 12, slabThickness: 1.5 }),
      // Les deux à la fois : le pire cas concevable.
      config({ minAtriumSize: 4, minRoomWidth: 2, roomDepth: 4, ceilingHeight: 20, slabThickness: 2 }),
      config({ minAtriumSize: 50, ceilingHeight: 2.4, slabThickness: 0.2 }),
    ]
    for (const cfg of extremes) {
      const plan = planBuilding({
        clusters: clusters(8, 7, 6, 5, 4, 4, 4),
        featured: ['acme/x'],
        vault: ['acme/f'],
        config: cfg,
      })
      expect(plan.ramps.length).toBeGreaterThan(0)
      for (const ramp of plan.ramps) {
        const pente = rampSlopeDegrees(ramp)
        expect(pente, `pente ${pente.toFixed(1)}° pour ${JSON.stringify(cfg.building)}`).toBeLessThan(40)
        expect(pente).toBeGreaterThan(0)
        expect(ramp.radius).toBeGreaterThan(0)
        // Le balayage reste un multiple entier de π : des demi-tours, jamais un
        // quart de tour bâtard.
        const demiTours = ramp.sweep / Math.PI
        expect(Math.abs(demiTours - Math.round(demiTours))).toBeLessThan(1e-5)
      }
    }
  })

  it('n’engendre aucune rampe sur un bâtiment d’un seul niveau', () => {
    const plan = planBuilding({ clusters: [], featured: [], vault: [], config: config() })
    expect(plan.floors).toHaveLength(1)
    expect(plan.ramps).toEqual([])
  })
})

// ── Cas limites ──────────────────────────────────────────────────────────

describe('cas limites', () => {
  const cfg = config()

  it('0 cluster, 0 featured, 0 réserve → un plateau vide mais valide', () => {
    const plan = planBuilding({ clusters: [], featured: [], vault: [], config: cfg })
    expect(plan.floors).toHaveLength(1)
    expect(plan.floors[0].level).toBe(0)
    expect(plan.floors[0].rooms).toEqual([])
    expect(plan.atrium.width).toBe(12)
    expectPlanSain(plan, cfg)
  })

  it('1 cluster → un étage, une salle', () => {
    const plan = planBuilding({ clusters: clusters(7), featured: [], vault: [], config: cfg })
    expect(plan.floors).toHaveLength(2)
    expect(plan.floors[1].rooms).toHaveLength(1)
    expect(plan.floors[1].rooms[0].keys).toHaveLength(7)
    expectPlanSain(plan, cfg)
  })

  it('aucun featured → pas de salle d’honneur, mais un rez-de-chaussée', () => {
    const plan = planBuilding({ clusters: clusters(5), featured: [], vault: [], config: cfg })
    const rdc = plan.floors.find((f) => f.level === 0)!
    expect(rdc.rooms).toEqual([])
  })

  it('aucune réserve → aucun niveau négatif', () => {
    const plan = planBuilding({ clusters: clusters(5), featured: ['acme/x'], vault: [], config: cfg })
    expect(plan.floors.every((f) => f.level >= 0)).toBe(true)
    expect(plan.floors[0].slabHoles).toEqual([])
  })

  it('plus de clusters que roomsPerFloor × 10 → une tour cohérente', () => {
    const nombreux = clusters(...new Array<number>(70).fill(4))
    const plan = planBuilding({ clusters: nombreux, featured: [], vault: [], config: cfg })
    expect(plan.floors).toHaveLength(1 + Math.ceil(70 / 6))
    expect(allRooms(plan)).toHaveLength(70)
    // Toutes les clés sont placées, une seule fois chacune.
    const clefs = allRooms(plan).flatMap((r) => r.keys)
    expect(new Set(clefs).size).toBe(clefs.length)
    expect(clefs).toHaveLength(70 * 4)
    expectPlanSain(plan, cfg)
  })

  it('place les grosses collections en bas et les cabinets en haut', () => {
    const plan = planBuilding({
      clusters: clusters(4, 14, 5, 13, 6, 12, 7, 11),
      featured: [],
      vault: [],
      config: config({ roomsPerFloor: 2 }),
    })
    const parEtage = plan.floors
      .filter((f) => f.level >= 1)
      .map((f) => f.rooms.reduce((s, r) => s + r.keys.length, 0))
    for (let i = 1; i < parEtage.length; i++) {
      expect(parEtage[i]).toBeLessThanOrEqual(parEtage[i - 1])
    }
  })
})

// ── Déterminisme ─────────────────────────────────────────────────────────

describe('déterminisme', () => {
  const entree = {
    clusters: clusters(11, 9, 9, 8, 6, 5, 4),
    featured: ['acme/x', 'acme/y'],
    vault: ['acme/f1'],
    config: config(),
  }

  it('produit deux fois le même bâtiment, octet pour octet', () => {
    const a = JSON.stringify(planBuilding(entree))
    const b = JSON.stringify(planBuilding(entree))
    expect(a).toBe(b)
  })

  it('ne dépend pas de l’ordre d’entrée des clusters', () => {
    const inverse = { ...entree, clusters: [...entree.clusters].reverse() }
    expect(JSON.stringify(planBuilding(inverse))).toBe(JSON.stringify(planBuilding(entree)))
  })

  it('départage les poids égaux par identifiant alphabétique', () => {
    const memePoids = [cluster('zeta', 6), cluster('alpha', 6), cluster('mu', 6)]
    const plan = planBuilding({ clusters: memePoids, featured: [], vault: [], config: config() })
    // Le premier servi prend le côté Nord, dans l'ordre canonique des côtés.
    const nord = plan.floors[1].rooms.find((r) => r.side === 'north')
    expect(nord?.name).toBe('ALPHA')
  })
})

// ── Sur le catalogue réel ────────────────────────────────────────────────

describe('sur les 115 dépôts réels du catalogue', () => {
  // `import.meta.url` n'est pas un chemin fichier sous l'environnement jsdom :
  // on repart de la racine du projet, qui est le répertoire de travail de vitest.
  const catalogue = JSON.parse(
    readFileSync(resolve(process.cwd(), 'public/data/catalogue.json'), 'utf8'),
  ) as Catalogue
  const cfg = config()

  const enReserve = (a: Artwork): boolean => a.isFork || a.isArchived
  const exposes = catalogue.artworks.filter((a) => !enReserve(a))
  const vault = catalogue.artworks.filter(enReserve).map((a) => a.key)
  const featured = [...exposes]
    .sort((a, b) => (b.stars !== a.stars ? b.stars - a.stars : a.key < b.key ? -1 : 1))
    .slice(0, 12)
    .map((a) => a.key)
  const clusterisés = clusterArtworks(exposes, {
    minSize: cfg.clustering.minClusterSize,
    maxSize: cfg.clustering.maxClusterSize,
  })

  const plan = planBuilding({ clusters: clusterisés, featured, vault, config: cfg })

  it('produit un bâtiment structurellement sain', () => {
    expect(clusterisés.length).toBeGreaterThan(0)
    expect(vault.length).toBeGreaterThan(0)
    expectPlanSain(plan, cfg)
  })

  it('n’oublie ni ne duplique aucun dépôt', () => {
    // La salle d'honneur rejoue des dépôts déjà présents dans leur collection :
    // c'est l'entrée qu'on lui a donnée, et l'arbitrage revient à derive().
    // Hors d'elle, chaque dépôt n'est accroché qu'une fois.
    const uneSeuleFois = allRooms(plan)
      .filter((r) => r.id !== 'rdc-honneur')
      .flatMap((r) => r.keys)
    expect(new Set(uneSeuleFois).size).toBe(uneSeuleFois.length)
    expect(new Set(uneSeuleFois)).toEqual(new Set(catalogue.artworks.map((a) => a.key)))

    const collectionnées = allRooms(plan)
      .filter((r) => r.id !== 'reserve-salle' && r.id !== 'rdc-honneur')
      .flatMap((r) => r.keys)
    expect(new Set(collectionnées)).toEqual(new Set(exposes.map((a) => a.key)))
  })

  it('garantit la place de chaque cluster au mur', () => {
    for (const floor of plan.floors.filter((f) => f.level >= 1)) {
      for (const room of floor.rooms) {
        expect(roomCapacity(room), `${room.id} (${room.name})`).toBeGreaterThanOrEqual(
          room.keys.length,
        )
      }
    }
  })

  it('garde une rampe praticable', () => {
    for (const ramp of plan.ramps) expect(rampSlopeDegrees(ramp)).toBeLessThan(40)
  })

  it('reste identique d’une exécution à l’autre', () => {
    const a = JSON.stringify(planBuilding({ clusters: clusterisés, featured, vault, config: cfg }))
    expect(JSON.stringify(plan)).toBe(a)
  })
})
