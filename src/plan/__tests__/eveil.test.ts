import { describe, expect, it } from 'vitest'

import { eclat, ilYA, toileRegardee, type Placement } from '../eveil'

// Une toile sur un mur nord (normale vers +z), axe à 1,55 m.
const toile = (key: string, x: number): Placement => ({ key, x, y: 1.55, z: 0, normal: [0, 1], width: 1.2 })

describe('toileRegardee', () => {
  const murs = [toile('a/gauche', -2), toile('a/face', 0)]
  it('choisit la toile dans l’axe du regard, devant son mur, à portée', () => {
    // À 2 m devant, regard vers le nord (yaw 0 = −z).
    expect(toileRegardee(murs, { x: 0, y: 0, z: 2, yaw: 0 })?.key).toBe('a/face')
    // Tourné de 45° vers l'ouest : c'est la toile de gauche.
    expect(toileRegardee(murs, { x: 0, y: 0, z: 2, yaw: Math.PI / 4 })?.key).toBe('a/gauche')
  })
  it('ignore ce qui est dans le dos, derrière le mur, trop loin ou à l’autre étage', () => {
    expect(toileRegardee(murs, { x: 0, y: 0, z: 2, yaw: Math.PI })).toBeNull()
    expect(toileRegardee(murs, { x: 0, y: 0, z: -2, yaw: Math.PI })).toBeNull()
    expect(toileRegardee(murs, { x: 0, y: 0, z: 6, yaw: 0 })).toBeNull()
    expect(toileRegardee(murs, { x: 0, y: 4.8, z: 2, yaw: 0 })).toBeNull()
  })
})

describe('eclat', () => {
  const maintenant = new Date('2026-09-28T12:00:00Z')
  const il_y_a = (j: number) => new Date(maintenant.getTime() - j * 86400000).toISOString()
  it('brille une semaine, pâlit de moitié par mois, s’éteint au bout d’un an', () => {
    expect(eclat(il_y_a(3), maintenant)).toBe(1)
    expect(eclat(il_y_a(37), maintenant)).toBeCloseTo(0.5)
    expect(eclat(il_y_a(67), maintenant)).toBeCloseTo(0.25)
    expect(eclat(il_y_a(400), maintenant)).toBe(0)
  })
  it('dit le temps en mots', () => {
    expect(ilYA(il_y_a(0), maintenant)).toBe('aujourd’hui')
    expect(ilYA(il_y_a(1), maintenant)).toBe('hier')
    expect(ilYA(il_y_a(12), maintenant)).toBe('il y a 12 jours')
    expect(ilYA(il_y_a(70), maintenant)).toBe('il y a 2 mois')
    expect(ilYA(il_y_a(800), maintenant)).toBe('il y a 2 ans')
  })
})
