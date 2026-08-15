/**
 * LOT 4 — Le mobilier ne doit rien traverser.
 *
 * Ce fichier ne teste pas `props.ts` avec les boîtes de `props.ts` : ça ne
 * prouverait que la cohérence du module avec lui-même. Il RECONSTRUIT la
 * géométrie réelle du bâtiment — corps des murs (épaisseur importée de
 * `builders/wall.ts`, donc suivie automatiquement si le §9.4 la fait passer à
 * 0,32 m), toiles avec leur cadre, jours des portes, trémies, hélice des
 * rampes — et vérifie qu'aucun prop ne la rencontre.
 *
 * L'épreuve porte sur le VRAI `public/data/museum.json`, pas sur un musée de
 * laboratoire : ce sont ses cotes qui sont à l'écran, et un banc dans un mur ne
 * se voit pas sur une capture prise d'ailleurs.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { BLIND_GALLERY_NAME } from '../layout'

import { FRAME_BORDER, FRAME_DEPTH } from '../../builders/artwork'
import { WALL_THICKNESS } from '../../builders/wall'
import type { Boite, PropId } from '../props'
import { lireGltf, metriquesDuNoeud } from './glbBounds'
import {
  PROP_IDS,
  PROP_METRICS,
  SALLE_ASSEZ_GRANDE,
  boiteDuProp,
  croisent,
  generateur,
  graineDepuis,
  placeProps,
} from '../props'
import type { Floor, Museum, Room, Vec2, Wall } from '../types'

const museum = JSON.parse(
  readFileSync(`${process.cwd()}/public/data/museum.json`, 'utf8'),
) as Museum

const props = placeProps(museum)

// ── Reconstruction indépendante de la géométrie du bâtiment ──────────────

function direction(wall: Wall): Vec2 {
  const dx = wall.b.x - wall.a.x
  const dz = wall.b.z - wall.a.z
  const l = Math.hypot(dx, dz)
  return { x: dx / l, z: dz / l }
}

function longueur(wall: Wall): number {
  return Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z)
}

/** Boîte d'un segment de mur, extrudé de `WALL_THICKNESS` du côté `normal`. */
function corpsDeMur(wall: Wall, elevation: number, u0: number, u1: number): Boite {
  const d = direction(wall)
  const p0 = { x: wall.a.x + d.x * u0, z: wall.a.z + d.z * u0 }
  const p1 = { x: wall.a.x + d.x * u1, z: wall.a.z + d.z * u1 }
  const q0 = { x: p0.x + wall.normal.x * WALL_THICKNESS, z: p0.z + wall.normal.z * WALL_THICKNESS }
  const q1 = { x: p1.x + wall.normal.x * WALL_THICKNESS, z: p1.z + wall.normal.z * WALL_THICKNESS }
  return {
    minX: Math.min(p0.x, p1.x, q0.x, q1.x),
    maxX: Math.max(p0.x, p1.x, q0.x, q1.x),
    minZ: Math.min(p0.z, p1.z, q0.z, q1.z),
    maxZ: Math.max(p0.z, p1.z, q0.z, q1.z),
    minY: elevation,
    maxY: elevation + wall.height,
  }
}

/**
 * Les morceaux PLEINS d'un mur : le mur entier moins ses jours.
 *
 * Un mur percé d'une baie de 5 m n'est pas un obstacle sur ces 5 m-là ; le
 * tester en bloc rendrait le test faux dans le sens confortable — il refuserait
 * des placements légitimes et laisserait passer ceux qu'on veut attraper.
 */
function pleinsDuMur(wall: Wall, elevation: number): Boite[] {
  const l = longueur(wall)
  const jours = [...wall.openings].sort((a, b) => a.start - b.start)
  const morceaux: Boite[] = []
  let u = 0
  for (const jour of jours) {
    if (jour.start > u) morceaux.push(corpsDeMur(wall, elevation, u, jour.start))
    // Le linteau reste plein au-dessus du jour, mais on ne le teste pas :
    // aucun prop de ce module n'est posé dans l'épaisseur d'un mur, et le seul
    // qui vole (le projecteur) est à plus d'un mètre du parement.
    u = Math.max(u, jour.end)
  }
  if (u < l) morceaux.push(corpsDeMur(wall, elevation, u, l))
  return morceaux
}

