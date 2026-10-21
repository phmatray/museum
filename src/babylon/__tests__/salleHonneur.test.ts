import { describe, expect, it } from 'vitest'

import { reglagesHonneur } from '../salleHonneur'

describe('reglagesHonneur', () => {
  it('reprend les émissions de three, de jour et de nuit', () => {
    expect(reglagesHonneur(1).emissions).toEqual({ Honneur_Soleil: 1.4, Honneur_Ambre: 0.8, Honneur_Laiton: 0.25, Honneur_Cive: 0.35 })
    const n = reglagesHonneur(0).emissions
    expect(n.Honneur_Soleil).toBeCloseTo(4)
    expect(n.Honneur_Ambre).toBeCloseTo(2.4)
    expect(n.Honneur_Laiton).toBeCloseTo(0.7)
    expect(n.Honneur_Cive).toBeCloseTo(0.85)
  })

  it('accorde la lampe à three à 6 m (decay 1,3 contre 1/d²)', () => {
    // three : I / d^1,3 ; Babylon : I·K / d² — égaux à la distance de référence.
    for (const jour of [0, 0.5, 1]) {
      const three = (6 + 10 * (1 - jour)) / 6 ** 1.3
      expect(reglagesHonneur(jour).lampe / 6 ** 2).toBeCloseTo(three)
    }
  })
})
