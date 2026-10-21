import { describe, expect, it } from 'vitest'

import catalogueCommite from '../../../public/data/catalogue.json'
import type { Catalogue } from '../../domain/types.ts'
import { sculpturesDesVitrines } from '../../plan/sculptures.ts'
import { choisirVitrines } from '../../plan/vitrines.ts'
import { posesDesSculptures, texteDuCartel } from '../sculptures.ts'

const c = catalogueCommite as unknown as Catalogue
const placements = sculpturesDesVitrines(choisirVitrines(c.artworks, c.owners).map((a) => a.key))
const poses = posesDesSculptures(placements)
/** La translation d'une matrice ligne majeure (vecteur ligne). */
const t = (m: Float32Array, i: number) => [m[16 * i + 12], m[16 * i + 13], m[16 * i + 14]]

describe('sculptures', () => {
  it('trois pièces aux vitrines, avec leur cartel', () => {
    expect(placements.map((p) => p.id)).toEqual(['chandelles', 'formulaire', 'arborescence'])
    expect(placements.map(texteDuCartel)).toEqual(['Chandelles\nTaLibStandard', 'Formulaire\nFormCraft', 'Arborescence\nVirtualFileSystem'])
    expect(texteDuCartel({ ...placements[0], project: undefined })).toBe('Chandelles\nPhilippe Matray, 2026')
  })

  it('socle centré à mi-hauteur, à l’échelle de son pied', () => {
    t(poses.socles, 0).forEach((v, k) => expect(v).toBeCloseTo([19.15, 5.25, 2.25][k], 5))
    expect([poses.socles[0], poses.socles[5], poses.socles[10]].map((v) => +v.toFixed(5))).toEqual([1.05, 0.9, 0.45])
  })

  it('plaque, halos et texte devant la face avant', () => {
    t(poses.plaques, 1).forEach((v, k) => expect(v).toBeCloseTo([23.65, 5.58, 2.528][k], 5))
    t(poses.sol, 0).forEach((v, k) => expect(v).toBeCloseTo([19.15, 4.83, 2.5][k], 5))
    t(poses.face, 0).forEach((v, k) => expect(v).toBeCloseTo([19.15, 5.25, 2.477][k], 5))
    t(poses.face, 2).forEach((v, k) => expect(v).toBeCloseTo([28.15, 5.25, 2.527][k], 5))
    // Le halo au sol est à plat : son axe local y (diamètre) tombe sur −z.
    expect([poses.sol[4], poses.sol[5], poses.sol[6]].map((v) => +v.toFixed(5) + 0)).toEqual([0, 0, -2.6])
    expect(poses.textes[0]).toMatchObject({ droite: [1, 0, -0], haut: [0, 1, 0], l: 0.3, h: 0.09 })
    poses.textes[0].centre.forEach((v, k) => expect(v).toBeCloseTo([19.15, 5.58, 2.482][k], 5))
  })

  it('le lacet tourne tout le groupe', () => {
    const [p] = posesDesSculptures([{ ...placements[1], x: 0, y: 0, z: 0, rotation: Math.PI / 2 }]).textes
    p.centre.forEach((v, k) => expect(v).toBeCloseTo([0.282, 0.78, 0][k], 5))
    p.droite.forEach((v, k) => expect(v).toBeCloseTo([0, 0, -1][k], 5))
  })
})