/** Le volume réellement occupé par une toile et son cadre. */
function corpsDOeuvre(
  wall: Wall,
  u: number,
  largeur: number,
  hauteur: number,
  centerHeight: number,
  elevation: number,
): Boite {
  const d = direction(wall)
  const cx = wall.a.x + d.x * u
  const cz = wall.a.z + d.z * u
  const demi = largeur / 2 + FRAME_BORDER
  const dedans = WALL_THICKNESS
  const dehors = WALL_THICKNESS + FRAME_DEPTH
  const xs = [
    cx - demi * Math.abs(d.x) + wall.normal.x * dedans,
    cx + demi * Math.abs(d.x) + wall.normal.x * dehors,
  ]
  const zs = [
    cz - demi * Math.abs(d.z) + wall.normal.z * dedans,
    cz + demi * Math.abs(d.z) + wall.normal.z * dehors,
  ]
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
    minY: elevation + centerHeight - hauteur / 2 - FRAME_BORDER,
    maxY: elevation + centerHeight + hauteur / 2 + FRAME_BORDER,
  }
}

/** Le jour d'une ouverture : le passage lui-même, sans marge de confort. */
function jourDOuverture(
  wall: Wall,
  opening: { start: number; end: number; height: number },
  elevation: number,
): Boite {
  const d = direction(wall)
  const p0 = { x: wall.a.x + d.x * opening.start, z: wall.a.z + d.z * opening.start }
  const p1 = { x: wall.a.x + d.x * opening.end, z: wall.a.z + d.z * opening.end }
  const n = wall.normal
  return {
    minX: Math.min(p0.x, p1.x) - Math.abs(n.x) * WALL_THICKNESS,
    maxX: Math.max(p0.x, p1.x) + Math.abs(n.x) * WALL_THICKNESS,
    minZ: Math.min(p0.z, p1.z) - Math.abs(n.z) * WALL_THICKNESS,
    maxZ: Math.max(p0.z, p1.z) + Math.abs(n.z) * WALL_THICKNESS,
    minY: elevation,
    maxY: elevation + opening.height,
  }
}

function tremie(hole: { x: number; z: number; width: number; depth: number }, floor: Floor): Boite {
  return {
    minX: hole.x,
    maxX: hole.x + hole.width,
    minZ: hole.z,
    maxZ: hole.z + hole.depth,
    minY: floor.elevation,
    maxY: floor.elevation + floor.ceilingHeight,
  }
}

function parEtage(floorId: string) {
  return props.filter((p) => p.floorId === floorId)
}

function aire(room: Room): number {
  return room.footprint.width * room.footprint.depth
}

// ── Les épreuves ─────────────────────────────────────────────────────────

