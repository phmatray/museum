import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import '../RefletsLayer'
import { LUEURS } from '../lueurs'

describe('RefletsLayer', () => {
  it("retire l'environnement du diffus : la clarté ne dépend pas de la pièce où se tient le visiteur", () => {
    // Si three renomme la ligne, le remplacement ne fait plus rien : ce test le dit.
    expect(THREE.ShaderChunk.lights_fragment_maps).not.toContain('getIBLIrradiance')
    expect(THREE.ShaderChunk.lights_fragment_maps).toContain('getIBLRadiance')
  })
  it('attache la lueur de nuit aux lieux, partagée par tous les matériaux éclairés', () => {
    expect(THREE.ShaderChunk.lights_fragment_maps).toContain('uLueurs.xyz')
    expect(THREE.ShaderLib.standard.uniforms.uLueurs.value).toBe(LUEURS)
    expect(THREE.ShaderLib.physical.uniforms.uLueurs.value).toBe(LUEURS)
    expect(THREE.UniformsUtils.clone(THREE.ShaderLib.lambert.uniforms).uLueurs.value).toBe(LUEURS)
  })
})
