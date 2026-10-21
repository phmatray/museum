import { describe, expect, it } from 'vitest'

import { amenagerAllees } from '../../plan/allees.ts'
import { hauteurDuParc } from '../../plan/relief.ts'
import { bande, decouper, drape, semisDePierres, touffe } from '../allees.ts'
import { PARC } from '../parc.ts'

describe('allées (Babylon)', () => {
  const a = amenagerAllees(PARC)

  it('drape le gravier sur le relief, UV lues sur le plan', () => {
    const g = drape(a.gravier, 0.03)
    expect(g.positions.length / 3).toBe(a.gravier.xz.length / 2)
    const [x, y, z] = g.positions
    expect(y).toBeCloseTo(hauteurDuParc(x, z) + 0.03, 5)
    expect(g.uvs!.slice(0, 2)).toEqual([x, z])
  })

  it('tourne les faces de la bordure vers le ciel', () => {
    const g = bande(a.bordures, () => [[0, 0.1], [0.1, 0.1]])
    let haut = 0
    for (let i = 0; i < g.indices.length; i += 3) {
      const [p, q, r] = [0, 1, 2].map((k) => g.positions.slice(3 * g.indices[i + k], 3 * g.indices[i + k] + 3))
      // Normale de three (ordre a, b, c, main droite) : y du produit (q − p) × (r − p).
      const ny = (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2])
      if (ny > 0) haut++
    }
    expect(haut).toBe(g.indices.length / 3)
  })

  it('découpe une surface en carreaux sans perdre de triangle', () => {
    const g = drape(a.gravier, 0)
    const cs = decouper(g, 32)
    expect(cs.length).toBeGreaterThan(4)
    expect(cs.reduce((n, c) => n + c.indices.length, 0)).toBe(g.indices.length)
    for (const c of cs) {
      expect(c.uvs!.length / 2).toBe(c.positions.length / 3)
      expect(Math.max(...c.indices)).toBe(c.positions.length / 3 - 1)
    }
  })

  it('donne à chaque pierre 121 sommets colorés et des touffes de 44 brins', () => {
    const p = semisDePierres(a.pierres.slice(0, 2))
    expect(p.positions.length / 3).toBe(2 * 121)
    expect(p.colors!.length / 4).toBe(2 * 121)
    const t = touffe()
    expect(t.positions.length / 3).toBe(44 * 12)
    expect(t.normals!.length).toBe(t.positions.length)
  })
})