describe('placeProps — le musée réel', () => {
  it('pose du mobilier et de la végétation partout', () => {
    expect(props.length).toBeGreaterThan(50)
    // Chaque niveau est meublé : un plateau vide serait le symptôme d'un
    // obstacle trop large, pas d'un choix.
    for (const floor of museum.floors) {
      expect(parEtage(floor.id).length).toBeGreaterThan(0)
    }
  })

  it('ne place que des identifiants connus, à échelle et rotation finies', () => {
    for (const prop of props) {
      expect(PROP_IDS).toContain(prop.id)
      expect(Number.isFinite(prop.position.x)).toBe(true)
      expect(Number.isFinite(prop.position.y)).toBe(true)
      expect(Number.isFinite(prop.position.z)).toBe(true)
      expect(Number.isFinite(prop.rotation)).toBe(true)
      expect(prop.scale).toBeGreaterThan(0)
    }
  })

  it('ne croise aucun corps de mur', () => {
    const fautes: string[] = []
    for (const floor of museum.floors) {
      const murs: Boite[] = []
      for (const room of floor.rooms) {
        for (const wall of room.walls) murs.push(...pleinsDuMur(wall, floor.elevation))
      }
      for (const prop of parEtage(floor.id)) {
        const boite = boiteDuProp(prop)
        for (const mur of murs) {
          if (croisent(boite, mur)) fautes.push(`${prop.id} @ ${floor.id} ${JSON.stringify(prop.position)}`)
        }
      }
    }
    expect(fautes).toEqual([])
  })

  it('ne croise aucune œuvre accrochée', () => {
    const fautes: string[] = []
    for (const floor of museum.floors) {
      const oeuvres: Boite[] = []
      for (const room of floor.rooms) {
        for (const wall of room.walls) {
          for (const p of wall.placements) {
            oeuvres.push(
              corpsDOeuvre(wall, p.u, p.width, p.height, p.centerHeight, floor.elevation),
            )
          }
        }
      }
      for (const prop of parEtage(floor.id)) {
        const boite = boiteDuProp(prop)
        for (const oeuvre of oeuvres) {
          if (croisent(boite, oeuvre)) fautes.push(`${prop.id} @ ${JSON.stringify(prop.position)}`)
        }
      }
    }
    expect(fautes).toEqual([])
  })

  it('ne bouche aucune porte ni aucune baie', () => {
    const fautes: string[] = []
    for (const floor of museum.floors) {
      const jours: Boite[] = []
      for (const room of floor.rooms) {
        for (const wall of room.walls) {
          for (const o of wall.openings) jours.push(jourDOuverture(wall, o, floor.elevation))
        }
      }
      for (const prop of parEtage(floor.id)) {
        const boite = boiteDuProp(prop)
        for (const jour of jours) {
          if (croisent(boite, jour)) fautes.push(`${prop.id} @ ${JSON.stringify(prop.position)}`)
        }
      }
    }
    expect(fautes).toEqual([])
  })

  it('ne surplombe aucune trémie', () => {
    const fautes: string[] = []
    for (const floor of museum.floors) {
      const trous = floor.slabHoles.map((h) => tremie(h, floor))
      for (const prop of parEtage(floor.id)) {
        const boite = boiteDuProp(prop)
        for (const trou of trous) {
          if (croisent(boite, trou)) fautes.push(`${prop.id} @ ${JSON.stringify(prop.position)}`)
        }
      }
    }
    expect(fautes).toEqual([])
  })

  it("n'entre dans l'hélice d'aucune rampe", () => {
    const fautes: string[] = []
    for (const ramp of museum.ramps) {
      // Le tablier balaye l'anneau [r − w/2, r + w/2] entre les deux niveaux
      // qu'il relie. Un prop de l'un ou l'autre niveau ne doit pas y entrer.
      const interne = ramp.radius - ramp.width / 2
      const externe = ramp.radius + ramp.width / 2
      for (const prop of props) {
        if (prop.floorId !== ramp.fromFloor && prop.floorId !== ramp.toFloor) continue
        const boite = boiteDuProp(prop)
        const px = Math.min(Math.max(ramp.centre.x, boite.minX), boite.maxX)
        const pz = Math.min(Math.max(ramp.centre.z, boite.minZ), boite.maxZ)
        const proche = Math.hypot(px - ramp.centre.x, pz - ramp.centre.z)
        const loin = Math.max(
          Math.hypot(boite.minX - ramp.centre.x, boite.minZ - ramp.centre.z),
          Math.hypot(boite.maxX - ramp.centre.x, boite.minZ - ramp.centre.z),
          Math.hypot(boite.minX - ramp.centre.x, boite.maxZ - ramp.centre.z),
          Math.hypot(boite.maxX - ramp.centre.x, boite.maxZ - ramp.centre.z),
        )
        if (proche < externe && loin > interne) {
          fautes.push(`${ramp.id} ← ${prop.id} @ ${JSON.stringify(prop.position)}`)
        }
      }
    }
    expect(fautes).toEqual([])
  })

  it('ne fait se chevaucher aucun prop, sauf une plante et sa jardinière', () => {
    const fautes: string[] = []
    for (const floor of museum.floors) {
      const liste = parEtage(floor.id)
      for (let i = 0; i < liste.length; i++) {
        for (let j = i + 1; j < liste.length; j++) {
          const a = liste[i]
          const b = liste[j]
          // Une plante EST posée dans sa jardinière : leurs emprises se
          // recouvrent par construction, et c'est le seul cas admis.
          const empotage =
            (a.id === 'jardiniere' || b.id === 'jardiniere') &&
            Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) < 1e-6
          if (empotage) continue
          if (croisent(boiteDuProp(a), boiteDuProp(b))) {
            fautes.push(`${a.id} × ${b.id} @ ${JSON.stringify(a.position)}`)
          }
        }
      }
    }
    expect(fautes).toEqual([])
  })

  it('reste dans l’emprise du bâtiment', () => {
    const minX = Math.min(...museum.floors.map((f) => f.footprint.x))
    const maxX = Math.max(...museum.floors.map((f) => f.footprint.x + f.footprint.width))
    const minZ = Math.min(...museum.floors.map((f) => f.footprint.z))
    const maxZ = Math.max(...museum.floors.map((f) => f.footprint.z + f.footprint.depth))
    const bas = Math.min(...museum.floors.map((f) => f.elevation))
    const haut = Math.max(...museum.floors.map((f) => f.elevation + f.ceilingHeight))

    for (const prop of props) {
      const boite = boiteDuProp(prop)
      expect(boite.minX).toBeGreaterThanOrEqual(minX)
      expect(boite.maxX).toBeLessThanOrEqual(maxX)
      expect(boite.minZ).toBeGreaterThanOrEqual(minZ)
      expect(boite.maxZ).toBeLessThanOrEqual(maxZ)
      expect(boite.minY).toBeGreaterThanOrEqual(bas - 0.2)
      expect(boite.maxY).toBeLessThanOrEqual(haut + 0.1)
    }
  })

  it('pose chaque prop sur la dalle de son propre niveau', () => {
    for (const prop of props) {
      const floor = museum.floors.find((f) => f.id === prop.floorId)
      expect(floor).toBeDefined()
      if (floor === undefined) continue
      expect(prop.position.y).toBeGreaterThanOrEqual(floor.elevation - 1e-9)
      expect(prop.position.y).toBeLessThanOrEqual(floor.elevation + floor.ceilingHeight + 1e-9)
    }
  })

  it('végétalise toute salle de taille suffisante', () => {
    const nues: string[] = []
    const maigres: string[] = []
    for (const floor of museum.floors) {
      for (const room of floor.rooms) {
        if (aire(room) < SALLE_ASSEZ_GRANDE) continue
        // Un PASSAGE n'a pas à être végétalisé : son métier est d'être
        // franchissable. Depuis que les galeries sont ouvertes aux deux bouts,
        // leurs portes et leurs jours occupent le pourtour, et ce qui reste au
        // milieu est la circulation — y planter une jardinière la barrerait.
        // La règle du §9.4 vise les salles où l'on s'arrête.
        if (room.name === BLIND_GALLERY_NAME) continue
        const plantes = parEtage(floor.id).filter(
          (p) =>
            p.id.startsWith('plante-') &&
            p.position.x >= room.footprint.x &&
            p.position.x <= room.footprint.x + room.footprint.width &&
            p.position.z >= room.footprint.z &&
            p.position.z <= room.footprint.z + room.footprint.depth,
        )
        if (plantes.length === 0) nues.push(room.id)
        // « Au moins deux par salle de bonne taille » (§9.4) : une plante seule
        // dans une salle de 50 m² se lit comme un oubli, pas comme un parti.
        if (plantes.length < 2) maigres.push(`${room.id} (${aire(room).toFixed(0)} m²)`)
      }
    }
    expect(nues).toEqual([])
    expect(maigres).toEqual([])
  })

  it('aligne un projecteur sur chaque mur garni, et aucun ailleurs', () => {
    const projecteurs = props.filter((p) => p.id === 'projecteur')
    expect(projecteurs.length).toBeGreaterThan(50)

    // Tous au plafond de leur niveau : un projecteur à mi-hauteur serait une
    // erreur d'ancrage que rien d'autre ne rattraperait.
    for (const p of projecteurs) {
      const floor = museum.floors.find((f) => f.id === p.floorId)
      expect(p.position.y).toBeCloseTo((floor?.elevation ?? 0) + (floor?.ceilingHeight ?? 0), 6)
    }

    // Jamais plus d'un par œuvre : le rail suit l'accrochage, il ne l'invente pas.
    let oeuvres = 0
    for (const floor of museum.floors) {
      for (const room of floor.rooms) {
        for (const wall of room.walls) oeuvres += wall.placements.length
      }
    }
    expect(projecteurs.length).toBeLessThanOrEqual(oeuvres)
  })

  it('assoit les bancs face à un mur garni', () => {
    const bancs = props.filter((p) => p.id === 'banc')
    expect(bancs.length).toBeGreaterThan(2)
  })
})

