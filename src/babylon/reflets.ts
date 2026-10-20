/**
 * Les reflets (RefletsLayer de three) : ce que le laiton, le métal, le verre et
 * le marbre poli ont à refléter, `scene.environmentTexture`.
 *
 * - Dehors, le CIEL : une sonde sans rien à dessiner, donc le fond de l'heure
 *   (le ciel de la vague jardin s'y ajoutera, `dehors.renderList`).
 * - Dedans, la sonde de la NEF : la scène vue du centre du hall, à 3 m, qui
 *   voit le ciel dans les métaux qu'elle capture (la sonde « dehors » sert
 *   d'environnement le temps de sa capture : jamais sa propre texture).
 *
 * La sonde n'éclaire que le SPÉCULAIRE, comme three (l'irradiance IBL y est
 * retirée de son shader) : un polynôme sphérique nul tient lieu d'irradiance,
 * le diffus ambiant reste l'hémisphérique et la lumière cuite.
 * Rien n'est rendu à chaque image : `rafraichir()` quand les couches sont là.
 * Mêmes tailles et mêmes réglages des deux côtés : passer la porte ne recompile rien.
 * ponytail : une sonde pour tout l'intérieur (three : une par salle, fondues aux
 * seuils) ; intensité fixée au montage, celle du dedans (three : 0,6 dehors).
 */
import { ReflectionProbe } from '@babylonjs/core/Probes/reflectionProbe'
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture'
import { SphericalPolynomial } from '@babylonjs/core/Maths/sphericalPolynomial'
import type { Scene } from '@babylonjs/core/scene'

import type { Plan } from '../plan/types.ts'

/** Côté d'une face : les reflets sont flous, 128 suffit. */
const TAILLE = 128
/** L'intensité des reflets dedans, et la part qui en reste la nuit (RefletsLayer). */
const INTENSITE = { dedans: 0.8, nuit: 0.25 }

/** L'emprise du bâtiment (toutes les salles, tous niveaux) et le centre de la nef. */
export function emprise(plan: Plan): { x0: number; x1: number; z0: number; z1: number; nef: [number, number, number] } {
  const salles = plan.levels.flatMap((l) => l.rooms)
  const hall = salles.find((r) => r.kind === 'hall') ?? salles[0]
  return {
    x0: Math.min(...salles.map((r) => r.x)),
    x1: Math.max(...salles.map((r) => r.x + r.width)),
    z0: Math.min(...salles.map((r) => r.z)),
    z1: Math.max(...salles.map((r) => r.z + r.depth)),
    nef: [hall.x + hall.width / 2, 3, hall.z + hall.depth / 2],
  }
}

export function monterReflets(scene: Scene, plan: Plan, jour: number): { rafraichir: () => void } {
  const e = emprise(plan)
  const sonde = (nom: string) => {
    const p = new ReflectionProbe(nom, TAILLE, scene)
    p.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE
    // Une sonde ne se rend que si une matière la porte en propre : celle de la scène passe par les cibles du rendu.
    scene.customRenderTargets.push(p.cubeTexture)
    // Le spéculaire seul : l'irradiance tirée du polynôme sphérique, ici nul.
    const t = p.cubeTexture.getInternalTexture()!
    t._sphericalPolynomial = new SphericalPolynomial()
    t._sphericalPolynomialComputed = true
    return p
  }
  const dehors = sonde('reflets-dehors')
  const dedans = sonde('reflets-nef')
  dedans.position.set(...e.nef)
  const avant = { env: dehors.cubeTexture as RenderTargetTexture }
  dedans.cubeTexture.onBeforeBindObservable.add(() => {
    avant.env = scene.environmentTexture as RenderTargetTexture
    scene.environmentTexture = dehors.cubeTexture
  })
  dedans.cubeTexture.onAfterUnbindObservable.add(() => (scene.environmentTexture = avant.env))

  scene.environmentIntensity = INTENSITE.dedans * (INTENSITE.nuit + (1 - INTENSITE.nuit) * jour)
  scene.environmentTexture = dedans.cubeTexture
  // Dedans ou dehors, selon l'emprise du bâtiment ; la texture ne change qu'au passage.
  scene.onBeforeRenderObservable.add(() => {
    const c = scene.activeCamera?.position
    if (!c) return
    const voulue = c.x > e.x0 && c.x < e.x1 && c.z > e.z0 && c.z < e.z1 ? dedans.cubeTexture : dehors.cubeTexture
    if (scene.environmentTexture !== voulue) scene.environmentTexture = voulue
  })
  return {
    rafraichir: () => {
      dedans.renderList!.splice(0, Infinity, ...scene.meshes)
      dedans.cubeTexture.resetRefreshCounter()
      dehors.cubeTexture.resetRefreshCounter()
    },
  }
}
