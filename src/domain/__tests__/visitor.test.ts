// @vitest-environment node — localiser un point n'a besoin d'aucun canvas.
/**
 * Tests de la localisation du visiteur (spec §9.3).
 *
 * Le piège de ce module est unique et il est structurel : toutes les salles
 * d'un bâtiment en anneau ont la MÊME emprise au sol d'un étage à l'autre. Une
 * détection qui ne trancherait qu'en `x`/`z` rendrait toujours la salle du
 * rez-de-chaussée, et le plan surlignerait la mauvaise pièce sans que rien
 * n'échoue. La moitié des cas ci-dessous porte donc sur l'altitude.
 *
 * Les points de contrôle sont pris dans le musée RÉEL : ce sont des salles qui
 * existent, aux coordonnées qu'un visiteur atteint en marchant.
 */
import { describe, expect, it } from 'vitest'

import { FLOOR_TOLERANCE, floorAt, locateVisitor, roomAt } from '../visitor'
import type { Museum } from '../types'
import brut from '../../../public/data/museum.json'

const MUSEE = brut as unknown as Museum

/** Œil du visiteur, à 1,6 m au-dessus du plancher du niveau demandé. */
function oeil(floorId: string, x: number, z: number) {
  const floor = MUSEE.floors.find((f) => f.id === floorId)!
  return { x, y: floor.elevation + 1.6, z }
}

describe('locateVisitor — points connus', () => {
  it('trouve la salle d’honneur au rez-de-chaussée', () => {
    // `rdc-honneur` occupe tout le côté Nord : x ∈ [−15, 15], z ∈ [−15, −6].
    expect(locateVisitor(MUSEE, oeil('rdc', 0, -10))).toEqual({
      floorId: 'rdc',
      roomId: 'rdc-honneur',
    })
  })

  it('trouve une salle thématique du premier étage', () => {
    // `etage-1-north-0` : x ∈ [−3,1 ; 9], z ∈ [−15, −6].
    expect(locateVisitor(MUSEE, oeil('etage-1', 3, -10))).toEqual({
      floorId: 'etage-1',
      roomId: 'etage-1-north-0',
    })
  })

  it('distingue deux étages à la verticale l’un de l’autre', () => {
    // Même (x, z), deux altitudes : c'est le cas que seule l'altitude tranche.
    const bas = locateVisitor(MUSEE, oeil('etage-1', 10, -6.5))
    const haut = locateVisitor(MUSEE, oeil('etage-2', 10, -6.5))
    expect(bas?.floorId).toBe('etage-1')
    expect(haut?.floorId).toBe('etage-2')
    expect(bas?.roomId).not.toBe(haut?.roomId)
  })

  it('trouve la réserve, sous le rez-de-chaussée', () => {
    expect(locateVisitor(MUSEE, oeil('reserve', 0, 0))).toEqual({
      floorId: 'reserve',
      roomId: 'reserve-salle',
    })
  })

  it('rend le niveau sans salle au-dessus du vide de l’atrium', () => {
    // Le centre de l'atrium est une trémie : on est dans le bâtiment, pas dans
    // une salle. Les deux réponses sont différentes et doivent le rester.
    expect(locateVisitor(MUSEE, oeil('etage-1', 0, 0))).toEqual({
      floorId: 'etage-1',
      roomId: null,
    })
  })

  it('reconnaît chaque salle du bâtiment depuis son centre', () => {
    for (const floor of MUSEE.floors) {
      for (const room of floor.rooms) {
        const p = {
          x: room.footprint.x + room.footprint.width / 2,
          y: floor.elevation + 1.6,
          z: room.footprint.z + room.footprint.depth / 2,
        }
        const trouve = locateVisitor(MUSEE, p)
        expect(trouve?.floorId).toBe(floor.id)
        // Les salles d'un même niveau ne se recouvrent pas : le centre d'une
        // salle ne peut appartenir qu'à elle.
        expect(trouve?.roomId).toBe(room.id)
      }
    }
  })
})

describe('locateVisitor — hors du bâtiment', () => {
  it('rend null à côté de la dalle', () => {
    expect(locateVisitor(MUSEE, oeil('rdc', 100, 0))).toBeNull()
    expect(locateVisitor(MUSEE, oeil('rdc', 0, -40))).toBeNull()
    expect(locateVisitor(MUSEE, oeil('rdc', -15.5, -10))).toBeNull()
  })

  it('rend null sous le plancher le plus bas', () => {
    const bas = Math.min(...MUSEE.floors.map((f) => f.elevation))
    expect(locateVisitor(MUSEE, { x: 0, y: bas - 5, z: -10 })).toBeNull()
  })

  it('rend null au-dessus de la toiture', () => {
    const haut = Math.max(...MUSEE.floors.map((f) => f.elevation + f.ceilingHeight))
    expect(locateVisitor(MUSEE, { x: 0, y: haut + 30, z: -10 })).toBeNull()
  })

  it('tolère les quelques centimètres d’enfoncement dans la dalle', () => {
    const e1 = MUSEE.floors.find((f) => f.id === 'etage-1')!
    const p = { x: 3, y: e1.elevation - FLOOR_TOLERANCE / 2, z: -10 }
    expect(locateVisitor(MUSEE, p)?.floorId).toBe('etage-1')
  })
})

describe('floorAt', () => {
  it('rattache la rampe au niveau qu’on n’a pas encore quitté', () => {
    // À mi-hauteur entre le rez-de-chaussée et le premier étage, on est encore
    // « au rez-de-chaussée » : on n'arrive à l'étage qu'en y posant le pied.
    expect(floorAt(MUSEE, 2.4)?.id).toBe('rdc')
    expect(floorAt(MUSEE, 4.7)?.id).toBe('etage-1')
  })

  it('rend null hors de la pile de niveaux', () => {
    expect(floorAt(MUSEE, -50)).toBeNull()
    expect(floorAt(MUSEE, 1000)).toBeNull()
  })
})

describe('roomAt', () => {
  it('ne rend que la salle, et null partout ailleurs', () => {
    expect(roomAt(MUSEE, oeil('rdc', 0, -10))).toBe('rdc-honneur')
    expect(roomAt(MUSEE, oeil('etage-1', 0, 0))).toBeNull()
    expect(roomAt(MUSEE, oeil('rdc', 100, 0))).toBeNull()
  })

  it('est déterministe : mille appels, une réponse', () => {
    const p = oeil('etage-1', 3, -10)
    const attendu = roomAt(MUSEE, p)
    for (let i = 0; i < 1000; i++) expect(roomAt(MUSEE, p)).toBe(attendu)
  })

  it('ne consulte ni horloge ni aléa', () => {
    const source = locateVisitor.toString() + floorAt.toString()
    expect(source).not.toMatch(/Math\.random|Date\.now/)
  })
})
