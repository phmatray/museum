import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { UnregisterMaterialPlugin } from '@babylonjs/core/Materials/materialPluginManager'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it } from 'vitest'

import { codeBrume, enregistrerBrume, semis, sourcesChute, sourcesEtang } from '../meteo'

describe('semis', () => {
  it('Park-Miller, le même à chaque chargement, dans ]0, 1[', () => {
    const a = semis(1000, 7)
    expect(a[0]).toBeCloseTo((7 * 16807 - 1) / 2147483646, 9)
    expect(semis(1000, 7)).toEqual(a)
    expect(Math.min(...a)).toBeGreaterThan(0)
    expect(Math.max(...a)).toBeLessThan(1)
  })
})

describe('sources', () => {
  it('WGSL sans un mot de GLSL, GLSL sans WGSL', () => {
    for (const neige of [false, true]) {
      const w = JSON.stringify([sourcesChute(neige, true), sourcesEtang(true), codeBrume(true)])
      expect(w).not.toMatch(/\bfloat |\bvec[234]\(|\bmod\(|gl_/)
      expect(w).toContain('uniforms.viewProjection')
      const g = JSON.stringify([sourcesChute(neige, false), sourcesEtang(false), codeBrume(false)])
      expect(g).not.toMatch(/uniforms\.|vertexInputs|vec[234]f\(/)
    }
    // Pas d'attribut dans un fragment.
    expect(sourcesChute(true, false).fragment).not.toMatch(/attribute|instancesDeclaration/)
    expect(sourcesChute(true, true).vertex).toContain('droite')
    expect(sourcesChute(false, true).vertex).toContain('cross(dir')
  })
})

describe('enregistrerBrume', () => {
  it('ne greffe que les PBR', () => {
    enregistrerBrume()
    const scene = new Scene(new NullEngine())
    expect(new PBRMaterial('p', scene).pluginManager?.getPlugin('Brume')).toBeTruthy()
    expect(new StandardMaterial('s', scene).pluginManager?.getPlugin('Brume') ?? null).toBeNull()
    UnregisterMaterialPlugin('Brume')
  })
})
