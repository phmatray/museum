import { describe, expect, it } from 'vitest'

import { cielA, directionDuSoleil, heureDemandee, positionDuSoleil } from '../soleil'

const BRUXELLES = [50.85, 4.35] as const

describe('positionDuSoleil', () => {
  it('culmine à 62,6° au solstice d’été à Bruxelles, plein sud', () => {
    // Midi solaire à Bruxelles : 11 h 44 UTC environ le 21 juin.
    const p = positionDuSoleil(new Date('2026-06-21T11:44:00Z'), ...BRUXELLES)
    expect(p.elevation).toBeCloseTo(62.6, 0)
    expect(p.azimut).toBeGreaterThan(175)
    expect(p.azimut).toBeLessThan(185)
  })
  it('se lève au nord-est vers 3 h 30 UTC en juin, et reste bas en décembre', () => {
    const lever = positionDuSoleil(new Date('2026-06-21T03:30:00Z'), ...BRUXELLES)
    expect(Math.abs(lever.elevation)).toBeLessThan(1.5)
    expect(lever.azimut).toBeGreaterThan(45)
    expect(lever.azimut).toBeLessThan(60)
    expect(positionDuSoleil(new Date('2026-12-21T11:45:00Z'), ...BRUXELLES).elevation).toBeCloseTo(15.7, 0)
    expect(positionDuSoleil(new Date('2026-12-21T23:45:00Z'), ...BRUXELLES).elevation).toBeLessThan(-50)
  })
})

describe('cielA', () => {
  it('fait jour à midi, nuit à minuit, et dore le crépuscule', () => {
    expect(cielA(new Date('2026-06-21T11:44:00Z'), ...BRUXELLES).jour).toBe(1)
    const nuit = cielA(new Date('2026-06-21T23:44:00Z'), ...BRUXELLES)
    expect(nuit.jour).toBe(0)
    expect(nuit.crepuscule).toBe(0)
    const coucher = cielA(new Date('2026-06-21T19:59:00Z'), ...BRUXELLES)
    expect(coucher.jour).toBeGreaterThan(0.2)
    expect(coucher.jour).toBeLessThan(0.8)
    expect(coucher.crepuscule).toBeGreaterThan(0.7)
  })
  it('oriente la lumière vers le sud à midi (z positif dans le plan)', () => {
    const [x, y, z] = directionDuSoleil({ elevation: 45, azimut: 180 })
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(Math.SQRT1_2)
    expect(z).toBeCloseTo(Math.SQRT1_2)
  })
})

describe('heureDemandee', () => {
  it('lit ?heure=HH:MM, et rien d’autre', () => {
    const d = heureDemandee('?heure=22:30', new Date(2026, 8, 28, 10, 0))!
    expect([d.getHours(), d.getMinutes(), d.getDate()]).toEqual([22, 30, 28])
    expect(heureDemandee('', new Date())).toBeNull()
    expect(heureDemandee('?heure=25:00', new Date())).toBeNull()
  })
})
