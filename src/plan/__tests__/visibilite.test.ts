/**
 * Ce qu'on ne dessine pas doit être vraiment invisible : sinon une salle
 * surgirait au passage d'une porte.
 */
import { describe, expect, it } from 'vitest'

import { MUSEE } from '../musee.ts'
import { NEF, PARC, emprise, traversable, zonesDuVolume, zonesVisibles } from '../visibilite.ts'

const point = (x: number, y: number, z: number) => zonesDuVolume(MUSEE, { x, y, z }, { x, y, z })

describe('zones', () => {
  it('la nef couvre le hall et les balcons, sur toute la hauteur', () => {
    expect(emprise(MUSEE)).toEqual({ x: 16, z: 12, width: 16, depth: 28 })
    expect(point(24, 1.6, 30)).toEqual([NEF])
    expect(point(17.5, 6.4, 30)).toEqual([NEF])
  })

  it('une galerie est de son niveau, le dehors est le parc', () => {
    expect(point(8, 1.6, 20)).toEqual(['r-o2'])
    expect(point(8, 6.4, 20)).toEqual(['e-o2'])
    expect(point(40, 0, 60)).toEqual([PARC])
  })

  it('un mur mitoyen est des deux salles, un mur de façade aussi du parc', () => {
    expect(zonesDuVolume(MUSEE, { x: 15.85, y: 0.5, z: 21 }, { x: 16.15, y: 4.4, z: 26 }).sort()).toEqual([NEF, 'r-o2'].sort())
    // Au-dessus de la cage de l'escalier du sous-sol, ouverte jusqu'au hall : le même mur est aussi de la cage.
    expect(zonesDuVolume(MUSEE, { x: 15.85, y: 0.5, z: 14 }, { x: 16.15, y: 4.4, z: 26 }).sort()).toEqual([NEF, 'r-o2', 'ss-escalier'].sort())
    // Posé au plancher, il touche aussi le plafond du sous-sol : le cinéma et la cage de l'escalier.
    expect(zonesDuVolume(MUSEE, { x: 15.85, y: 0, z: 14 }, { x: 16.15, y: 4.4, z: 26 }).sort()).toEqual([NEF, 'r-o2', 'cinema', 'ss-escalier'].sort())
    expect(zonesDuVolume(MUSEE, { x: -0.15, y: 0, z: 0 }, { x: 0.15, y: 4.5, z: 13 })).toContain(PARC)
    // Une toile du mur de façade reste dans sa salle.
    expect(point(0.2, 1.5, 6)).toEqual(['r-o1'])
  })

  it('les toits se voient du parc', () => {
    expect(zonesDuVolume(MUSEE, { x: 2, y: 9.3, z: 2 }, { x: 14, y: 9.6, z: 12 })).toContain(PARC)
  })
})

describe('zones visibles', () => {
  it('une enfilade de portes alignées se voit, un coude non', () => {
    expect(traversable([[7, 13, 9, 13], [7, 27, 9, 27], [7, 40, 9, 40]])).toBe(true)
    expect(traversable([[16, 5, 16, 7], [7, 13, 9, 13], [16, 23, 16, 25]])).toBe(false)
  })

  it("du fond d'une galerie : l'enfilade et la salle voisine, ni la nef ni le parc", () => {
    const v = zonesVisibles(MUSEE, ['r-o1'], { x: 8, z: 5 })
    for (const z of ['r-o1', 'r-o2', 'r-o3', 'r-n']) expect(v.has(z)).toBe(true)
    for (const z of [PARC, NEF, 'r-e2', 'r-e3', 'e-o1', 'e-e1', 'e-e2', 'honneur']) expect(v.has(z)).toBe(false)
  })

  it("de la nef, les deux niveaux par les portes et la baie, le parc par l'entrée — pas la salle derrière l'escalier", () => {
    const v = zonesVisibles(MUSEE, [NEF])
    for (const z of ['r-o2', 'r-o1', 'e-e3', 'honneur', 'e-o1', PARC]) expect(v.has(z)).toBe(true)
    expect(v.has('r-n')).toBe(false)
  })

  it("de l'étage, par la baie de la salle d'honneur, on plonge dans la nef et ses portes", () => {
    const v = zonesVisibles(MUSEE, ['e-o1'])
    for (const z of ['honneur', NEF, 'r-e2']) expect(v.has(z)).toBe(true)
  })

  it('le parc ne voit que par la porte : les salles du fond restent cachées', () => {
    const v = zonesVisibles(MUSEE, [PARC], { x: 40, z: 52 })
    expect(v.has(NEF)).toBe(true)
    for (const z of ['r-n', 'r-o1', 'r-e1']) expect(v.has(z)).toBe(false)
  })

  it("en descendant l'escalier du sous-sol, au-dessus du rez-de-chaussée : la cage, donc le foyer en bas", () => {
    // L'œil sur la volée, encore plus haut que le dessus du sous-sol (y = 0,48) : il est dans la cage, pas seulement dans la nef.
    const oeil = { x: 17.34, y: 0.48, z: 18.13 }
    const ici = zonesDuVolume(MUSEE, oeil, oeil, 0.4)
    expect(ici).toContain('ss-escalier')
    expect(zonesVisibles(MUSEE, ici, oeil).has('ss-foyer')).toBe(true)
    // Une galerie au-dessus du cinéma reste hors du cinéma, malgré les volées des gradins.
    expect(point(4, 1.6, 14)).toEqual(['r-o2'])
  })
})