describe('les contrôles ont des dents', () => {
  /**
   * Une suite d'épreuves qui passe du premier coup ne prouve rien tant qu'on
   * n'a pas vu ce qu'elle refuse. On fabrique donc les fautes qu'elle est
   * censée attraper — un banc DANS un mur, un socle DANS une porte, une
   * jardinière AU-DESSUS du vide — et on vérifie que la géométrie reconstruite
   * ici les voit. Sans ce bloc, une reconstruction fausse (mauvais signe de
   * normale, boîte vide) rendrait tous les tests ci-dessus verts pour de
   * mauvaises raisons.
   */
  const floor = museum.floors.find((f) => f.id === 'etage-1')
  if (floor === undefined) throw new Error('musée de référence sans etage-1')
  const room = floor.rooms[0]
  const mur = room.walls[0]

  const propAu = (x: number, z: number, y = floor.elevation) => ({
    id: 'banc' as const,
    position: { x, y, z },
    rotation: 0,
    scale: 1,
    floorId: floor.id,
  })

  it('voit un prop planté au milieu d’un mur', () => {
    const milieu = {
      x: (mur.a.x + mur.b.x) / 2 + (mur.normal.x * WALL_THICKNESS) / 2,
      z: (mur.a.z + mur.b.z) / 2 + (mur.normal.z * WALL_THICKNESS) / 2,
    }
    const dedans = pleinsDuMur(mur, floor.elevation).some((corps) =>
      croisent(boiteDuProp(propAu(milieu.x, milieu.z)), corps),
    )
    expect(dedans).toBe(true)
  })

  it('voit un prop planté dans une œuvre', () => {
    const garni = room.walls.find((w) => w.placements.length > 0)
    expect(garni).toBeDefined()
    if (garni === undefined) return
    const p = garni.placements[0]
    const d = direction(garni)
    const corps = corpsDOeuvre(garni, p.u, p.width, p.height, p.centerHeight, floor.elevation)
    const devant = propAu(
      garni.a.x + d.x * p.u + garni.normal.x * (WALL_THICKNESS + 0.02),
      garni.a.z + d.z * p.u + garni.normal.z * (WALL_THICKNESS + 0.02),
      floor.elevation + p.centerHeight - PROP_METRICS.banc.maxY / 2,
    )
    expect(croisent(boiteDuProp(devant), corps)).toBe(true)
  })

  it('voit un prop planté dans une porte', () => {
    const perce = museum.floors
      .flatMap((f) => f.rooms.map((r) => ({ f, r })))
      .flatMap(({ f, r }) => r.walls.map((w) => ({ f, w })))
      .find(({ w }) => w.openings.length > 0)
    expect(perce).toBeDefined()
    if (perce === undefined) return
    const o = perce.w.openings[0]
    const d = direction(perce.w)
    const u = (o.start + o.end) / 2
    const jour = jourDOuverture(perce.w, o, perce.f.elevation)
    const dedans = propAu(
      perce.w.a.x + d.x * u,
      perce.w.a.z + d.z * u,
      perce.f.elevation,
    )
    expect(croisent(boiteDuProp(dedans), jour)).toBe(true)
  })

  it('voit un prop posé au-dessus du vide', () => {
    const avecTremie = museum.floors.find((f) => f.slabHoles.length > 0)
    expect(avecTremie).toBeDefined()
    if (avecTremie === undefined) return
    const trou = avecTremie.slabHoles[0]
    const centre = { x: trou.x + trou.width / 2, z: trou.z + trou.depth / 2 }
    const boite = boiteDuProp({
      ...propAu(centre.x, centre.z, avecTremie.elevation),
      floorId: avecTremie.id,
    })
    expect(croisent(boite, tremie(trou, avecTremie))).toBe(true)
  })
})

