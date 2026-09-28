import { expect, it } from 'vitest'

import { anglesHorloge } from '../horloge'

it('met les aiguilles à l’heure, l’aiguille des heures glissant avec les minutes', () => {
  const tour = 2 * Math.PI
  expect(anglesHorloge(new Date(2026, 8, 28, 12, 0, 0))).toEqual({ heures: 0, minutes: 0 })
  const a = anglesHorloge(new Date(2026, 8, 28, 15, 30, 0))
  expect(a.minutes).toBeCloseTo(tour / 2)
  expect(a.heures).toBeCloseTo((tour * 3.5) / 12)
  // 21 h comme 9 h : un cadran de douze heures.
  expect(anglesHorloge(new Date(2026, 8, 28, 21, 0, 0)).heures).toBeCloseTo((tour * 9) / 12)
})
