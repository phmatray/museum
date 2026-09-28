import { expect, it } from 'vitest'

import { anglesHorloge, coupDeCloche, coupsDeLHeure } from '../horloge'

it('met les aiguilles à l’heure, l’aiguille des heures glissant avec les minutes', () => {
  const tour = 2 * Math.PI
  expect(anglesHorloge(new Date(2026, 8, 28, 12, 0, 0))).toEqual({ heures: 0, minutes: 0 })
  const a = anglesHorloge(new Date(2026, 8, 28, 15, 30, 0))
  expect(a.minutes).toBeCloseTo(tour / 2)
  expect(a.heures).toBeCloseTo((tour * 3.5) / 12)
  // 21 h comme 9 h : un cadran de douze heures.
  expect(anglesHorloge(new Date(2026, 8, 28, 21, 0, 0)).heures).toBeCloseTo((tour * 9) / 12)
})

it('sonne le nombre d’heures du cadran de douze heures', () => {
  expect(coupsDeLHeure(new Date(2026, 8, 28, 0, 0))).toBe(12)
  expect(coupsDeLHeure(new Date(2026, 8, 28, 12, 0))).toBe(12)
  expect(coupsDeLHeure(new Date(2026, 8, 28, 15, 0))).toBe(3)
})

it('lève le marteau, frappe, puis laisse la cloche vibrer et s’éteindre', () => {
  expect(coupDeCloche(-1)).toEqual({ marteau: 0, cloche: 0 })
  expect(coupDeCloche(0.3).marteau).toBeLessThan(-0.5)
  expect(Math.abs(coupDeCloche(0.43).marteau)).toBeLessThan(0.01)
  expect(Math.abs(coupDeCloche(0.5).cloche)).toBeGreaterThan(0.02)
  expect(Math.abs(coupDeCloche(4).cloche)).toBeLessThan(0.001)
})