describe('placeProps — déterminisme', () => {
  it('rend exactement la même liste à deux appels', () => {
    expect(placeProps(museum)).toEqual(placeProps(museum))
  })

  it("ne dépend d'aucune source d'entropie", () => {
    // Preuve directe : on casse `Math.random` et l'horloge. Un module qui les
    // consulterait ne pourrait pas produire deux fois la même liste — ni même,
    // ici, produire une liste du tout.
    const random = Math.random
    const now = Date.now
    try {
      Math.random = () => {
        throw new Error('Math.random est interdit dans domain/')
      }
      Date.now = () => {
        throw new Error('Date.now est interdit dans domain/')
      }
      expect(placeProps(museum)).toEqual(props)
    } finally {
      Math.random = random
      Date.now = now
    }
  })

  it('garde ses plantes quand une AUTRE salle change', () => {
    // La graine dérive de l'identifiant de salle, pas d'un compteur global :
    // ajouter un dépôt quelque part ne doit pas redistribuer la végétation
    // ailleurs.
    const modifie: Museum = {
      ...museum,
      floors: museum.floors.map((f) =>
        f.id !== 'etage-2'
          ? f
          : { ...f, rooms: f.rooms.filter((r) => r.id !== 'etage-2-south-galerie-0') },
      ),
    }
    const avant = props.filter((p) => p.floorId === 'etage-1')
    const apres = placeProps(modifie).filter((p) => p.floorId === 'etage-1')
    expect(apres).toEqual(avant)
  })
})

