/**
 * `isNordSud` : une volée court-elle nord-sud (vs est-ouest) ?
 *
 * La comparaison était copiée six fois dans trois fichiers (#28) ; un seul test
 * couvre les quatre valeurs de `direction`, la logique ne variant pas par site.
 */
import { describe, expect, it } from 'vitest'

import { isNordSud } from '../geometry.ts'
import type { Direction, Flight } from '../types.ts'

const volee = (direction: Direction): Flight => ({
  id: 'v', x: 0, z: 0, width: 1, depth: 1, bottom: 0, top: 1, risers: 4, direction,
})

describe('isNordSud', () => {
  it('vrai pour une volée north ou south', () => {
    expect(isNordSud(volee('north'))).toBe(true)
    expect(isNordSud(volee('south'))).toBe(true)
  })

  it('faux pour une volée east ou west', () => {
    expect(isNordSud(volee('east'))).toBe(false)
    expect(isNordSud(volee('west'))).toBe(false)
  })
})
