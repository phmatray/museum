import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { describe, expect, it } from 'vitest'

import { MUSEE } from '../../plan/musee'
import { sorties } from '../../plan/signaletique'
import { pointsDuCordon } from '../accessoires'
import { matrices } from '../lots'

describe('accessoires', () => {
  it('tend le cordon en parabole : crochets à 0,86 m, creux de 13 cm au milieu', () => {
    const p = pointsDuCordon({ x: 17.4, z: 0.7 }, { x: 19.6, z: 0.7 }, 4.8)
    expect(p).toHaveLength(25)
    expect(p[0].y).toBeCloseTo(5.66)
    expect(p[24].y).toBeCloseTo(5.66)
    expect(p[12].y).toBeCloseTo(5.53)
    expect(p[12].x).toBeCloseTo(18.5)
    expect(p[24].x).toBeCloseTo(19.6)
  })

  it('tourne la face d’une sortie de lacet π vers −z', () => {
    const s = sorties(MUSEE).find((t) => Math.abs(t.lacet - Math.PI) < 1e-6)!
    const m = Matrix.FromArray(matrices([{ piece: 'sortie', ...s }]).get('sortie')!)
    const n = Vector3.TransformNormal(new Vector3(0, 0, 1), m)
    expect(n.z).toBeCloseTo(-1)
    expect(Vector3.TransformCoordinates(Vector3.Zero(), m).asArray()).toEqual([s.x, s.y, s.z].map((v) => expect.closeTo(v, 5)))
  })
})
