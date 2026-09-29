import { describe, expect, it } from 'vitest'

import { CLAIR } from '../../domain/meteo.ts'
import { MUSEE } from '../musee.ts'
import { forceDesRayons, nefDuPlan, vitres } from '../rayons.ts'

const nef = nefDuPlan(MUSEE)

describe('la verrière', () => {
  it('huit travées de cinq panneaux, au sommet du berceau, entre les arcs', () => {
    const v = vitres(nef)
    expect(v).toHaveLength(40)
    for (const p of v) {
      expect(p.x0).toBeGreaterThan(19)
      expect(p.x1).toBeLessThan(29)
      expect(p.z0).toBeGreaterThan(nef.z)
      expect(p.z1).toBeLessThan(nef.z + nef.depth)
      // Entre la naissance de la voûte (12,60) et sa clé (20,60).
      expect(p.y).toBeGreaterThan(18.8)
      expect(p.y).toBeLessThanOrEqual(20.6)
    }
  })
})

describe('la force des rayons', () => {
  const midi = { elevation: 40, azimut: 180, jour: 1 }
  it('en plein soleil, et pas la nuit ni quand le soleil rase l\'attique', () => {
    expect(forceDesRayons(midi, CLAIR)).toBe(1)
    expect(forceDesRayons({ elevation: -10, azimut: 0, jour: 0 }, CLAIR)).toBe(0)
    expect(forceDesRayons({ elevation: 8, azimut: 250, jour: 1 }, CLAIR)).toBe(0)
  })

  it('s\'efface sous un ciel couvert ou dans le brouillard', () => {
    expect(forceDesRayons(midi, { nuages: 1, brouillard: 0 })).toBe(0)
    expect(forceDesRayons(midi, { nuages: 0, brouillard: 0.8 })).toBe(0)
    const voile = forceDesRayons(midi, { nuages: 0.5, brouillard: 0 })
    expect(voile).toBeGreaterThan(0.3)
    expect(voile).toBeLessThan(1)
  })
})
