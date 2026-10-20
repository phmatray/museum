import { ShaderStore } from '@babylonjs/core/Engines/shaderStore'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { describe, expect, it } from 'vitest'

import { etalonnage, MIROIR_DOUX, reserverLeMiroir, soleilEcran } from '../postTraitement'

// Une caméra main droite à l'origine qui regarde −z.
const vue = Matrix.LookAtRH(Vector3.Zero(), new Vector3(0, 0, -1), Vector3.Up()).multiply(Matrix.PerspectiveFovRH(Math.PI / 2, 1, 0.1, 1000))
const avant = new Vector3(0, 0, -1)

describe('soleilEcran', () => {
  it('au centre quand on le regarde', () => {
    const p = soleilEcran([0, 0, -1], Vector3.Zero(), avant, vue)!
    expect(p[0]).toBeCloseTo(0.5)
    expect(p[1]).toBeCloseTo(0.5)
  })

  it('en haut quand il est au-dessus du regard, rien derrière', () => {
    expect(soleilEcran([0, Math.SQRT1_2, -Math.SQRT1_2], Vector3.Zero(), avant, vue)![1]).toBeCloseTo(1)
    expect(soleilEcran([0, 0, 1], Vector3.Zero(), avant, vue)).toBeNull()
  })
})

describe('etalonnage', () => {
  it('la variante VR lit la vignette de confort et pas les rayons, en GLSL et en WGSL', () => {
    etalonnage(true)
    for (const store of [ShaderStore.ShadersStore, ShaderStore.ShadersStoreWGSL]) {
      expect(store.etalonnageVRPixelShader).toMatch(/uniform confort|uniform float confort/)
      expect(store.etalonnageVRPixelShader).not.toContain('rayons')
      expect(store.etalonnagePixelShader).toContain('rayons')
      expect(store.etalonnagePixelShader).not.toContain('confort')
    }
  })
})

describe('reserverLeMiroir', () => {
  it('seuls les sols PM_MIROIR écrivent leur réflectivité au prepass (le parquet atténué), en GLSL et en WGSL', () => {
    reserverLeMiroir()
    for (const store of [ShaderStore.IncludesShadersStore, ShaderStore.IncludesShadersStoreWGSL]) {
      const b = store.pbrBlockPrePass
      expect(b).toContain('#if !defined(UNLIT) && defined(PM_MIROIR)\n#ifdef PM_MIROIR_DOUX')
      expect(b).toContain(`(specularEnvironmentR0*${MIROIR_DOUX.toFixed(2)},${MIROIR_DOUX.toFixed(2)})`)
      expect(b).toContain('(specularEnvironmentR0*1.00,1.00)')
      // Le recousu tient une montée de Babylon : l'ancienne écriture a disparu.
      expect(b).not.toContain('(specularEnvironmentR0,microSurface)')
    }
  })

  it('le Fresnel du miroir prend son F90 dans l’alpha de la réflectivité, en GLSL et en WGSL', () => {
    expect(ShaderStore.ShadersStore.screenSpaceReflection2PixelShader).toContain('F0,vec3(reflectivity.a))')
    expect(ShaderStore.ShadersStoreWGSL.screenSpaceReflection2PixelShader).toContain('F0, vec3f(reflectivity.a))')
  })
})
