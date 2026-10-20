import { describe, expect, it } from 'vitest'

import { CLAIR, meteoDemandee } from '../../domain/meteo'
import { lin } from '../lueurs'
import { codeFilets, codeIntemperies, codeRonds, enWgsl, lisserMeteo, lueurEclair, METEO, toits } from '../intemperies'

const etat = () => ({ ...METEO, brumeCouleur: METEO.brumeCouleur.clone() })
const jour = { jour: 1, crepuscule: 0 }

describe('lisserMeteo', () => {
  it('le sol se mouille vite et sèche lentement', () => {
    const e = etat()
    const pluie = meteoDemandee('?meteo=pluie')!
    for (let i = 0; i < 100; i++) lisserMeteo(e, pluie, jour, 0.1)
    const mouille = e.mouille
    expect(mouille).toBeGreaterThan(0.5)
    for (let i = 0; i < 100; i++) lisserMeteo(e, CLAIR, jour, 0.1)
    expect(e.mouille).toBeGreaterThan(mouille * 0.85)
    expect(e.pluie).toBeLessThan(0.01)
  })

  it('pas de brume par beau temps, la couleur de la nuit la nuit', () => {
    const e = etat()
    lisserMeteo(e, CLAIR, { jour: 0, crepuscule: 0 }, 0.016)
    expect(e.densite).toBe(0)
    expect(e.brumeCouleur.b).toBeCloseTo(lin('#161c28').b, 5)
  })
})

describe('lueurEclair', () => {
  it('double flash puis rien', () => {
    expect(lueurEclair(0)).toBe(1)
    expect(lueurEclair(0.25)).toBeGreaterThan(0.5)
    expect(lueurEclair(0.6)).toBe(0)
  })
})

describe('code des greffes', () => {
  it('toits en WGSL : plus un mot de GLSL', () => {
    const w = toits(true, 'brumeToit')
    expect(w).toContain('fn brumeToit(xz: vec2f) -> f32 {')
    expect(w).not.toMatch(/\bfloat\b|\bvec2 /)
    expect(w.match(/if \(/g)!.length).toBe(w.match(/\{ return/g)!.length)
    expect(enWgsl('float a(vec2 xz) {\n  float b = 1.0;\n  if (b > 0.0)\n    return b;\n  return 0.0;\n}')).toBe('fn a(xz: vec2f) -> f32 {\n  var b: f32 = 1.0;\n  if (b > 0.0) { return b; }\n  return 0.0;\n}')
  })

  it('les variantes, dans les deux langues', () => {
    for (const wgsl of [false, true]) {
      const f = codeIntemperies(wgsl, { flaques: true }).fragment
      expect(f.CUSTOM_FRAGMENT_UPDATE_ALPHA).toContain('iFlaque')
      expect(f.CUSTOM_FRAGMENT_BEFORE_FOG).toContain(wgsl ? 'uniforms.intC' : 'intC')
      expect(codeIntemperies(wgsl, { pelouse: true }).fragment.CUSTOM_FRAGMENT_BEFORE_FOG).toBeUndefined()
      expect(codeRonds(wgsl).fragment.CUSTOM_FRAGMENT_DEFINITIONS).toContain('rideRonds')
      expect(codeFilets(wgsl).fragment.CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION).toContain('finalEmissive')
      const tout = JSON.stringify([codeIntemperies(wgsl, { flaques: true, pelouse: true }), codeFilets(wgsl)])
      if (wgsl) expect(tout).not.toMatch(/\bvec[234]\(|\bfloat /)
    }
  })
})
