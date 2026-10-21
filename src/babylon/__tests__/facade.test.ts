import { describe, expect, it } from 'vitest'

import { geometrieDesDrapeaux, resume } from '../facade'

describe('resume', () => {
  it('garde la première phrase sans sa ponctuation finale', () => {
    expect(resume('Une bibliothèque C#.  Elle fait tout.')).toBe('Une bibliothèque C#')
    expect(resume('Un outil — et bien plus')).toBe('Un outil')
  })

  it('coupe au mot vers 90 signes', () => {
    const r = resume('mot '.repeat(40))
    expect(r.endsWith('…')).toBe(true)
    expect(r.length).toBeLessThanOrEqual(89)
    expect(r).not.toMatch(/ …$/)
  })
})

describe('geometrieDesDrapeaux', () => {
  it('tient la toile à 4 cm du mât, sous sa pomme, tournée de π/5', () => {
    const v = geometrieDesDrapeaux([{ x: 6, y: 9.3, z: 38.5 }])
    const p = v.positions!
    expect(p.length).toBe(17 * 5 * 3)
    // Premier sommet : bord de hampe (x = 0), en haut : y = 9,3 + 4 − 0,05.
    expect([p[0], p[1], p[2]]).toEqual([expect.closeTo(6.04, 6), expect.closeTo(13.25, 6), expect.closeTo(38.5, 6)])
    // Bout de la première rangée (x = 1,5) : tourné de π/5 autour de y, plus l'ondulation.
    const z = Math.sin(1.5 * 3.2) * 0.08 * 1.5
    const [c, s] = [Math.cos(Math.PI / 5), Math.sin(Math.PI / 5)]
    expect(p[16 * 3]).toBeCloseTo(6.04 + 1.5 * c + z * s, 6)
    expect(p[16 * 3 + 2]).toBeCloseTo(38.5 - 1.5 * s + z * c, 6)
    expect(v.indices!.length).toBe(16 * 4 * 6)
    expect(v.colors![0]).toBeGreaterThan(0.8)
  })
})
