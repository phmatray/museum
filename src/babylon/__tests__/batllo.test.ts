import { AssetContainer } from '@babylonjs/core/assetContainer'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it, vi } from 'vitest'

const charger = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('../glb.ts', async (orig) => ({ ...(await orig<typeof import('../glb.ts')>()), chargerGlb: charger.fn }))

import { monterBatllo } from '../batllo'

/** Un faux GLB : trois pièces de chêne (opaque), un verre et une cive (BLEND). */
function fauxGlb(scene: Scene): AssetContainer {
  const c = new AssetContainer(scene)
  const chene = new PBRMaterial('Batllo_Chene', scene)
  const [verre, cive] = ['Batllo_Verre', 'Batllo_Cive_Bleu'].map((n) => {
    const m = new PBRMaterial(n, scene)
    m.alpha = 0.25
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND
    return m
  })
  for (const [i, mat] of [chene, chene, chene, verre, cive].entries()) {
    const m = CreateBox(`p${i}`, {}, scene)
    m.material = mat
    scene.removeMesh(m)
    c.meshes.push(m)
  }
  c.materials.push(chene, verre, cive)
  return c
}

describe('monterBatllo', () => {
  it('fusionne par matière, laisse voir à travers les verres, et seul le chêne porte l’ombre', async () => {
    const scene = new Scene(new NullEngine())
    charger.fn.mockResolvedValueOnce(fauxGlb(scene))
    const porteurs: string[] = []
    const generateur = { addShadowCaster: (m: { material: { name: string } }) => porteurs.push(m.material.name), getShadowMap: () => null }
    await monterBatllo(scene, generateur as never)

    const vivants = scene.meshes.filter((m) => !m.isDisposed() && m.getTotalVertices() > 0)
    expect(vivants.map((m) => m.material!.name).sort()).toEqual(['Batllo_Chene', 'Batllo_Cive_Bleu', 'Batllo_Verre'])
    expect(vivants.every((m) => m.receiveShadows)).toBe(true)
    expect(porteurs).toEqual(['Batllo_Chene'])
    const mat = (n: string) => scene.getMaterialByName(n) as PBRMaterial
    expect(mat('Batllo_Verre').disableDepthWrite).toBe(true)
    expect(mat('Batllo_Cive_Bleu').disableDepthWrite).toBe(true)
    expect(mat('Batllo_Chene').disableDepthWrite).toBe(false)
    expect(mat('Batllo_Chene').pluginManager?.getPlugin('Lueurs')).toBeTruthy()
    expect(mat('Batllo_Verre').pluginManager?.getPlugin('Lueurs')).toBeFalsy()
  })
})
