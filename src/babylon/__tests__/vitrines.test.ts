import { describe, expect, it } from 'vitest'

import { posesDesVitrines } from '../vitrines'

describe('vitrines', () => {
  it('pose panneau, cadre et borne de chaque vitrine, et couche l’écran sur la borne', () => {
    const { pieces, ecrans } = posesDesVitrines()
    expect(pieces).toHaveLength(9)
    const rang1 = pieces.slice(3, 6)
    const attendu = [['Panneau', 24, 4.8, 0.197], ['Cadre', 25.1, 6.8, 0.237], ['Borne', 25.1, 4.8, 2.1]] as const
    attendu.forEach(([piece, x, y, z], i) => {
      expect(rang1[i].piece).toBe(piece)
      expect(rang1[i].x).toBeCloseTo(x)
      expect(rang1[i].y).toBeCloseTo(y)
      expect(rang1[i].z).toBeCloseTo(z)
      expect(rang1[i].lacet).toBe(0)
    })
    expect(pieces[0].x).toBeCloseTo(19.5)
    const { base, normale } = ecrans[1]
    expect(normale[0]).toBe(0)
    expect(normale[1]).toBeCloseTo(0.9, 3)
    expect(normale[2]).toBeCloseTo(0.435, 3)
    expect(base[0]).toBeCloseTo(25.1)
    expect(base[1]).toBeCloseTo(4.8 + 1.086 + 0.0036, 4)
    expect(base[2]).toBeCloseTo(2.1 + 0.005 + 0.00174, 4)
  })
})
