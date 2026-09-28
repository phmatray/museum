import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { constellations } from '../constellation'
import type { Accrochage } from '../hang'

const accrochage = JSON.parse(readFileSync('public/data/accrochage.json', 'utf8')) as Accrochage

describe('constellations', () => {
  const ciel = constellations(accrochage, new Map([['phmatray/MusicTheory', 1000]]))

  it('fait de chaque salle une constellation, de chaque dépôt accroché une étoile', () => {
    const salles = accrochage.rooms.filter((r) => r.placements.length > 0)
    expect(ciel.map((c) => c.salle)).toEqual(salles.map((s) => s.id))
    expect(ciel.flatMap((c) => c.etoiles).length).toBe(salles.reduce((n, s) => n + s.placements.length, 0))
  })

  it('pose les étoiles sous la verrière, entre les pignons et hors des arcs doubleaux', () => {
    for (const e of ciel.flatMap((c) => c.etoiles)) {
      const r = Math.hypot(e.x - 24, e.y - 12.6)
      expect(r).toBeCloseTo(7.7, 6)
      // Dans la verrière : au-dessus de 52° de part et d'autre.
      expect(e.y).toBeGreaterThan(12.6 + 7.7 * Math.sin((52 * Math.PI) / 180) - 1e-6)
      expect(e.z).toBeGreaterThan(12)
      expect(e.z).toBeLessThan(40)
      const arc = 12 + Math.round((e.z - 12) / 3.5) * 3.5
      expect(Math.abs(e.z - arc)).toBeGreaterThanOrEqual(0.35 + 0.15 - 1e-6)
    }
  })

  it('relie les étoiles d’une salle par un arbre, et grossit les dépôts étoilés', () => {
    for (const c of ciel) expect(c.filets).toHaveLength(Math.max(0, c.etoiles.length - 1))
    const toutes = ciel.flatMap((c) => c.etoiles)
    const star = toutes.find((e) => e.key === 'phmatray/MusicTheory')!
    expect(star.taille).toBeGreaterThan(Math.max(...toutes.filter((e) => e !== star).map((e) => e.taille)))
    // Déterministe : même accrochage, même ciel.
    expect(constellations(accrochage, new Map())).toEqual(constellations(accrochage, new Map()))
  })
})
