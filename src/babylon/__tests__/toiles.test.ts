import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { Accrochage } from '../../plan/hang'
import { couper, halo, posesProches, poserToiles, uvDeTuile } from '../toiles'

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

describe('halo', () => {
  it('rend le spot de three après l’élévation à 2,2 du Standard', () => {
    expect(halo(0.5, 0.62) ** 2.2).toBeCloseTo(1.06)
    expect(halo(0, 0) ** 2.2).toBeCloseTo(0.72 + 0.34 * Math.exp(-3 * (0.25 + 0.3844)))
  })
})

describe('posesProches', () => {
  const oeil = { x: 0, y: 1.6, z: 0 }
  const pose = (id: string, x: number, y = 1.55) => ({ id, centre: [x, y, 0] as [number, number, number] })

  it('entre sous 8 m, sur le même niveau seulement, six au plus, triées', () => {
    const poses = [pose('h', 7), pose('a', 1), pose('b', 2), pose('c', 3), pose('d', 4), pose('e', 5), pose('f', 6), pose('loin', 9), pose('etage', 0, 6.35)]
    expect(posesProches(poses, oeil, [])).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('garde une toile jusqu’à 11 m, et ne la cède qu’à une toile plus proche de 3 m', () => {
    expect(posesProches([pose('a', 10)], oeil, ['a'])).toEqual(['a'])
    expect(posesProches([pose('a', 11.5)], oeil, ['a'])).toEqual([])
    const six = ['a', 'b', 'c', 'd', 'e', 'f']
    const poses = [...six.map((id) => pose(id, 7.5)), pose('g', 5)]
    expect(posesProches(poses, oeil, six)).toEqual(six)
    expect(posesProches([...poses.slice(0, 6), pose('g', 4)], oeil, six)).toEqual(['b', 'c', 'd', 'e', 'f', 'g'])
  })
})

describe('couper', () => {
  // Un caractère = 1 px.
  const g = { measureText: (t: string) => ({ width: t.length }) as TextMetrics }
  it('coupe au mot près, et au-delà de max lignes finit la dernière par « … » qui tient', () => {
    expect(couper(g, 'un deux trois quatre', 9)).toEqual(['un deux', 'trois', 'quatre'])
    expect(couper(g, 'un deux, trois quatre cinq', 9, 1)).toEqual(['un deux…'])
    expect(couper(g, 'abc def ghi', 7, 2)).toEqual(['abc def', 'ghi'])
  })
})
