/**
 * Pin `centrer()` (parc) contre le troisième GLB vendu qui l'appelle (#58).
 *
 * #51 / #57 ont pincé `centrer()` contre `museum-kit.glb` (props) et
 * `plants-lod.glb` (plantes) ; `park-lod.glb`, chargé par `lotsParMateriau`
 * (`parkAssets.ts:103`) pour chaque essence du parc, restait sans test dédié.
 * `parkAssets.ts:97-99` documente qu'un des pivots qu'il contient est
 * mesurément excentré (`shrub_01_a` « s'étend à 2,45 m d'un côté ») : la
 * même classe de bug que #44 a corrigée une première fois, et qu'aucun test
 * ne détecterait aujourd'hui sur ce fichier avant l'inspection visuelle.
 *
 * Harnais de chargement Draco/GLTF partagé avec `propAssets.test.ts` — voir
 * `glbTestHarness.ts` pour le détail des deux contournements (Worker Draco,
 * royaume `ArrayBuffer`).
 */
import { beforeAll, describe, expect, it } from 'vitest'

import { centrer } from '../propAssets'
import { centreXZ, chargerGLTF, fusionnerPositions, geometriesMonde, installerDecodeurDraco } from './glbTestHarness'

beforeAll(installerDecodeurDraco)

describe('centrer() sur park-lod.glb', () => {
  it("recentre l'arbuste shrub_01_a sur X/Z (pivot documenté comme excentré)", async () => {
    const gltf = await chargerGLTF('public/assets/plants/park-lod.glb')
    const arbuste = gltf.scene.getObjectByName('shrub_01_a')
    expect(arbuste).toBeDefined()

    const geometries = geometriesMonde(arbuste!)
    expect(geometries.length).toBeGreaterThan(0)

    const lots = [{ geometry: fusionnerPositions(geometries) }]
    centrer(lots)

    const centre = centreXZ(lots)
    expect(Math.abs(centre.x)).toBeLessThan(1e-4)
    expect(Math.abs(centre.z)).toBeLessThan(1e-4)
  })
})
