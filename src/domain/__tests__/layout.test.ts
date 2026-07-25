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
  BLIND_GALLERY_NAME,
  elevationOf,
  isBlindGallery,
  linearNeed,
  planSideSlots,
  roomCapacity,
  planBuilding,
  rampSlopeDegrees,
  subdivideSide,
  targetRoomWidth,
  type BuildingPlan,
} from '../layout'
import { MIN_ARTWORK_GAP, MIN_USABLE_SEGMENT, WALL_CORNER_MARGIN } from '../types'
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

/**
 * Les salles au sens du visiteur. Une galerie aveugle est un volume qui ferme
 * l'enveloppe : elle a bien quatre murs et une emprise — donc tous les
 * invariants structurels lui sont opposables — mais elle n'a ni cluster, ni
 * baie, ni porte, et ne compte pas comme salle (spec §7.2).
 */
function collections(rooms: Room[]): Room[] {
  return rooms.filter((r) => !isBlindGallery(r))
}

/**
 * Les salles d'un plateau que le visiteur peut atteindre depuis l'atrium.
 *
 * On part des salles qui ouvrent une baie sur le vide — le seul accès de plain-
 * pied, puisque la rampe débouche dans l'atrium — et on suit les ouvertures de
 * proche en proche. Une salle dimensionnée par son besoin ne longe plus
 * forcément l'atrium : elle peut se retrouver en angle, et ne tenir que par
 * l'enfilade. Ce qui doit rester vrai, c'est qu'on y arrive.
 */
function atteignables(floor: BuildingPlan['floors'][number], atrium: Rect): Set<string> {
  const voisins = new Map<string, Set<string>>(floor.rooms.map((r) => [r.id, new Set<string>()]))
  const racines = new Set<string>()

  for (const room of floor.rooms) {
    for (const wall of room.walls) {
      const L = wallLength(wall)
      const dir = { x: (wall.b.x - wall.a.x) / L, z: (wall.b.z - wall.a.z) / L }
      for (const o of wall.openings) {
        const u = (o.start + o.end) / 2
        // Un pas au travers de l'ouverture, donc à l'opposé de la normale.
        const x = wall.a.x + dir.x * u - wall.normal.x * 0.05
        const z = wall.a.z + dir.z * u - wall.normal.z * 0.05
        if (contains(atrium, x, z)) {
          racines.add(room.id)
          continue
        }
        for (const autre of floor.rooms) {
          if (autre.id !== room.id && contains(autre.footprint, x, z, -1e-6)) {
            voisins.get(room.id)!.add(autre.id)
            voisins.get(autre.id)!.add(room.id)
          }
        }
      }
    }
  }

  const vus = new Set(racines)
  const pile = [...racines]
  while (pile.length > 0) {
    for (const v of voisins.get(pile.pop()!)!) {
      if (!vus.has(v)) {
        vus.add(v)
        pile.push(v)
      }
    }
  }
  return vus
}

/**
 * Longueur de mur réellement accrochable d'une salle, avec la règle EXACTE de
 * `hanging.ts` : marges d'angle, ouvertures déduites, fragments trop courts
 * jetés. C'est la grandeur à comparer au besoin linéaire d'un cluster.
 */
