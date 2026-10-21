import { describe, expect, it } from 'vitest'

import { deborder, geometrieDeQuads, rangerTuiles, uvDeCase } from '../textes'

describe('textes peints', () => {
  it('range les cases en étagères sous la largeur maximale, les plus hautes d’abord', () => {
    const tailles = [{ l: 300, h: 100 }, { l: 300, h: 50 }, { l: 300, h: 80 }]
    const { L, H, places } = rangerTuiles(tailles, 700)
    expect(places).toEqual([{ x: 0, y: 0 }, { x: 0, y: 102 }, { x: 302, y: 0 }])
    expect(L).toBeLessThanOrEqual(700)
    expect(H).toBe(152)
    for (const [i, p] of places.entries()) {
      const [u0, v0, u1, v1] = uvDeCase(p, tailles[i], L, H)
      for (const v of [u0, v0, u1, v1]) expect(v >= 0 && v <= 1).toBe(true)
      // Haut du canevas en v = 1.
      expect(v1).toBeGreaterThan(v0)
    }
    expect(uvDeCase(places[0], tailles[0], L, H)[3]).toBe(1)
  })

  it('oriente un quad sur droite × haut, face avant en main droite (0 2 1)', () => {
    // Un cartel sur un mur de normale (sin r, cos r) : droite = (nz, 0, −nx).
    const r = 0.7
    const [nx, nz] = [Math.sin(r), Math.cos(r)]
    const g = geometrieDeQuads([{ centre: [1, 2, 3], droite: [nz, 0, -nx], haut: [0, 1, 0], l: 0.3, h: 0.16, uv: [0, 0, 1, 1] }])
    expect(g.normals[0]).toBeCloseTo(nx)
    expect(g.normals[1]).toBeCloseTo(0)
    expect(g.normals[2]).toBeCloseTo(nz)
    // Coin bas-gauche, puis haut-droit.
    expect(g.positions[0]).toBeCloseTo(1 - 0.15 * nz)
    expect(g.positions[1]).toBeCloseTo(2 - 0.08)
    expect(g.positions[7]).toBeCloseTo(2 + 0.08)
    expect(Array.from(g.indices)).toEqual([0, 2, 1, 0, 3, 2])
  })

  it('déborde la teinte de l’encre sur les pixels vides, alpha 0 gardé', () => {
    // 3 × 2 : une seule encre (10, 20, 30) au milieu de la rangée du haut.
    const d = new Uint8Array(3 * 2 * 4)
    d.set([10, 20, 30, 255], 4)
    deborder(d, 3, 2)
    for (let i = 0; i < 6; i++) expect([...d.subarray(4 * i, 4 * i + 3)]).toEqual([10, 20, 30])
    expect([d[3], d[7], d[11], d[15]]).toEqual([0, 255, 0, 0])
  })
})
