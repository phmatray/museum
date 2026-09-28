import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { Accrochage } from '../hang'
import { MUSEE } from '../musee'
import { projecteurs, rails, RECUL } from '../projecteurs'

const accrochage = JSON.parse(readFileSync('public/data/accrochage.json', 'utf8')) as Accrochage
const toiles = accrochage.rooms.flatMap((r) => r.placements.map((p) => ({ ...p, level: r.level })))

describe('projecteurs', () => {
  const tous = projecteurs(MUSEE, accrochage)

  it('pose un projecteur par toile, au plafond de son étage, sur le cadre de plâtre', () => {
    expect(tous).toHaveLength(toiles.length)
    for (const pr of tous) {
      const t = toiles.find((t) => t.key === pr.key)!
      expect(pr.y).toBeCloseTo((t.level === 0 ? 0 : 4.8) + 4.8 - 0.3 - 0.02, 6)
      expect(Math.hypot(pr.x - t.x, pr.z - t.z)).toBeCloseTo(RECUL, 6)
    }
  })

  it('tourne la monture vers le mur et incline la tête sur le centre de la toile', () => {
    for (const pr of tous) {
      // L'avant (+Z local) tourné du lacet, puis incliné : il doit viser la cible.
      const avant = [Math.sin(pr.lacet) * Math.cos(pr.inclinaison), -Math.sin(pr.inclinaison), Math.cos(pr.lacet) * Math.cos(pr.inclinaison)]
      const vers = pr.cible.map((c, i) => c - pr.source[i])
      const n = Math.hypot(...vers)
      expect(avant.reduce((s, a, i) => s + a * (vers[i] / n), 0)).toBeCloseTo(1, 6)
    }
  })
})

describe('rails', () => {
  it('porte chaque projecteur sur un rail', () => {
    const r = rails(MUSEE, accrochage)
    for (const pr of projecteurs(MUSEE, accrochage)) {
      const sous = r.some((b) => Math.abs(b.x - pr.x) <= b.w / 2 + 1e-6 && Math.abs(b.z - pr.z) <= b.d / 2 + 1e-6 && Math.abs(b.y + b.h / 2 - pr.y) < 1e-6)
      expect(sous, pr.key).toBe(true)
    }
  })
})
