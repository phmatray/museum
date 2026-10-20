import { describe, expect, it } from 'vitest'

import { scintillement } from '../constellation'

describe('constellation', () => {
  it('scintille de ±15 % autour de la taille, chaque étoile à sa phase', () => {
    expect(scintillement(0.1, 0, 0)).toBeCloseTo(0.1)
    expect(scintillement(0.1, 1, 0)).toBeCloseTo(0.1 * (1 + 0.15 * Math.sin(2.399)))
    for (const t of [0, 1.7, 40]) expect(Math.abs(scintillement(0.2, 0, t) - 0.2)).toBeLessThanOrEqual(0.03 + 1e-9)
  })
})
