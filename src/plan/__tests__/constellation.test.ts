import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { constellations, VOLUME } from '../constellation'
import type { Accrochage } from '../hang'

const accrochage = JSON.parse(readFileSync('public/data/accrochage.json', 'utf8')) as Accrochage

describe('constellations', () => {
  const ciel = constellations(accrochage, new Map([['phmatray/MusicTheory', 1000]]))
  const toutes = ciel.flatMap((c) => c.etoiles)

  it('fait de chaque salle un amas, de chaque dépôt accroché une étoile', () => {
    const salles = accrochage.rooms.filter((r) => r.placements.length > 0)
    expect(ciel.map((c) => c.salle)).toEqual(salles.map((s) => s.id))
    expect(toutes.length).toBe(salles.reduce((n, s) => n + s.placements.length, 0))
  })

  it('suspend les étoiles entre les balcons, à hauteur des yeux de qui s’y tient', () => {
    for (const e of toutes) {
      // Entre les garde-corps des balcons (x = 19 et 29), jamais au-dessus d'eux.
      expect(e.x).toBeGreaterThanOrEqual(19.9 - 1e-6)
      expect(e.x).toBeLessThanOrEqual(28.1 + 1e-6)
      expect(e.z).toBeGreaterThanOrEqual(VOLUME.z0)
      expect(e.z).toBeLessThanOrEqual(VOLUME.z1)
      // Les yeux d'un visiteur au balcon sont à 4,80 + 1,62 = 6,42 m.
      expect(e.y).toBeGreaterThanOrEqual(6.1)
      expect(e.y).toBeLessThanOrEqual(8.6)
      // Le fil monte jusqu'à la voûte.
      expect(e.accroche).toBeGreaterThan(e.y + 3)
    }
  })

  it('tient les étoiles à l’écart des lanternes', () => {
    const lanternes = [20.5, 27.5].flatMap((x) => [20.75, 27.75, 34.75].map((z) => [x, z]))
    for (const e of toutes) for (const [x, z] of lanternes) expect(Math.hypot(e.x - x, e.z - z)).toBeGreaterThanOrEqual(0.9 - 1e-6)
  })

  it('relie les étoiles d’un amas par un arbre, et grossit les dépôts étoilés', () => {
    for (const c of ciel) expect(c.filets).toHaveLength(Math.max(0, c.etoiles.length - 1))
    const star = toutes.find((e) => e.key === 'phmatray/MusicTheory')!
    expect(star.taille).toBeGreaterThan(Math.max(...toutes.filter((e) => e !== star).map((e) => e.taille)))
    expect(constellations(accrochage, new Map())).toEqual(constellations(accrochage, new Map()))
  })
})
