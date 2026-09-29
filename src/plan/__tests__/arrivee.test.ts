import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { Catalogue } from '../../domain/types'
import { arriveeDevant, cibleDe } from '../arrivee'
import { CIMAISES } from '../cimaises'
import { toileRegardee } from '../eveil'
import type { Accrochage } from '../hang'
import { MUSEE } from '../musee'
import { surfaceAt } from '../rules'
import { borneRegardee, choisirVitrines } from '../vitrines'

const accrochage = JSON.parse(readFileSync('public/data/accrochage.json', 'utf8')) as Accrochage
const catalogue = JSON.parse(readFileSync('public/data/catalogue.json', 'utf8')) as Catalogue
const vitrines = choisirVitrines(catalogue.artworks, catalogue.owners).map((a) => a.key)
const placements = accrochage.rooms.flatMap((r) => r.placements)
const surCimaise = (key: string) => {
  const r = accrochage.rooms.find((r) => r.placements.some((p) => p.key === key))!
  const p = r.placements.find((p) => p.key === key)!
  return CIMAISES.some((c) => c.salle === r.id && Math.abs((c.axe === 'x' ? c.z : c.x) - (c.axe === 'x' ? p.z : p.x)) < 0.2)
}

const arrivee = (cle: string) => {
  const c = cibleDe(cle, accrochage, vitrines)
  expect(c, cle).not.toBeNull()
  const a = arriveeDevant(MUSEE, c!)
  expect(a, cle).not.toBeNull()
  return { c: c!, a: a! }
}

describe('arriveeDevant', () => {
  it('pose le visiteur à 2,5–3 m devant une toile de mur, face à elle, et la carte s’ouvre', () => {
    const cle = placements.find((p) => !surCimaise(p.key))!.key
    const { c, a } = arrivee(cle)
    expect(Math.hypot(a.x - c.x, a.z - c.z)).toBeGreaterThanOrEqual(2.2)
    expect(Math.hypot(a.x - c.x, a.z - c.z)).toBeLessThanOrEqual(3.2)
    expect(toileRegardee(placements, a)?.key).toBe(cle)
  })

  it('devant une toile de cimaise, dans sa salle', () => {
    const cle = placements.find((p) => surCimaise(p.key))!.key
    const { c, a } = arrivee(cle)
    expect(a.surface.endsWith(`:${c.salle}`)).toBe(true)
    expect(toileRegardee(placements, a)?.key).toBe(cle)
  })

  it('devant une vitrine de la salle d’honneur : sa borne s’ouvre, le regard monte vers la toile', () => {
    vitrines.forEach((cle, rang) => {
      const { a } = arrivee(cle)
      expect(borneRegardee(a)).toBe(rang)
      expect(a.pitch).toBeGreaterThan(0)
    })
  })

  it('chaque toile du musée a son arrivée, praticable et tournée vers elle', () => {
    for (const cle of [...placements.map((p) => p.key), ...vitrines]) {
      const { c, a } = arrivee(cle)
      expect(surfaceAt(MUSEE, a.x, a.z, a.y), cle).toBe(a.surface)
      // Le regard (yaw 0 = −z) pointe vers la toile.
      const [dx, dz] = [c.x - a.x, c.z - a.z]
      expect((-Math.sin(a.yaw) * dx - Math.cos(a.yaw) * dz) / Math.hypot(dx, dz), cle).toBeCloseTo(1, 6)
      // Devant le mur, pas derrière.
      expect(-(dx * c.normal[0] + dz * c.normal[1]), cle).toBeGreaterThan(1.5)
    }
  })

  it('un projet absent du musée n’a pas de toile', () => {
    expect(cibleDe('phmatray/nexiste-pas', accrochage, vitrines)).toBeNull()
  })
})
