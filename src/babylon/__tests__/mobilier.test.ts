import { describe, expect, it } from 'vitest'

import { codeDuChene, forceDuGlobe } from '../mobilier'

describe('forceDuGlobe', () => {
  it('vaut 1,5 × la force des lampadaires la nuit, éteint le jour', () => {
    expect(forceDuGlobe(0)).toBeCloseTo(7.5)
    expect(forceDuGlobe(1)).toBe(0)
  })
})

describe('codeDuChene', () => {
  it('écrit un WGSL sans reste de GLSL', () => {
    const w = codeDuChene(true)
    const tout = [...Object.values(w.fragment), ...Object.values(w.vertex)].join('\n')
    expect(tout).not.toMatch(/\bvec[234]\(|dFd[xy]|textureGrad|sampler2D|\bfloat\b/)
    expect(tout).toContain('textureSampleGrad(chenGrain, chenGrainSampler')
  })

  it('lit position et normale en espace objet, et le fil en linéaire', () => {
    for (const wgsl of [false, true]) {
      const c = codeDuChene(wgsl)
      expect(c.vertex.CUSTOM_VERTEX_MAIN_END).toMatch(/vBoisPos = positionUpdated;[\s\S]*vBoisNrm = normalUpdated;/)
      expect(c.fragment.CUSTOM_FRAGMENT_DEFINITIONS).toMatch(/toLinearSpace/)
      expect(c.fragment.CUSTOM_FRAGMENT_UPDATE_ALPHA).toContain('surfaceAlbedo *= pow(boisG, 1.4);')
    }
  })
})
