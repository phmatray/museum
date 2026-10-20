import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { describe, expect, it } from 'vitest'

import { FACES } from '../../domain/compteur'
import { matriceDuTambour, pageA } from '../departs'

describe('départs', () => {
  it('alterne deux pages de 12 s, et montre la page −1 vingt secondes après la cloche', () => {
    expect(pageA(0, null)).toBe(0)
    expect(pageA(12000, null)).toBe(1)
    expect(pageA(24000, null)).toBe(0)
    expect(pageA(30000, 15000)).toBe(-1)
    expect(pageA(35000, 15000)).toBe(0)
  })

  it('pose le tambour 0 à gauche vu du hall, devant la planche, sa face k tournée vers le nord', () => {
    const m = matriceDuTambour(0, 3)
    expect(Vector3.TransformCoordinates(Vector3.Zero(), m).asArray()).toEqual([20.205, 1.5, 39.71].map((v) => expect.closeTo(v, 5)))
    // Le point du cylindre à u = (3 + ½)/11 (θ depuis +z) arrive devant, à z − rayon.
    const t = (3.5 / FACES) * 2 * Math.PI
    const p = Vector3.TransformCoordinates(new Vector3(0.09 * Math.sin(t), 0, 0.09 * Math.cos(t)), m)
    expect(p.asArray()).toEqual([20.205, 1.5, 39.62].map((v) => expect.closeTo(v, 5)))
    // L'axe du cylindre (y) est couché le long du mur.
    expect(Math.abs(Vector3.TransformNormal(new Vector3(0, 1, 0), m).x)).toBeCloseTo(1)
  })
})
