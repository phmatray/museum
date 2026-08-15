/**
 * LOT SCULPTURES — la pièce se pose où il faut, et rien ne la traverse.
 *
 * Comme `props.test.ts`, l'épreuve porte sur le VRAI `public/data/museum.json` :
 * ce sont ses cotes qui sont à l'écran, et une pièce dans un mur ne se voit pas
 * sur une capture prise d'ailleurs.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { boiteDuProp, croisent, placeProps } from '../props'
import {
  boiteDeSculpture,
  emprisesDeSculptures,
  placeSculptures,
  sculptureCartelText,
  yawDeFacing,
} from '../sculptures'
import type { Museum, Sculpture } from '../types'

const reel = JSON.parse(
  readFileSync(`${process.cwd()}/public/data/museum.json`, 'utf8'),
) as Museum

const BAVETTE: Sculpture = {
  id: 'bavette',
  file: 'bavette.glb',
  height: 0.9,
  facing: 'south',
  plinth: { width: 1.1, depth: 1.1, height: 0.25 },
  cartel: {
    author: 'Philippe Matray',
    title: 'Bavette endormi',
    year: 2026,
    medium: 'Photogrammétrie par IA (Meshy), maillage décimé',
    credit: "Collection de l'artiste",
  },
}

function avec(sculptures: Sculpture[]): Museum {
  return { ...reel, config: { ...reel.config, sculptures } }
}

describe('placeSculptures', () => {
  it('ne pose rien quand rien n’est déclaré', () => {
    expect(placeSculptures(avec([]))).toEqual([])
  })

  it('pose la pièce au centre de la salle d’honneur du rez-de-chaussée', () => {
    const [p] = placeSculptures(avec([BAVETTE]))
    const rdc = reel.floors.find((f) => f.level === 0)!
    const salle = rdc.rooms[0]
    expect(p.roomId).toBe(salle.id)
    expect(p.floorId).toBe(rdc.id)
    expect(p.position.x).toBeCloseTo(salle.footprint.x + salle.footprint.width / 2, 6)
    expect(p.position.z).toBeCloseTo(salle.footprint.z + salle.footprint.depth / 2, 6)
    expect(p.position.y).toBeCloseTo(rdc.elevation, 6)
  })

  it('tourne la pièce selon facing — sud = lacet nul', () => {
    const [sud] = placeSculptures(avec([BAVETTE]))
    expect(sud.rotation).toBeCloseTo(0, 6)
    const [nord] = placeSculptures(avec([{ ...BAVETTE, facing: 'north' }]))
    expect(nord.rotation).toBeCloseTo(Math.PI, 6)
  })

  it('honore une salle explicite', () => {
    const cible = reel.floors[2].rooms[1]
    const [p] = placeSculptures(avec([{ ...BAVETTE, room: cible.id }]))
    expect(p.roomId).toBe(cible.id)
    expect(p.floorId).toBe(reel.floors[2].id)
  })

  it('écarte une salle inconnue plutôt que de poser la pièce n’importe où', () => {
    expect(placeSculptures(avec([{ ...BAVETTE, room: 'salle-qui-n-existe-pas' }]))).toEqual([])
  })

  it('rend la même liste à deux appels', () => {
    expect(placeSculptures(avec([BAVETTE]))).toEqual(placeSculptures(avec([BAVETTE])))
  })
})

describe('boiteDeSculpture', () => {
  it('couvre le socle en plan, et le socle plus la pièce en hauteur', () => {
    const [p] = placeSculptures(avec([BAVETTE]))
    const b = boiteDeSculpture(p)
    expect(b.maxX - b.minX).toBeCloseTo(1.1, 6)
    expect(b.maxZ - b.minZ).toBeCloseTo(1.1, 6)
    expect(b.minY).toBeCloseTo(p.position.y, 6)
    expect(b.maxY).toBeCloseTo(p.position.y + 0.25 + 0.9, 6)
  })

  it('ne croise ni mur, ni trémie de sa salle', () => {
    const [p] = placeSculptures(avec([BAVETTE]))
    const b = boiteDeSculpture(p)
    const rdc = reel.floors.find((f) => f.level === 0)!
    for (const hole of rdc.slabHoles) {
      expect(
        croisent(b, {
          minX: hole.x,
          maxX: hole.x + hole.width,
          minZ: hole.z,
          maxZ: hole.z + hole.depth,
          minY: rdc.elevation,
          maxY: rdc.elevation + rdc.ceilingHeight,
        }),
      ).toBe(false)
    }
    for (const wall of rdc.rooms[0].walls) {
      expect(
        croisent(b, {
          minX: Math.min(wall.a.x, wall.b.x) - 0.45,
          maxX: Math.max(wall.a.x, wall.b.x) + 0.45,
          minZ: Math.min(wall.a.z, wall.b.z) - 0.45,
          maxZ: Math.max(wall.a.z, wall.b.z) + 0.45,
          minY: rdc.elevation,
          maxY: rdc.elevation + wall.height,
        }),
      ).toBe(false)
    }
  })

  it('distingue la largeur de la profondeur du socle', () => {
    const [p] = placeSculptures(
      avec([{ ...BAVETTE, plinth: { width: 1.4, depth: 0.8, height: 0.25 } }]),
    )
    const b = boiteDeSculpture(p)
    expect(b.maxX - b.minX).toBeCloseTo(1.4, 6)
    expect(b.maxZ - b.minZ).toBeCloseTo(0.8, 6)
  })
})

describe('le mobilier contourne la pièce', () => {
  const musee = avec([BAVETTE])
  const sculptures = placeSculptures(musee)

  it('la sculpture est bien posée, sinon ce test ne prouve rien', () => {
    expect(sculptures).toHaveLength(1)
  })

  it('AUCUN prop ne croise l’emprise de la sculpture', () => {
    const boite = boiteDeSculpture(sculptures[0])
    const fautifs = placeProps(musee, emprisesDeSculptures(sculptures))
      .filter((p) => p.floorId === sculptures[0].floorId)
      .filter((p) => croisent(boiteDuProp(p), boite))
      .map((p) => `${p.id} en (${p.position.x.toFixed(2)}, ${p.position.z.toFixed(2)})`)
    expect(fautifs).toEqual([])
  })

  /**
   * ⚠️ Ce test PASSE aujourd'hui même sans réservation, et c'est mesuré : au
   * rez-de-chaussée actuel, aucun des 40 props ne tombe au centre de la salle
   * d'honneur — le plus proche est à 2,65 m.
   *
   * Il reste utile, mais il faut savoir ce qu'il est : un GARDE DE RÉGRESSION,
   * pas une preuve du mécanisme. `poserLesSocles` pose un socle au centre exact
   * dès qu'une salle tombe entre 70 et 150 m² ; l'aire de la salle d'honneur
   * dérive du nombre de dépôts, qui change à chaque nuit. Le jour où elle
   * passera sous 150 m², c'est ce test qui parlera.
   *
   * La preuve du mécanisme, elle, vit dans `props.test.ts`, sur un point
   * réellement disputé.
   */
  it('l’emprise reste libre — garde de régression, pas preuve du mécanisme', () => {
    const boite = boiteDeSculpture(sculptures[0])
    const sansReservation = placeProps(musee).filter(
      (p) => p.floorId === sculptures[0].floorId && croisent(boiteDuProp(p), boite),
    )
    // Aujourd'hui zéro. Si ce compte devient non nul un jour, la réservation
    // cesse d'être une précaution et devient indispensable — et le test au-dessus
    // est ce qui l'aura déjà couvert.
    expect(sansReservation.length).toBe(0)
  })
})

