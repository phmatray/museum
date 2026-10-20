import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector'
import { describe, expect, it } from 'vitest'

import { GALETS_DU_RUISSEAU } from '../../plan/ruisseau'
import { attributsDesGalets, codeDeLaSouche, codeDuGalet, matriceDeLaBranche } from '../ruisseau'

describe('ruisseau', () => {
  it('donne à chaque galet sa teinte, sa cote d’eau, sa mousse et son basalte, dans l’ordre de son modèle', () => {
    const effectifs = [0, 1, 2, 3, 4, 5, 6].map((k) => attributsDesGalets(k).length / 4)
    expect(effectifs.reduce((a, b) => a + b)).toBe(GALETS_DU_RUISSEAU.length)
    const s = GALETS_DU_RUISSEAU.filter((g) => g.modele === 4)
    const a = attributsDesGalets(4)
    expect(a[0]).toBeCloseTo(s[0].teinte)
    expect(a[1]).toBeCloseTo(s[0].etang ? -0.3 : -0.2)
    expect(a[2]).toBe((s[0].teinte * 7.31) % 1 < 0.35 ? 1 : 0)
    expect(a[3]).toBe(1)
    expect(attributsDesGalets(0)[3]).toBe(0)
  })

  it('couche la branche de son pied à sa tête', () => {
    const m = Matrix.FromArray(matriceDeLaBranche())
    const [p, q] = [new Vector3(0, 0, 0), new Vector3(3, 0, 0)].map((v) => Vector3.TransformCoordinates(v, m))
    expect([p.x, p.y, p.z].map((x) => +x.toFixed(4))).toEqual([71.5, 0.14, 46.3])
    expect([q.x, q.y, q.z].map((x) => +x.toFixed(4))).toEqual([69.3, -0.3, 48.1])
  })

  it('écrit les greffes en GLSL et en WGSL sans mot de l’autre langue', () => {
    for (const code of [codeDuGalet, codeDeLaSouche]) {
      const w = JSON.stringify(code(true))
      const g = JSON.stringify(code(false))
      expect(w).not.toMatch(/\bvec[34]\(|\bfloat\b/)
      expect(g).not.toMatch(/vec[34]f|fragmentInputs|var /)
      expect(w).toContain('fragmentInputs.vPositionW')
    }
    expect(Object.keys(codeDuGalet(true).fragment)[2]).toContain('reflectivityOut')
  })
})
