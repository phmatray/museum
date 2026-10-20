import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it } from 'vitest'

import { MUSEE } from '../../plan/musee'
import { faisceaux, monterRayons, poussieres, prismes } from '../rayons'

const fs = faisceaux(MUSEE)

describe('faisceaux', () => {
  it('40 panneaux de verrière bornés à la nef, puis 6 lanterneaux doux bornés à leur salle', () => {
    expect(fs).toHaveLength(46)
    expect(fs.slice(0, 40).every((f) => f.doux === 0 && f.min[1] === -0.1 && Math.abs(f.max[1] - 20.6) < 1e-9)).toBe(true)
    const l = fs[40]
    expect(l.doux).toBe(1)
    expect(l.min[1]).toBe(4.8)
    expect(l.max[1]).toBeCloseTo(l.vitre.y + 0.05)
  })
})

describe('prismes', () => {
  it('36 sommets par faisceau ; le bas tiré le long du soleil jusqu’au sol, droit sous un lanterneau', () => {
    const s = Math.SQRT1_2
    const p = prismes(fs, [s, s, 0])
    expect(p).toHaveLength(46 * 36 * 3)
    // Le 2ᵉ quad (bas) du premier prisme : son 1er sommet, coin (x0, z0), à min.y et décalé de (y − min.y) en x.
    const v = fs[0].vitre
    expect([...p.subarray(18, 21)].map((n) => +n.toFixed(4))).toEqual([+(v.x0 - (v.y + 0.1)).toFixed(4), -0.1, +v.z0.toFixed(4)])
    const l = fs[40]
    const b = 40 * 108 + 18
    expect(p[b]).toBeCloseTo(l.vitre.x0)
    expect(p[b + 1]).toBeCloseTo(4.8)
  })
})

describe('poussieres', () => {
  it('700 grains tirés toujours pareils, dans la nef', () => {
    const a = poussieres(fs[0].min, fs[0].max)
    expect(a.pos).toHaveLength(2100)
    expect(a.graine).toHaveLength(2800)
    expect(poussieres(fs[0].min, fs[0].max).pos).toEqual(a.pos)
    expect(a.pos[0]).toBeGreaterThan(16.75)
    expect(a.pos[0]).toBeLessThan(31.25)
  })
})

describe('monterRayons', () => {
  it('brume, faisceaux, poussière : alphaIndex 3, 4, 5, nef', () => {
    const scene = new Scene(new NullEngine())
    const ms = monterRayons(scene)
    expect(ms.map((m) => m.alphaIndex)).toEqual([3, 4, 5])
    expect(ms.map((m) => m.getTotalVertices())).toEqual([24, 46 * 36, 2800])
    expect(ms[0].metadata.zone).toBe('nef')
    expect(ms[1].getBoundingInfo().boundingBox.maximumWorld.y).toBeCloseTo(20.6, 0)
  })
})