describe('le générateur à graine', () => {
  it('hache un identifiant de façon stable et distincte', () => {
    expect(graineDepuis('etage-1-north-0')).toBe(graineDepuis('etage-1-north-0'))
    expect(graineDepuis('etage-1-north-0')).not.toBe(graineDepuis('etage-1-north-1'))
    expect(graineDepuis('')).toBe(0x811c9dc5)
  })

  it('rend une suite reproductible dans [0, 1[', () => {
    const a = generateur(graineDepuis('salle'))
    const b = generateur(graineDepuis('salle'))
    for (let i = 0; i < 200; i++) {
      const v = a()
      expect(v).toBe(b())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('ne repart pas de la même valeur pour deux graines voisines', () => {
    expect(generateur(1)()).not.toBe(generateur(2)())
  })
})

describe('placeProps — cas limites', () => {
  const salle = (id: string, x: number, z: number, w: number, d: number): Room => ({
    id,
    name: id,
    side: 'north',
    footprint: { x, z, width: w, depth: d },
    theme: 'classic',
    walls: [],
    topics: [],
    keys: [],
  })

  const musee = (rooms: Room[]): Museum => ({
    ...museum,
    ramps: [],
    floors: [
      {
        id: 'plat',
        name: 'plat',
        level: 0,
        elevation: 0,
        ceilingHeight: 4.3,
        rooms,
        enclosure: [],
        slabHoles: [],
        footprint: { x: -20, z: -20, width: 40, depth: 40 },
      },
    ],
  })

  it('laisse nue une salle trop petite pour un bac', () => {
    const resultat = placeProps(musee([salle('placard', 0, 0, 2.5, 2.5)]))
    expect(resultat.filter((p) => p.id.startsWith('plante-'))).toEqual([])
  })

  it('ne meuble pas un niveau sans salle', () => {
    expect(placeProps(musee([]))).toEqual([])
  })

  it('ne pose ni banc ni socle dans une salle exiguë', () => {
    const resultat = placeProps(musee([salle('couloir', 0, 0, 20, 3)]))
    expect(resultat.some((p) => p.id === 'banc')).toBe(false)
  })

  /**
   * `PROP_METRICS` dit de lui-même être « mesuré sur les GLB eux-mêmes ». Rien
   * ne le maintenait vrai : le kit se reconstruit par
   * `tools/blender/build-props.py`, et la première refonte d'un prop — le
   * projecteur passant d'un fût vertical à une tête inclinée — a fait grandir
   * son emprise de 0,078 à 0,123 m sans qu'aucun test ne bronche. Une emprise
   * sous-estimée ne casse rien : elle laisse un prop entrer dans un mur, et ça
   * ne se voit qu'à l'écran, depuis le bon angle, si on passe par là.
   *
   * Seuls les quatre props du kit sont couverts : les plantes viennent de
   * `plants-lod.glb`, dont les nœuds portent les noms de Poly Haven
   * (`anthurium_botany_01_a`…) et non les `PropId` du domaine. Les rattacher
   * demanderait une table de correspondance qui serait, elle aussi, à maintenir
   * à la main — donc exactement le défaut qu'on ferme ici.
   */
  it('porte les emprises réellement mesurées sur museum-kit.glb', () => {
    const kit = lireGltf(`${process.cwd()}/public/assets/props/museum-kit.glb`)
    const NOEUDS: Partial<Record<PropId, string>> = {
      banc: 'Banc',
      socle: 'Socle',
      jardiniere: 'Jardiniere',
      projecteur: 'Projecteur',
    }

    for (const [id, nom] of Object.entries(NOEUDS) as [PropId, string][]) {
      const mesure = metriquesDuNoeud(kit, nom)
      expect(mesure, `${nom} absent de museum-kit.glb`).not.toBeNull()
      if (mesure === null) continue

      const table = PROP_METRICS[id]
      // Le millimètre : en deçà, on ferait échouer le test sur du bruit de
      // quantification Draco ; au-delà, on laisserait passer un chanfrein.
      expect(table.radius, `${id}.radius`).toBeGreaterThanOrEqual(mesure.rayon - 0.001)
      expect(table.minY, `${id}.minY`).toBeLessThanOrEqual(mesure.minY + 0.001)
      expect(table.maxY, `${id}.maxY`).toBeGreaterThanOrEqual(mesure.maxY - 0.001)

      // Et pas trop grand non plus : une emprise généreuse ne plante rien dans
      // un mur, mais elle écarte les props les uns des autres sans raison et
      // finit par vider les salles. Dix centimètres de marge, pas plus.
      expect(table.radius, `${id}.radius trop généreux`).toBeLessThanOrEqual(mesure.rayon + 0.1)
    }
  })

  it('rend des emprises cohérentes avec les métriques', () => {
    for (const id of PROP_IDS) {
      const m = PROP_METRICS[id]
      expect(m.radius).toBeGreaterThan(0)
      expect(m.maxY).toBeGreaterThan(m.minY)
    }
    const boite = boiteDuProp({
      id: 'socle',
      position: { x: 3, y: 2, z: -1 },
      rotation: 0,
      scale: 2,
      floorId: 'plat',
    })
    expect(boite.minX).toBeCloseTo(3 - PROP_METRICS.socle.radius * 2, 6)
    expect(boite.maxY).toBeCloseTo(2 + PROP_METRICS.socle.maxY * 2, 6)
  })
})

describe('placeProps — les emprises réservées', () => {
  const rdc = museum.floors.find((f) => f.level === 0)!

  /**
   * Un point RÉELLEMENT disputé, choisi par la mesure et non par intuition.
   *
   * `poserLesSocles` pose DEUX socles dès que la salle dépasse 150 m² — à ±1/3
   * de son axe long, soit x = ±10 pour la salle d'honneur — et un seul, au
   * centre exact, entre 70 et 150 m². À 270 m² le centre est donc LIBRE, et une
   * première version de ce test l'y supposait envahi : il aurait passé sans
   * rien éprouver.
   */
  const cible = { x: -10, z: -10.5 }
  const boite: Boite = {
    minX: cible.x - 0.55,
    maxX: cible.x + 0.55,
    minZ: cible.z - 0.55,
    maxZ: cible.z + 0.55,
    minY: rdc.elevation,
    maxY: rdc.elevation + 1.15,
  }
  const reservee = { floorId: rdc.id, boite }

  it('sans réservation, le mobilier occupe la place — sinon ce test n’a pas de dents', () => {
    const occupants = placeProps(museum).filter(
      (p) => p.floorId === rdc.id && croisent(boiteDuProp(p), boite),
    )
    expect(occupants.length).toBeGreaterThan(0)
  })

  it('avec réservation, AUCUN prop ne croise l’emprise', () => {
    const fautifs = placeProps(museum, [reservee])
      .filter((p) => p.floorId === rdc.id)
      .filter((p) => croisent(boiteDuProp(p), boite))
      .map((p) => `${p.id} en (${p.position.x.toFixed(2)}, ${p.position.z.toFixed(2)})`)
    expect(fautifs).toEqual([])
  })

  it('ne réserve que sur le niveau nommé', () => {
    /*
      Le leurre : une emprise calée sur un prop d'un AUTRE niveau, mais DÉCLARÉE
      sur le rez-de-chaussée.

      Comportement correct : le prop visé survit, puisque la réservation ne vaut
      que pour `rdc` — où cette boîte ne rencontre rien, les niveaux étant
      disjoints en hauteur. Sans le filtre `floorId`, elle serait semée sur tous
      les étages et ferait disparaître ce prop-là.

      C'est la SEULE construction qui met le filtre à l'épreuve. Une boîte calée
      sur `rdc` est géométriquement incapable de toucher un autre niveau —
      `croisent()` exige un recouvrement sur les trois axes, et `rdc` occupe
      [0 ; 4,3] quand `etage-1` commence à 4,7. Une première version de ce test
      procédait ainsi et passait donc à l'identique, filtre ou pas.
    */
    const base = placeProps(museum)
    const ailleurs = base.find((p) => p.floorId !== rdc.id)
    expect(ailleurs).toBeDefined()

    const leurre = { floorId: rdc.id, boite: boiteDuProp(ailleurs!) }
    const avecLeurre = placeProps(museum, [leurre])

    expect(avecLeurre.filter((p) => p.floorId === ailleurs!.floorId)).toEqual(
      base.filter((p) => p.floorId === ailleurs!.floorId),
    )
  })

  it('une réservation sur un niveau inconnu ne change rien', () => {
    expect(placeProps(museum, [{ floorId: 'niveau-inexistant', boite }])).toEqual(
      placeProps(museum),
    )
  })

  it('sans réservation, rend exactement ce que rendait l’appel à un argument', () => {
    expect(placeProps(museum, [])).toEqual(placeProps(museum))
  })
})