function offreLineaire(room: Room): number {
  let total = 0
  for (const wall of room.walls) {
    const L = wallLength(wall)
    let segments: [number, number][] = [[WALL_CORNER_MARGIN, L - WALL_CORNER_MARGIN]]
    for (const o of wall.openings) {
      segments = segments.flatMap(([s, e]) => {
        if (o.end <= s || o.start >= e) return [[s, e] as [number, number]]
        const out: [number, number][] = []
        if (o.start > s) out.push([s, Math.min(o.start, e)])
        if (o.end < e) out.push([Math.max(o.end, s), e])
        return out
      })
    }
    for (const [s, e] of segments) if (e - s >= MIN_USABLE_SEGMENT) total += e - s
  }
  return total
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

// ── Dimensionnement par le besoin ────────────────────────────────────────

describe('besoin linéaire', () => {
  it('vaut Σ largeurs + (n+1) écarts, et rien pour une salle vide', () => {
    // L'œuvre de référence de `hanging.ts` : 0,90 m de haut, aspect 2.
    const largeur = 0.9 * 2
    expect(linearNeed(0)).toBe(0)
    expect(linearNeed(1)).toBeCloseTo(largeur + 2 * MIN_ARTWORK_GAP, 6)
    expect(linearNeed(11)).toBeCloseTo(11 * largeur + 12 * MIN_ARTWORK_GAP, 6)
    // Strictement croissant : une œuvre de plus, c'est toujours du mur en plus.
    for (let n = 1; n < 40; n++) expect(linearNeed(n + 1)).toBeGreaterThan(linearNeed(n))
    // Une entrée absurde ne renvoie jamais NaN : la géométrie s'en remettrait mal.
    expect(linearNeed(Number.NaN)).toBe(0)
    expect(linearNeed(-3)).toBe(0)
  })
})

describe('largeur visée d’une salle', () => {
  it('croît avec le cluster, sans jamais sortir de [plancher, côté]', () => {
    let precedente = 0
    for (let n = 1; n <= 30; n++) {
      const w = targetRoomWidth(n, 9, 6, 30)
      expect(w).toBeGreaterThanOrEqual(6)
      expect(w).toBeLessThanOrEqual(30)
      expect(w).toBeGreaterThanOrEqual(precedente)
      precedente = w
    }
    // Le côté est une borne dure : mieux vaut une salle de la taille du côté et
    // la boucle d'atrium ensuite, qu'une salle qui déborde sur sa voisine.
    expect(targetRoomWidth(200, 9, 6, 30)).toBe(30)
    expect(targetRoomWidth(1, 9, 6, 30)).toBe(6)
  })

  it('demande moins de largeur à une salle profonde : ses murs mitoyens portent', () => {
    // Deux mètres de profondeur en plus, c'est quatre mètres de mur mitoyen en
    // plus (deux murs), donc deux mètres de largeur en moins.
    expect(targetRoomWidth(12, 11, 6, 40)).toBeCloseTo(targetRoomWidth(12, 9, 6, 40) - 2, 6)
  })

  it('ne dimensionne pas une salle de 11 œuvres comme un côté de 38 m', () => {
    // Le défaut qu'on corrige, en une ligne : 11 œuvres réclament 27 m de mur,
    // qu'une salle de 10 m de large et 9 m de profond offre déjà.
    const w = targetRoomWidth(11, 9, 6, 38)
    expect(w).toBeLessThan(12)
    expect(w).toBeGreaterThan(6)
  })
})

describe('planSideSlots', () => {
  it('couvre exactement la longueur du côté', () => {
    for (const targets of [[8], [8, 7], [6, 6, 6], [12, 9, 7]]) {
      const slots = planSideSlots(30, targets, 6)!
      expect(slots).not.toBeNull()
      expect(slots.reduce((s, x) => s + x.width, 0)).toBeCloseTo(30, 9)
      // Chaque cluster reçoit un emplacement et un seul.
      const vus = slots.filter((s) => s.cluster >= 0).map((s) => s.cluster)
      expect([...vus].sort((a, b) => a - b)).toEqual(targets.map((_, i) => i))
    }
  })

  it('centre les salles et rejette l’aveuglement dans les angles', () => {
    const slots = planSideSlots(30, [8], 6)!
    expect(slots.map((s) => s.cluster)).toEqual([-1, 0, -1])
    expect(slots[0].width).toBeCloseTo(11, 9)
    expect(slots[2].width).toBeCloseTo(11, 9)
    // Les salles gardent EXACTEMENT leur largeur visée : le reliquat est muré,
    // pas redistribué. C'est tout l'objet du changement.
    expect(slots[1].width).toBe(8)
  })

  it('regroupe le reliquat en une seule galerie quand deux ne tiendraient pas', () => {
    // Reliquat 10 m : deux galeries de 5 m seraient sous le plancher, une de
    // 10 m le respecte.
    const slots = planSideSlots(30, [10, 10], 6)!
    expect(slots.map((s) => s.cluster)).toEqual([-1, 0, 1])
    expect(slots[0].width).toBeCloseTo(10, 9)
  })

  it('rend aux salles un reliquat trop court pour être une pièce', () => {
    const slots = planSideSlots(30, [14, 13], 6)!
    expect(slots.every((s) => s.cluster >= 0)).toBe(true)
    expect(slots.reduce((s, x) => s + x.width, 0)).toBeCloseTo(30, 9)
    // Rendu au prorata : la grande salle prend la plus grosse part des 3 m.
    expect(slots[0].width - 14).toBeGreaterThan(slots[1].width - 13)
  })

  it('renonce quand les largeurs visées ne tiennent pas', () => {
    expect(planSideSlots(30, [20, 20], 6)).toBeNull()
    expect(planSideSlots(30, [30], 6)).toBeNull()
    expect(planSideSlots(30, [], 6)).toBeNull()
  })
})

describe('échelle des salles', () => {
  const cfg = config()
  const plan = planBuilding({
    clusters: clusters(14, 11, 9, 8, 7, 6, 5, 5, 4, 4, 4, 4),
    featured: [],
    vault: [],
    config: cfg,
  })

  it('n’offre à aucune salle plus de 2,5 fois le mur dont son cluster a besoin', () => {
    for (const floor of plan.floors.filter((f) => f.level >= 1)) {
      for (const room of collections(floor.rooms)) {
        const besoin = linearNeed(room.keys.length)
        const long =
          room.side === 'north' || room.side === 'south'
            ? room.footprint.width
            : room.footprint.depth
        // Exemption du plancher : une salle déjà à `minRoomWidth` ne peut pas
        // rétrécir davantage, quel que soit le peu qu'elle expose.
        if (long <= cfg.building.minRoomWidth + 1e-6) continue
        expect(offreLineaire(room) / besoin, `${room.id} (${room.keys.length} œuvres)`).toBeLessThan(
          2.5,
        )
      }
    }
  })

  it('sert quand même chaque cluster : l’offre couvre le besoin', () => {
    for (const floor of plan.floors.filter((f) => f.level >= 1)) {
      for (const room of collections(floor.rooms)) {
        expect(offreLineaire(room), `${room.id}`).toBeGreaterThanOrEqual(
          linearNeed(room.keys.length),
        )
        expect(roomCapacity(room), `${room.id}`).toBeGreaterThanOrEqual(room.keys.length)
      }
    }
  })

  it('ne laisse plus une collection de 5 œuvres tenir tout un côté', () => {
    // Le cas réel qui a motivé le changement : un cluster seul sur un côté de
    // 30 m y était étiré sur 30 m. Il n'en prend plus que ce qu'il remplit.
    const seul = planBuilding({ clusters: clusters(5), featured: [], vault: [], config: cfg })
    const salle = collections(seul.floors[1].rooms)[0]
    const cote = seul.floors[1].footprint.width
    expect(salle.footprint.width).toBeLessThan(cote / 3)
    expect(salle.footprint.width).toBeGreaterThanOrEqual(cfg.building.minRoomWidth)
  })
})

// ── Galeries aveugles ────────────────────────────────────────────────────

describe('galeries aveugles', () => {
  const cfg = config({ roomsPerFloor: 2 })
  const plan = planBuilding({
    clusters: clusters(12, 9, 6, 5),
    featured: ['acme/x'],
    vault: [],
    config: cfg,
  })

  it('ferment l’enveloppe : les quatre côtés existent à chaque plateau', () => {
    for (const floor of plan.floors.filter((f) => f.level >= 1)) {
      const cotes = new Set(floor.rooms.map((r) => r.side))
      expect([...cotes].sort()).toEqual(['east', 'north', 'south', 'west'])

      // Et l'anneau pave exactement la dalle moins l'atrium : sans quoi le
      // visiteur trouve un bord de dalle sans mur, et tombe.
      const aire = floor.rooms.reduce((s, r) => s + r.footprint.width * r.footprint.depth, 0)
      const dalle = floor.footprint.width * floor.footprint.depth
      const vide = plan.atrium.width * plan.atrium.depth
      expect(aire).toBeCloseTo(dalle - vide, 4)
    }
    expectPlanSain(plan, cfg)
  })

  it('n’ont ni baie, ni porte, ni cluster, et restent des pièces', () => {
    const aveugles = allRooms(plan).filter(isBlindGallery)
    expect(aveugles.length).toBeGreaterThan(0)
    for (const g of aveugles) {
      expect(g.name).toBe(BLIND_GALLERY_NAME)
      expect(g.keys).toEqual([])
      expect(g.topics).toEqual([])
      expect(g.walls).toHaveLength(4)
      for (const wall of g.walls) expect(wall.openings, `${wall.id}`).toEqual([])
      const long = g.side === 'north' || g.side === 'south' ? g.footprint.width : g.footprint.depth
      expect(long).toBeGreaterThanOrEqual(cfg.building.minRoomWidth - 1e-6)
    }
  })

  it('ne reçoivent jamais la porte d’une salle voisine', () => {
    // Une porte se juge sur ce qu'il y a DERRIÈRE : on sort du mur d'un pas, à
    // l'endroit de l'ouverture, et on regarde dans quelle salle on tombe. Une
    // galerie aveugle ne perce rien : une porte qui donne sur elle donnerait sur
    // un mur plein.
    for (const floor of plan.floors.filter((f) => f.level >= 1)) {
      const aveugles = floor.rooms.filter(isBlindGallery)
      for (const room of collections(floor.rooms)) {
        for (const wall of room.walls) {
          const L = wallLength(wall)
          const dir = { x: (wall.b.x - wall.a.x) / L, z: (wall.b.z - wall.a.z) / L }
          for (const o of wall.openings) {
            const u = (o.start + o.end) / 2
            const x = wall.a.x + dir.x * u - wall.normal.x * 0.05
            const z = wall.a.z + dir.z * u - wall.normal.z * 0.05
            const derriere = aveugles.find((g) => contains(g.footprint, x, z, -1e-6))
            expect(derriere?.id, `${wall.id} : ${o.kind} donnant sur ${derriere?.id}`).toBeUndefined()
          }
        }
      }
    }
  })

  it('passent après les salles, et ne comptent pas comme telles', () => {
    for (const floor of plan.floors) {
      const ids = floor.rooms.map(isBlindGallery)
      // Aucune vraie salle après la première galerie : `floor.rooms[0]` reste la
      // salle qu'un cartel ou une curation ira chercher.
      expect(ids.slice(ids.indexOf(true) < 0 ? ids.length : ids.indexOf(true)).every(Boolean)).toBe(
        true,
      )
    }
    expect(collections(allRooms(plan))).toHaveLength(4 + 1) // 4 clusters + salle d'honneur
  })

  it('ne coupent la circulation d’aucune salle : tout se rejoint depuis l’atrium', () => {
    for (const floor of plan.floors.filter((f) => f.level >= 1)) {
      const vus = atteignables(floor, plan.atrium)
      for (const room of collections(floor.rooms)) {
        expect(vus.has(room.id), `${room.id} (${room.name}) inatteignable`).toBe(true)
      }
    }
  })

  it('n’encombrent pas le rez-de-chaussée, dont la salle d’honneur tient le côté', () => {
    const rdc = plan.floors.find((f) => f.level === 0)!
    expect(rdc.rooms).toHaveLength(1)
    expect(rdc.rooms[0].id).toBe('rdc-honneur')
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
      // Les galeries aveugles sont exclues : c'est leur définition même de
      // n'avoir ni baie ni porte. Elles ont leur propre test plus bas.
      for (const room of collections(floor.rooms)) {
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
    // Une seule SALLE : le reste du côté part en galeries aveugles, qui ferment
    // l'enveloppe sans prétendre exposer quoi que ce soit.
    expect(collections(plan.floors[1].rooms)).toHaveLength(1)
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
    expect(collections(allRooms(plan))).toHaveLength(70)
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

  it('tient chaque salle à l’échelle de ce qu’elle expose', () => {
    // C'est le test qui aurait dû échouer avant le dimensionnement par le
    // besoin : le corpus réel produisait une salle Nord de 38 m pour 11 œuvres,
    // dont le mur extérieur ne portait que 5 accrochages — un couloir vide.
    const salles = plan.floors
      .filter((f) => f.level >= 1)
      .flatMap((f) => collections(f.rooms))
      .filter((r) => r.keys.length > 0)
    expect(salles.length).toBeGreaterThan(4)

    for (const room of salles) {
      const long =
        room.side === 'north' || room.side === 'south' ? room.footprint.width : room.footprint.depth
      if (long <= cfg.building.minRoomWidth + 1e-6) continue
      expect(
        offreLineaire(room) / linearNeed(room.keys.length),
        `${room.id} (${room.name}, ${room.keys.length} œuvres, ${long.toFixed(1)} m)`,
      ).toBeLessThan(2.5)
    }
  })

  it('laisse chaque salle atteignable depuis l’atrium', () => {
    for (const floor of plan.floors.filter((f) => f.level >= 1)) {
      const vus = atteignables(floor, plan.atrium)
      for (const room of collections(floor.rooms)) {
        expect(vus.has(room.id), `${room.id} (${room.name}) inatteignable`).toBe(true)
      }
    }
  })

  it('ferme l’enveloppe de chaque plateau de collections', () => {
    for (const floor of plan.floors.filter((f) => f.level >= 1)) {
      const aire = floor.rooms.reduce((s, r) => s + r.footprint.width * r.footprint.depth, 0)
      const dalle = floor.footprint.width * floor.footprint.depth
      expect(aire, `${floor.id}`).toBeCloseTo(dalle - plan.atrium.width * plan.atrium.depth, 4)
    }
  })

  it('reste identique d’une exécution à l’autre', () => {
    const a = JSON.stringify(planBuilding({ clusters: clusterisés, featured, vault, config: cfg }))
    expect(JSON.stringify(plan)).toBe(a)
  })
})