/**
 * Cherche une salle dont le CENTRE est réellement occupé par du mobilier.
 *
 * Cherchée dans le musée plutôt que codée en dur : le bâtiment est régénéré à
 * chaque build, et un identifiant de salle figé se périmerait au premier
 * changement de dépôts. Mesuré au moment d'écrire : 13 salles conviennent,
 * `poserLesSocles` posant un socle au centre exact de toute salle dont l'aire
 * tombe entre 70 et 150 m².
 *
 * La boîte est construite par `boiteDeSculpture`, jamais recalculée à la main :
 * un test qui refait le calcul du code testé ne teste que lui-même.
 */
function salleAuCentreOccupe(musee: Museum, modele: Sculpture) {
  const base = placeProps(musee)
  for (const floor of musee.floors) {
    for (const room of floor.rooms) {
      const essai = placeSculptures({
        ...musee,
        config: { ...musee.config, sculptures: [{ ...modele, room: room.id }] },
      })
      if (essai.length === 0) continue
      const boite = boiteDeSculpture(essai[0])
      const occupants = base.filter(
        (p) => p.floorId === floor.id && croisent(boiteDuProp(p), boite),
      )
      if (occupants.length > 0) return { room, floor, boite }
    }
  }
  return null
}

describe('le mobilier contourne la pièce — la preuve, pas la garde', () => {
  const hote = salleAuCentreOccupe(reel, BAVETTE)

  it('une salle au centre occupé existe, sinon ce bloc ne prouve rien', () => {
    expect(hote).not.toBeNull()
  })

  it('sans réservation, un prop occupe la place de la pièce', () => {
    const occupants = placeProps(reel).filter(
      (p) => p.floorId === hote!.floor.id && croisent(boiteDuProp(p), hote!.boite),
    )
    expect(occupants.length).toBeGreaterThan(0)
  })

  it('avec réservation, plus aucun prop ne la croise', () => {
    const musee = {
      ...reel,
      config: { ...reel.config, sculptures: [{ ...BAVETTE, room: hote!.room.id }] },
    }
    const sculptures = placeSculptures(musee)
    const fautifs = placeProps(musee, emprisesDeSculptures(sculptures))
      .filter((p) => p.floorId === sculptures[0].floorId)
      .filter((p) => croisent(boiteDuProp(p), boiteDeSculpture(sculptures[0])))
      .map((p) => `${p.id} en (${p.position.x.toFixed(2)}, ${p.position.z.toFixed(2)})`)
    expect(fautifs).toEqual([])
  })
})

