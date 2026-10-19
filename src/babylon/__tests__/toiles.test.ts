import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { Accrochage } from '../../plan/hang'
import { poserToiles, uvDeTuile } from '../toiles'

const accrochage = JSON.parse(readFileSync('public/data/accrochage.json', 'utf8')) as Accrochage

describe('poserToiles', () => {
  const poses = poserToiles(accrochage)

  it('pose toutes les toiles de l’accrochage', () => {
    expect(poses).toHaveLength(accrochage.rooms.reduce((n, r) => n + r.placements.length, 0))
  })

  it('pose AspireStrapi devant le mur ouest, la droite du visiteur vers −z', () => {
    const p = poses.find((q) => q.cle === 'phmatray/AspireStrapi')!
    const [bg, bd, hd, hg] = p.coins
    for (const c of p.coins) expect(c[0]).toBeCloseTo(0.204)
    expect(bg[2]).toBeCloseTo(33.5 + 1.3085)
    expect(bd[2]).toBeCloseTo(33.5 - 1.3085)
    expect(hd[1] - bd[1]).toBeCloseTo(2.617 / 2)
    expect(hg[2]).toBeCloseTo(bg[2])
    // Cadre : largeur w + 0,12 le long de −z, profondeur le long de +x, centré à 2,5 cm du mur.
    expect([...p.cadre.slice(0, 3)].map((v) => +v.toFixed(4))).toEqual([0, 0, -2.737])
    expect(p.cadre[8]).toBeCloseTo(0.05)
    expect(p.cadre[12]).toBeCloseTo(0.175)
  })
})

describe('uvDeTuile', () => {
  it('lit la grille ligne 0 en haut', () => {
    expect(uvDeTuile(0)).toEqual([0, 15 / 16, 1 / 16, 1])
    expect(uvDeTuile(17)).toEqual([1 / 16, 14 / 16, 2 / 16, 15 / 16])
  })
})
