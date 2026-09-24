/**
 * `isNordSud` : une volée court-elle nord-sud (vs est-ouest) ?
 *
 * La comparaison était copiée six fois dans trois fichiers (#28) ; un seul test
 * couvre les quatre valeurs de `direction`, la logique ne variant pas par site.
 */
import { describe, expect, it } from 'vitest'

import { guardrails, isNordSud } from '../geometry.ts'
import { MUSEE } from '../musee.ts'
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

// #27 : guardrails() connaît déjà la surface et la cote de chaque segment (via
// `hautes`) au moment de le construire ; il les rend désormais avec le segment
// au lieu de laisser l'appelant les redeviner par le milieu.
describe('guardrails() rend la surface et la hauteur de ses segments', () => {
  it('porte la cote du palier sur un garde-corps de palier, en `flat`', () => {
    const [palier] = MUSEE.landings
    const segments = guardrails(MUSEE, 0).filter((g) => g.kind === 'flat')
    expect(segments.length).toBeGreaterThan(0)
    for (const g of segments) expect(g.elevation).toBeCloseTo(palier.elevation)
  })

  it('porte la cote du niveau sur un garde-corps de balcon, en `flat`', () => {
    const etage = MUSEE.levels.find((l) => l.id === 1)!
    const segments = guardrails(MUSEE, 1).filter((g) => g.kind === 'flat')
    expect(segments.length).toBeGreaterThan(0)
    for (const g of segments) expect(g.elevation).toBeCloseTo(etage.elevation)
  })

  it("porte la cote du bas de la volée sur un garde-corps de volée, en `flight`", () => {
    const segments = guardrails(MUSEE, 0).filter((g) => g.kind === 'flight')
    expect(segments.length).toBeGreaterThan(0)
    const bottoms = MUSEE.flights.map((f) => f.bottom)
    for (const g of segments) expect(bottoms.some((b) => Math.abs(b - g.elevation) < 1e-6)).toBe(true)
  })
})
