import { describe, expect, it } from 'vitest'

import { MUSEE } from '../musee'
import { bandesDuSol, parementDuHall } from '../parement'

const hall = MUSEE.levels[0].rooms.find((r) => r.id === 'hall')!

describe('parementDuHall', () => {
  it('pose une peau côté hall, jamais dans une porte', () => {
    for (const level of [0, 1]) {
      const peau = parementDuHall(MUSEE, level)
      expect(peau.length).toBeGreaterThan(0)
      for (const b of peau) {
        // Chaque morceau est DANS le hall, collé à son bord.
        expect(b.x - b.w / 2).toBeGreaterThanOrEqual(hall.x - 1e-6)
        expect(b.x + b.w / 2).toBeLessThanOrEqual(hall.x + hall.width + 1e-6)
        expect(b.z - b.d / 2).toBeGreaterThanOrEqual(hall.z - 1e-6)
        expect(b.z + b.d / 2).toBeLessThanOrEqual(hall.z + hall.depth + 1e-6)
      }
    }
    // La porte du hall vers r-o2 (x = 16, z = 24, 2,40 m) reste ouverte sous son linteau.
    const bas = parementDuHall(MUSEE, 0).filter((b) => b.x < hall.x + 0.5 && b.y - b.h / 2 < 1)
    expect(bas.some((b) => b.z - b.d / 2 < 24 && b.z + b.d / 2 > 24)).toBe(false)
  })
})

describe('bandesDuSol', () => {
  it('rythme le dallage sous les arcs, du pied de l’escalier à l’entrée', () => {
    const travers = bandesDuSol(MUSEE).filter((b) => b.w === hall.width).map((b) => b.z)
    expect(travers).toEqual([22.5, 26, 29.5, 33, 36.5])
  })
})
