import { describe, expect, it } from 'vitest'

import LUMIERE from '../../plan/lumiere.json' with { type: 'json' }
import { uvDeModele } from '../glb'

describe('uvDeModele', () => {
  it('ramène les UV glTF (v depuis le haut) dans la région de l’atlas (v depuis le bas)', () => {
    const r = LUMIERE.modeles['salle-honneur']
    const a = uvDeModele([0, 0, 1, 1, 0, 1, 1, 0], r)
    expect(a[0]).toBeCloseTo(1030 / 4096, 6)
    expect(a[1]).toBeCloseTo(2285 / 2304, 6)
    expect(a[2]).toBeCloseTo(2054 / 4096, 6)
    expect(a[3]).toBeCloseTo(1261 / 2304, 6)
    // L'escalier : (0, 1) → coin bas-gauche, (1, 0) → coin haut-droit.
    const e = uvDeModele([0, 1, 1, 0], LUMIERE.modeles.escalier)
    expect(Array.from(e)).toEqual([2 / 4096, 1261 / 2304, 1026 / 4096, 2285 / 2304].map((v) => expect.closeTo(v, 6)))
  })
})
