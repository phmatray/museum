import { describe, expect, it } from 'vitest'

import { PAS_DE_LA_RIVE } from '../../plan/belvedere'
import { hauteurDuParc } from '../../plan/relief'
import { eclatDesLanternes, matricesDesPas } from '../belvedere'

describe('belvédère', () => {
  it('allume les lanternes la nuit et les éteint le jour (smoothstep 0,15 → 0,6)', () => {
    expect(eclatDesLanternes(0)).toBe(3.2)
    expect(eclatDesLanternes(0.375)).toBeCloseTo(1.6)
    expect(eclatDesLanternes(1)).toBe(0)
  })

  it('pose chaque pas à +2 cm du relief, tourné de son lacet, ovalisé', () => {
    const m = matricesDesPas()
    expect(m.length).toBe(PAS_DE_LA_RIVE.length * 16)
    PAS_DE_LA_RIVE.forEach((s, i) => {
      const o = i * 16
      expect([m[o + 12], m[o + 13], m[o + 14]]).toEqual([s.x, hauteurDuParc(s.x, s.z) + 0.02, s.z].map(Math.fround))
      // Ligne 0 (stockage Babylon, vecteurs ligne) : l'axe x local, mis à l'échelle puis tourné autour de +Y.
      const ex = s.rayon * (0.9 + 0.2 * Math.sin(s.lacet * 3))
      expect(m[o]).toBeCloseTo(ex * Math.cos(s.lacet))
      expect(m[o + 2]).toBeCloseTo(-ex * Math.sin(s.lacet))
      expect(m[o + 5]).toBeCloseTo(1)
    })
  })
})
