import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it, vi } from 'vitest'

import { monterCloche, sonneur } from '../cloche'

const midi = (h: number, m = 0) => new Date(2026, 9, 20, h, m)

describe('sonneur', () => {
  it('se tait au chargement, puis frappe les heures pleines', () => {
    const s = sonneur()
    expect(s.avancer(0, midi(15))).toEqual({ marteau: 0, cloche: 0, annonce: null })
    s.avancer(1, midi(15, 59))
    s.avancer(2, midi(16))
    // Quatre coups à 2, 3,6, 5,2, 6,8 s : le marteau se lève 0,2 s après chacun.
    for (const t of [2.2, 3.8, 5.4, 7]) expect(s.avancer(t, midi(16)).marteau).toBeLessThan(0)
    expect(s.avancer(9, midi(16)).marteau).toBeCloseTo(0, 5)
  })

  it('publie chaque annonce une seule fois, à l’impact', () => {
    const s = sonneur()
    s.annoncer([{ key: 'a/b', tag: 'v1' }, { key: 'a/c', tag: 'v2' }], 10)
    expect(s.avancer(11.5, midi(15)).annonce).toBeNull()
    expect(s.avancer(11.65, midi(15)).annonce).toEqual({ key: 'a/b', tag: 'v1' })
    expect(s.avancer(11.7, midi(15)).annonce).toBeNull()
    expect(s.avancer(14.05, midi(15)).annonce).toEqual({ key: 'a/c', tag: 'v2' })
  })
})

describe('monterCloche', () => {
  it('rend le fer, accroche cloche et marteau à leurs pivots', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('hors ligne')))
    const scene = new Scene(new NullEngine())
    const porteurs = await monterCloche(scene, '/')
    expect(porteurs.map((m) => m.name)).toEqual(['cloche:fer'])
    expect(scene.meshes.map((m) => m.name).sort()).toEqual(['cloche:cloche', 'cloche:fer', 'cloche:marteau'])
    const cloche = scene.getMeshByName('cloche:cloche')!
    expect(cloche.parent?.name).toBe('cloche:pivot-cloche')
    // Le bas de la pince, au repos : 16,75 + 2,2 × (0,52 − 0,06 − 0,42).
    cloche.computeWorldMatrix(true)
    expect(cloche.getBoundingInfo().boundingBox.minimumWorld.y).toBeCloseTo(16.75 + 2.2 * 0.04, 2)
    vi.unstubAllGlobals()
  })
})
