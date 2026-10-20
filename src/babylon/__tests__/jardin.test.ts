import { Color3 } from '@babylonjs/core/Maths/math.color'
import { describe, expect, it } from 'vitest'

import { rubanDuRuisseau } from '../../plan/jardin'
import { remous } from '../../plan/ruisseau'
import { carteDeFilets, carteDeVaguelettes, codeDeLaCascade, codeDeLEtang, codeDesCaustiques, codeDuRuisseau, couleursDeBerge, geometrie, uvBoite, uvDuPlan } from '../jardin'
import { lin } from '../lueurs'

describe('jardin', () => {
  it('projette les UV de boîte sur le plan qui fait face à la normale, en mètres', () => {
    const p = [1, 2, 3, 1, 2, 3, 1, 2, 3]
    const n = [0, 1, 0, 1, 0, 0, 0, 0.2, -1]
    expect([...uvBoite(p, n)]).toEqual([1, 3, 3, 2, 1, 2])
    expect([...uvBoite(p, n, 2)]).toEqual([0.5, 1.5, 1.5, 1, 0.5, 1])
    expect([...uvDuPlan([3, 9, 6], false)]).toEqual([3, 6])
    expect([...uvDuPlan([3, 9, 6], true)]).toEqual([1, 2])
  })

  it('assombrit la berge en descendant : blanc en haut, le lit au fond', () => {
    const c = couleursDeBerge([0, 0, 0, 0, -0.08, 0, 0, -1, 0])
    expect([...c.slice(0, 4)]).toEqual([1, 1, 1, 1])
    const lit = lin('#5e5644')
    expect(c[8]).toBeCloseTo(lit.r, 5)
    expect(c[9]).toBeCloseTo(lit.g, 5)
    expect(c[11]).toBe(1)
    expect(c[4]).toBeLessThan(1)
    expect(c[4]).toBeGreaterThan(lit.r)
  })

  it('tisse des cartes sans raccord', () => {
    const n = 32
    const v = carteDeVaguelettes(n)
    expect(v.length).toBe(n * n * 4)
    // Fréquences entières : la colonne 0 prolonge la colonne n−1 comme ses voisines.
    const px = (x: number, y: number) => v[(y * n + x) * 4]
    expect(Math.abs(px(0, 5) - px(n - 1, 5))).toBeLessThan(40)
    expect(v[3]).toBe(255)
    const filets = carteDeFilets(16)
    expect(filets[0]).toBe(filets[3])
  })

  it('pose le ruban du ruisseau face au ciel (winding inversé pour Babylon)', () => {
    const r = rubanDuRuisseau()
    const g = geometrie(r.position, r.uv, r.index)
    const ny = (g.normals as number[]).filter((_, i) => i % 3 === 1)
    expect(Math.min(...ny)).toBeGreaterThan(0.9)
  })

  it('écrit les greffes en GLSL et en WGSL', () => {
    const ciel = new Color3(0.1, 0.2, 0.3)
    const codes = (w: boolean) => [codeDeLEtang(w, ciel), codeDeLaCascade(w), codeDuRuisseau(w, remous(), ciel), codeDesCaustiques(w)]
    for (const c of codes(true)) {
      const s = JSON.stringify(c)
      expect(s).not.toMatch(/\bvec[234]\(/)
      expect(s).not.toMatch(/\bfloat\b/)
    }
    for (const c of codes(false)) expect(JSON.stringify(c)).not.toMatch(/uniforms\.|vec[234]f\(/)
    expect(codeDuRuisseau(true, remous(), ciel).fragment.CUSTOM_FRAGMENT_DEFINITIONS).toContain(`array<vec4f, ${remous().length}>`)
  })
})
