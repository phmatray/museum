/**
 * La baie de la salle d'honneur à la manière de la Casa Batlló : colonnes en
 * os, arcs souples, chêne ondulé et bandeau de cives (`assets/architecture/
 * batllo.glb`, BatlloLayer.tsx de three).
 *
 * Modélisée dans le repère du plan, posée telle quelle. Draco, sans texture ni
 * couche « Lumiere » : éclairage direct seul, pas de lumière cuite. Un appel par
 * matière (27 → 10). Les cinq cives restent cinq matières : three les unit par
 * couleur de sommet (émissif = 0,7 × base des deux côtés), Babylon ne multiplie
 * pas l'émissif par la couleur de sommet ; ponytail : 4 appels de plus, un
 * plugin si le budget l'exige. La boîte de verre que `meshLevel` pose dans la
 * baie est retirée par `sansBaieBatllo` (boites.ts).
 */
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import type { Scene } from '@babylonjs/core/scene'

import { chargerGlb, fusionnerParMatiere } from './glb.ts'
import { brancherLueurs } from './lueurs.ts'

export async function monterBatllo(scene: Scene, generateur: ShadowGenerator | null): Promise<void> {
  const c = await chargerGlb(scene, 'assets/architecture/batllo.glb')
  c.addAllToScene()
  const opaques = new Set<string>()
  for (const m of c.materials) {
    if (!(m instanceof PBRMaterial)) continue
    if (m.needAlphaBlending()) {
      // Les vitres ne masquent rien : les cives se voient à travers le verre clair.
      m.disableDepthWrite = true
      m.useRadianceOverAlpha = m.useSpecularOverAlpha = false
    } else {
      opaques.add(m.name)
      brancherLueurs([m])
    }
  }
  // Chêne, pierre et plomb portent l'ombre ; verres et cives la reçoivent seulement.
  for (const m of fusionnerParMatiere(c.meshes)) {
    m.receiveShadows = true
    if (opaques.has(m.material?.name ?? '')) generateur?.addShadowCaster(m)
  }
  generateur?.getShadowMap()?.resetRefreshCounter()
}
