import { describe, expect, it } from 'vitest'

import { dansLeLobe, feuillesMortes } from '../feuilles.ts'
import { PARC } from '../parc.ts'

describe('feuilles mortes (Babylon)', () => {
  it('découpe cinq lobes : le centre dedans, les coins dehors', () => {
    expect(dansLeLobe(0, 0)).toBe(true)
    expect(dansLeLobe(0.95, 0.95)).toBe(false)
  })

  it('ne pose que la part tombée, couchée sur le sol', () => {
    const toutes = feuillesMortes(PARC, 1)
    const moitie = feuillesMortes(PARC, 0.5)
    expect(feuillesMortes(PARC, 0).positions.length).toBe(0)
    expect(toutes.positions.length).toBeGreaterThan(0)
    const n = moitie.positions.length / toutes.positions.length
    expect(n).toBeGreaterThan(0.4)
    expect(n).toBeLessThan(0.6)
    expect(toutes.colors.length / 4).toBe(toutes.positions.length / 3)
  })
})
