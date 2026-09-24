/**
 * Pin `centrer()` (props/parc) contre les VRAIS GLB vendus (#51).
 *
 * #44 a corrigé un bug où les plantes flottaient à côté de leur jardinière et
 * où les arbustes du parc débordaient sur les allées : les pivots livrés par
 * Poly Haven ne sont pas centrés sur leur sujet. Rien ne pinçait ce fichier
 * (`museum-kit.glb`, `plants-lod.glb`) contre `centrer()` : un futur ré-export
 * avec un pivot décalé ne se verrait qu'à l'œil, sur le site publié.
 *
 * Harnais de chargement Draco/GLTF partagé avec `parkAssets.test.ts` (#58) —
 * voir `glbTestHarness.ts` pour le détail des deux contournements (Worker
 * Draco, royaume `ArrayBuffer`).
 */
import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'

import { centrer } from '../propAssets'
import { centreXZ, chargerGLTF, fusionnerPositions, geometriesMonde, installerDecodeurDraco } from './glbTestHarness'

beforeAll(installerDecodeurDraco)

// ── Tests ──────────────────────────────────────────────────────────────────

describe('centrer() sur les GLB réels (#51)', () => {
  it('recentre la jardinière de museum-kit.glb sur X/Z (lot à une pièce)', async () => {
    const gltf = await chargerGLTF('public/assets/props/museum-kit.glb')
    const jardiniere = gltf.scene.getObjectByName('Jardiniere')
    expect(jardiniere).toBeDefined()

    const geometries = geometriesMonde(jardiniere!)
    expect(geometries.length).toBeGreaterThan(0)

    const lots = [{ geometry: fusionnerPositions(geometries) }]
    centrer(lots)

    const centre = centreXZ(lots)
    expect(Math.abs(centre.x)).toBeLessThan(1e-4)
    expect(Math.abs(centre.z)).toBeLessThan(1e-4)
  })

  it('recentre une plante multi-nœuds de plants-lod.glb sur X/Z, sans toucher à Y', async () => {
    const gltf = await chargerGLTF('public/assets/plants/plants-lod.glb')
    const feuilles = gltf.scene.getObjectByName('potted_plant_02_leaves')
    const pot = gltf.scene.getObjectByName('potted_plant_02_pot')
    expect(feuilles).toBeDefined()
    expect(pot).toBeDefined()

    const geometries = [...geometriesMonde(feuilles!), ...geometriesMonde(pot!)]
    expect(geometries.length).toBeGreaterThanOrEqual(2)

    const avant = new THREE.Box3()
    for (const g of geometries) {
      g.computeBoundingBox()
      avant.union(g.boundingBox!)
    }
    const yMinAvant = avant.min.y
    const yMaxAvant = avant.max.y

    const lots = geometries.map((geometry) => ({ geometry }))
    centrer(lots)

    const centre = centreXZ(lots)
    expect(Math.abs(centre.x)).toBeLessThan(1e-4)
    expect(Math.abs(centre.z)).toBeLessThan(1e-4)

    const apres = new THREE.Box3()
    for (const g of geometries) {
      g.computeBoundingBox()
      apres.union(g.boundingBox!)
    }
    expect(apres.min.y).toBe(yMinAvant)
    expect(apres.max.y).toBe(yMaxAvant)
  })
})
