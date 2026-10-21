/**
 * L'escalier impérial en marbre (EscalierLayer.tsx) : marches crème, limons de
 * griotte, palier poli (`assets/architecture/escalier.glb`, Draco + KTX2,
 * `tools/blender/build-escalier.py`). Modélisé dans le repère du plan : il se
 * pose tel quel, avec la lumière du hall cuite dans sa région de l'atlas.
 *
 * Il ne remplace les marches en boîtes (`marches` de boites.ts : marches,
 * palier, paillasses) qu'une fois là : si le fichier manque, elles restent.
 * Les garde-corps de verre ne sont pas dans le fichier, les boîtes les gardent.
 */
import type { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import type { Scene } from '@babylonjs/core/scene'

import { chargerGlb, eclairerModele, fusionnerParMatiere } from './glb.ts'
import { brancherLueurs } from './lueurs.ts'

export async function monterEscalier(scene: Scene, atlas: Promise<RawTexture>, generateur: ShadowGenerator | null, marches: Mesh): Promise<void> {
  // L'atlas attendu AVANT la pose : pas d'escalier en pleine ambiance qui s'assombrit ensuite.
  const [c, lumiere] = await Promise.all([chargerGlb(scene, 'assets/architecture/escalier.glb'), atlas.catch(() => null)])
  c.addAllToScene()
  eclairerModele(c.meshes, 'escalier', lumiere)
  const maillages = fusionnerParMatiere(c.meshes)
  for (const m of maillages) {
    m.receiveShadows = true
    generateur?.addShadowCaster(m)
  }
  brancherLueurs(maillages.flatMap((m) => (m.material ? [m.material] : [])))
  marches.dispose()
  generateur?.getShadowMap()?.resetRefreshCounter()
}
