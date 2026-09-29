import { describe, expect, it } from 'vitest'

import { heureFrancaise, leverEtCoucher, lignesDesHoraires } from '../horaires'

const BXL = [50.85, 4.35] as const
/** Minutes depuis minuit, heure de Bruxelles. */
const minutes = (d: Date) => {
  const [h, m] = heureFrancaise(d, 'Europe/Brussels').split(' h ').map(Number)
  return h * 60 + m
}

describe('leverEtCoucher', () => {
  it('trouve à Bruxelles les heures des éphémérides, à trois minutes près', () => {
    // Solstice d'été : 5 h 29 – 21 h 59 (heure d'été) ; d'hiver : 8 h 44 – 16 h 39.
    const jours = [['2026-06-21T12:00:00Z', 5 * 60 + 29, 21 * 60 + 59], ['2026-12-21T12:00:00Z', 8 * 60 + 44, 16 * 60 + 39]] as const
    for (const [date, lever, coucher] of jours) {
      const s = leverEtCoucher(new Date(date), ...BXL)!
      expect(Math.abs(minutes(s.lever) - lever), `${date} lever`).toBeLessThanOrEqual(3)
      expect(Math.abs(minutes(s.coucher) - coucher), `${date} coucher`).toBeLessThanOrEqual(3)
    }
  })

  it('rend null quand le soleil ne se couche pas', () => {
    expect(leverEtCoucher(new Date('2026-06-21T12:00:00Z'), 78, 15)).toBeNull()
  })
})

describe('lignesDesHoraires', () => {
  it('écrit les heures du jour à la française', () => {
    const l = lignesDesHoraires(new Date('2026-12-21T12:00:00Z'), ...BXL)
    expect(l[0]).toBe('Ouvert tous les jours')
    expect(l[2]).toMatch(/^Aujourd’hui : 8 h 4\d – 16 h [34]\d$/)
  })
})
