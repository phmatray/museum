import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it } from 'vitest'

import { brancherLueurs, codeDesLueurs, lueursDuJour, reglerLueurs } from '../lueurs'

describe('lueursDuJour', () => {
  it('éteint la nef et la façade en plein jour, garde les spots à 60 %', () => {
    const j = lueursDuJour(1)
    expect(j.nef).toEqual([0, 0, 0])
    expect(j.facade).toBe(0)
    expect(j.spots).toBeCloseTo(6, 6)
  })

  it('allume tout la nuit, la nef en #ffc27a linéaire × 0,5', () => {
    const n = lueursDuJour(0)
    expect(n.facade).toBe(5)
    expect(n.spots).toBe(10)
    expect(n.nef[0]).toBeCloseTo(0.5, 3)
    expect(n.nef[2]).toBeLessThan(n.nef[1])
  })
})

describe('codeDesLueurs', () => {
  it('écrit un WGSL sans reste de GLSL', () => {
    const w = Object.values(codeDesLueurs(true)).join('\n')
    expect(w).not.toMatch(/\bvec[23]\(|\bfloat |\bconst vec3|\bint i\b|uniform /)
    expect(w).toContain('uniforms.lueursHemi')
  })

  it('équilibre accolades, parenthèses et directives dans les deux langues, et divise par l’hémisphérique', () => {
    for (const wgsl of [false, true]) {
      for (const s of Object.values(codeDesLueurs(wgsl))) {
        expect(s.split('{').length).toBe(s.split('}').length)
        expect(s.split('(').length).toBe(s.split(')').length)
        expect(s.match(/#if/g)?.length ?? 0).toBe(s.match(/#endif/g)?.length ?? 0)
      }
      expect(codeDesLueurs(wgsl).CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION).toMatch(/lueur \*= lightmapColor\.g \//)
    }
  })
})

describe('reglerLueurs', () => {
  it('lie le vert de l’hémisphérique sur un côté, un dessus et un dessous', () => {
    const scene = new Scene(new NullEngine())
    const hemi = new HemisphericLight('h', new Vector3(0, 1, 0), scene)
    hemi.diffuse = new Color3(0.2, 0.4, 0.6)
    hemi.groundColor = new Color3(0, 0.1, 0)
    hemi.intensity = 2
    reglerLueurs(0, hemi)
    const m = new PBRMaterial('m', scene)
    brancherLueurs([m])
    const lu: Record<string, number[]> = {}
    const ubo = {
      updateFloat3: (n: string, ...v: number[]) => (lu[n] = v),
    } as unknown as UniformBuffer
    m.pluginManager!.getPlugin('Lueurs')!.bindForSubMesh(ubo, scene, scene.getEngine(), null as never)
    expect(lu.lueursHemi.map((v) => +v.toFixed(6))).toEqual([0.5, 0.8, 0.2])
    expect(lu.lueursLampes.map((v) => +v.toFixed(6))).toEqual([5, 10, +(0.8 / 1.1).toFixed(6)])
    expect(lu.lueursCiel.map((v) => +v.toFixed(6))).toEqual([0.4, 0.8, 1.2])
    scene.getEngine().dispose()
  })
})