describe('yawDeFacing', () => {
  it('envoie la face avant (+Z du modèle) sur le point cardinal demandé', () => {
    // Une rotation θ autour de Y envoie +Z sur (sin θ, 0, cos θ).
    const cible: Record<string, [number, number]> = {
      south: [0, 1],
      north: [0, -1],
      east: [1, 0],
      west: [-1, 0],
    }
    for (const [facing, [x, z]] of Object.entries(cible)) {
      const t = yawDeFacing(facing as 'south')
      expect(Math.sin(t)).toBeCloseTo(x, 6)
      expect(Math.cos(t)).toBeCloseTo(z, 6)
    }
  })
})

describe('sculptureCartelText', () => {
  it('rédige les quatre lignes dans l’ordre du cartel', () => {
    expect(sculptureCartelText(BAVETTE.cartel)).toBe(
      [
        'Philippe Matray',
        'Bavette endormi, 2026',
        'Photogrammétrie par IA (Meshy), maillage décimé',
        "Collection de l'artiste",
      ].join('\n'),
    )
  })

  it('n’écrit pas de ligne vide quand un champ manque', () => {
    expect(sculptureCartelText({ title: 'Sans titre' })).toBe('Sans titre')
  })

  it('colle l’année au titre plutôt que de lui donner sa propre ligne', () => {
    expect(sculptureCartelText({ title: 'X', year: 2026 })).toBe('X, 2026')
  })
})
