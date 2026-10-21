import { AssetContainer } from '@babylonjs/core/assetContainer'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it, vi } from 'vitest'

const charger = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('../glb.ts', async (orig) => ({ ...(await orig<typeof import('../glb.ts')>()), chargerGlb: charger.fn }))

import { monterEscalier } from '../escalier'

/** Un faux GLB : 2 nœuds × 2 primitives, une matière par primitive, uv + uv2 comme l'export Blender. */
function fauxGlb(scene: Scene): AssetContainer {
  const c = new AssetContainer(scene)
  const marbre = new PBRMaterial('Escalier_Marbre', scene)
  const griotte = new PBRMaterial('Escalier_Griotte', scene)
  for (const [i, mat] of [marbre, griotte, marbre, griotte].entries()) {
    const m = CreateBox(`p${i}`, {}, scene)
    m.setVerticesData(VertexBuffer.UV2Kind, m.getVerticesData(VertexBuffer.UVKind)!)
    m.material = mat
    scene.removeMesh(m)
    c.meshes.push(m)
  }
  c.materials.push(marbre, griotte)
  return c
}

describe('monterEscalier', () => {
  const scene = new Scene(new NullEngine())

  it('pose le GLB en 2 maillages éclairés par l’atlas et retire les marches en boîtes', async () => {
    charger.fn.mockResolvedValueOnce(fauxGlb(scene))
    const atlas = new RawTexture(new Uint8Array(4), 1, 1, 5, scene)
    const marches = CreateBox('marches', {}, scene)
    await monterEscalier(scene, Promise.resolve(atlas), null, marches)
    expect(marches.isDisposed()).toBe(true)
    const poses = scene.meshes.filter((m) => m.material?.name.startsWith('Escalier_')) as Mesh[]
    expect(poses).toHaveLength(2)
    for (const m of poses) expect((m.material as PBRMaterial).lightmapTexture).toBe(atlas)
    // L'uv2 ramenée dans la région de l'escalier (x 2→1026 texels sur 4096).
    const uv2 = poses[0].getVerticesData(VertexBuffer.UV2Kind)!
    expect(Math.max(...uv2.filter((_, i) => i % 2 === 0))).toBeLessThanOrEqual(1026 / 4096 + 1e-6)
  })

  it('garde les marches si le GLB manque', async () => {
    charger.fn.mockRejectedValueOnce(new Error('404'))
    const marches = CreateBox('marches2', {}, scene)
    await expect(monterEscalier(scene, Promise.reject(new Error('atlas')), null, marches)).rejects.toThrow('404')
    expect(marches.isDisposed()).toBe(false)
  })
})
