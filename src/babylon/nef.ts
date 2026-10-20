/**
 * La nef du hall, à la manière d'Orsay : voûte à caissons, verrière, horloge et
 * lanternes (`assets/architecture/nef.glb`, NefLayer.tsx de three).
 *
 * Modélisée dans le repère du plan, posée telle quelle. Draco, sans texture ni
 * UV : ni KTX2 ni lumière cuite. Un appel par matière ; les deux aiguilles,
 * pointées sur midi, restent à part et tournent quand la seconde change.
 * La lueur nocturne des lanternes sur le hall est dans lueurs.ts (reglerLueurs).
 * Le verre et les lanternes suivent l'heure (`auCiel`) ; la pluie ruisselle sur la verrière.
 */
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import type { Scene } from '@babylonjs/core/scene'

import { anglesHorloge } from '../domain/horloge.ts'
import { auCielMatiere } from './etat.ts'
import { chargerGlb, fusionnerParMatiere } from './glb.ts'
import { ruisseler } from './intemperies.ts'
import { brancherLueurs } from './lueurs.ts'

/**
 * Le cadran regarde +z : vu du hall, le sens horaire est une rotation négative
 * autour de z (même convention qu'en three, la scène étant main droite).
 */
export function tournerAiguilles(heures: TransformNode | null, minutes: TransformNode | null, d: Date): void {
  const a = anglesHorloge(d)
  if (heures) heures.rotation.z = -a.heures
  if (minutes) minutes.rotation.z = -a.minutes
}

export async function monterNef(scene: Scene, generateur: ShadowGenerator | null): Promise<void> {
  const c = await chargerGlb(scene, 'assets/architecture/nef.glb')
  c.addAllToScene()
  for (const m of c.materials) {
    if (!(m instanceof PBRMaterial)) continue
    if (m.name === 'Nef_Verre') {
      // Le verre ne masque rien derrière lui (horloge, pannes) ; la nuit il cesse de luire.
      m.disableDepthWrite = true
      m.useRadianceOverAlpha = m.useSpecularOverAlpha = false
      auCielMatiere(m, (c) => {
        m.emissiveIntensity = 0.08 + 0.47 * c.jour
        m.alpha = 0.3 + 0.25 * c.jour
      })
      ruisseler(m)
    } else {
      // Les lanternes brûlent plus fort la nuit.
      if (m.name === 'Nef_Opale') {
        auCielMatiere(m, (c) => (m.emissiveIntensity = 3 + 3 * (1 - c.jour)))
      }
      brancherLueurs([m])
    }
  }
  // Les nœuds glTF tournent par quaternion : on repasse en Euler pour régler z seul.
  const aiguilles = ['Nef_Aiguille_Heures', 'Nef_Aiguille_Minutes'].map((n) => {
    const t = c.transformNodes.find((x) => x.name === n) ?? c.meshes.find((x) => x.name === n) ?? null
    if (t) t.rotationQuaternion = null
    return t
  })
  let seconde = -1
  scene.onBeforeRenderObservable.add(() => {
    const t = Date.now()
    if (Math.floor(t / 1000) === seconde) return
    seconde = Math.floor(t / 1000)
    tournerAiguilles(aiguilles[0], aiguilles[1], new Date(t))
  })

  for (const m of fusionnerParMatiere(c.meshes, (m) => m.name.startsWith('Nef_Aiguille'))) {
    m.receiveShadows = true
    if (m.material?.name !== 'Nef_Verre') generateur?.addShadowCaster(m)
  }
  generateur?.getShadowMap()?.resetRefreshCounter()
}
