import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it } from 'vitest'

import { dialecte, greffer } from '../greffe'

describe('greffer', () => {
  it('pose un plugin à define propre, déclare ses uniforms GLSL, rend le code de chaque langue', () => {
    const m = new PBRMaterial('m', new Scene(new NullEngine()))
    let lie = 0
    const p = greffer(m, {
      nom: 'Essai',
      attributs: ['aBrin'],
      uniforms: [{ name: 'essaiT', size: 1, type: 'float' }, { name: 'essaiF', size: 4, type: 'vec4', arraySize: 4 }],
      lier: () => lie++,
      code: (wgsl) => ({ fragment: { CUSTOM_FRAGMENT_UPDATE_ALPHA: wgsl ? 'w' : 'g' } }),
    })
    expect(greffer(m, { nom: 'Essai', code: () => ({}) })).toBe(p)
    expect(p.getClassName()).toBe('Essai')
    const a: string[] = []
    p.getAttributes(a, m.getScene(), null!)
    expect(a).toEqual(['aBrin'])
    expect(p.getUniforms(ShaderLanguage.GLSL).fragment).toBe('uniform float essaiT;\nuniform vec4 essaiF[4];')
    expect(p.getUniforms(ShaderLanguage.WGSL).fragment).toBe('')
    expect(p.getCustomCode('fragment', ShaderLanguage.WGSL)).toEqual({ CUSTOM_FRAGMENT_UPDATE_ALPHA: 'w' })
    expect(p.getCustomCode('fragment', ShaderLanguage.GLSL)).toEqual({ CUSTOM_FRAGMENT_UPDATE_ALPHA: 'g' })
    expect(p.getCustomCode('vertex', ShaderLanguage.GLSL)).toBeNull()
    p.bindForSubMesh(null!, m.getScene(), m.getScene().getEngine(), null!)
    expect(lie).toBe(1)
  })
})

describe('dialecte', () => {
  it('écrit le même corps en GLSL et en WGSL', () => {
    const [g, w] = [dialecte(false), dialecte(true)]
    expect(g.V('a', 'vec3', g.tr('vec3(1.0)'))).toBe('vec3 a = vec3(1.0);')
    expect(w.V('a', 'vec3', w.tr('vec3(1.0)'))).toBe('var a: vec3f = vec3f(1.0);')
    expect(w.G('h', 'float')).toBe('var<private> h: f32;')
    expect(w.attribut('aBrin', 'vec4')).toBe('attribute aBrin: vec4f;')
    expect([w.vin('aBrin'), w.vout('vT'), w.fin('vT'), w.u('t')]).toEqual(['vertexInputs.aBrin', 'vertexOutputs.vT', 'fragmentInputs.vT', 'uniforms.t'])
    expect(g.fn('f', [['x', 'float']], 'float', 'return x;')).toBe('float f(float x) {return x;\n}')
    expect(w.fn('f', [['x', 'float']], 'float', 'return x;')).toBe('fn f(x: f32) -> f32 {return x;\n}')
  })
})
