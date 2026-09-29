import { describe, expect, it } from 'vitest'

import { MUSEE } from '../musee'
import { meshLevel } from '../mesh'
import { bandesDuSol, parementDuHall, plinthes } from '../parement'

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

  it('couvre la tranche de la dalle de l’étage, au-dessus des volées latérales', () => {
    // x = 16, z = 17 : le mur ouest au-dessus de la volée ouest, où aucun balcon ne s'appuie.
    const y = MUSEE.storey - MUSEE.slab / 2
    const couvre = parementDuHall(MUSEE, 0).some((b) =>
      Math.abs(b.x - b.w / 2 - hall.x) < 0.2 && Math.abs(b.z - 17) < b.d / 2 && Math.abs(b.y - y) < b.h / 2)
    expect(couvre).toBe(true)
  })
})

describe('bandesDuSol', () => {
  it('rythme le dallage sous les arcs, du pied de l’escalier à l’entrée', () => {
    const travers = bandesDuSol(MUSEE).filter((b) => b.w === hall.width).map((b) => b.z)
    expect(travers).toEqual([22.5, 26, 29.5, 33, 36.5])
  })
})

describe('plinthes', () => {
  it('borde le pied des murs, sans barrer une porte', () => {
    for (const level of [0, 1]) {
      const { hall, salles } = plinthes(MUSEE, level)
      const p = [...hall, ...salles]
      expect(p.length).toBeGreaterThan(20)
      for (const b of p) expect(b.y - b.h / 2).toBeCloseTo(MUSEE.levels[level].elevation)
      for (const o of MUSEE.levels[level].openings.filter((o) => o.kind === 'door' || o.kind === 'entrance'))
        expect(p.some((b) => Math.abs(b.x - o.x) < b.w / 2 - 0.01 && Math.abs(b.z - o.z) < b.d / 2 - 0.01 && Math.abs(b.x - o.x) + Math.abs(b.z - o.z) < 0.5)).toBe(false)
    }
  })
})

describe('main courante murale', () => {
  it('longe le mur des volées latérales, pas la volée centrale', () => {
    const rampantes = meshLevel(MUSEE, 0).filter((b) => b.kind === 'handrail' && b.pente !== undefined && b.d > 4)
    const xs = rampantes.map((b) => b.x)
    expect(xs.some((x) => Math.abs(x - 16.22) < 0.01)).toBe(true)
    expect(xs.some((x) => Math.abs(x - 31.78) < 0.01)).toBe(true)
  })
})
