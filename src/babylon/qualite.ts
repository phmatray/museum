/**
 * La qualité adaptative (QualiteAdaptative de Musee3D.tsx) : la densité de pixels
 * suit les paliers de scene/qualite.ts, densité d ⇔ `setHardwareScalingLevel(1 / d)`.
 * Le moniteur reproduit le PerformanceMonitor de drei (réglages par défaut) :
 * une moyenne d'images par seconde toutes les 250 ms, un verdict toutes les
 * 10 moyennes. Il ne tourne qu'une fois le musée prêt (`demarrer()`) et jamais
 * sous `?qualite=haute|basse` (ou le réglage « Qualité »), ni en VR : la densité de
 * l'écran ne touche pas la couche XR (son échelle est fixée à l'entrée, vr.ts).
 */
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'
import type { Scene } from '@babylonjs/core/scene'

import { ajusterQualite, paliersPour, QUALITE_INITIALE, type QualiteForcee } from '../scene/qualite.ts'
import { partie, reglages } from './etat.ts'

const FENETRE = 250
const MOYENNES = 10

/** Le verdict de drei sur 10 moyennes : plus des trois quarts au-dessus du seuil haut, ou sous le seuil bas. */
export function verdictImages(moyennes: number[], rafraichissement: number): 'hausse' | 'baisse' | null {
  const [bas, haut] = rafraichissement > 100 ? [60, 100] : [40, 60]
  const seuil = moyennes.length * 0.75
  if (moyennes.filter((f) => f >= haut).length > seuil) return 'hausse'
  if (moyennes.filter((f) => f < bas).length > seuil) return 'baisse'
  return null
}

export function monterQualite(engine: AbstractEngine, scene: Scene, demandee: () => QualiteForcee): { demarrer(): void } {
  // Comme Musee3D : les paliers de l'écran du chargement.
  const P = paliersPour(devicePixelRatio)
  let etat = QUALITE_INITIALE
  let forcee = demandee()
  let pret = false
  let images: number[] = []
  let moyennes: number[] = []
  let rafraichissement = 0

  const poser = (d: number) => engine.setHardwareScalingLevel(1 / d)
  poser(forcee === 'basse' ? P[P.length - 1] : P[0])
  // Le réglage « Qualité » en direct : forcée, la densité se fige ; revenue à « Auto », elle repart de la pleine qualité.
  reglages.subscribe(() => {
    if (demandee() === forcee) return
    forcee = demandee()
    etat = QUALITE_INITIALE
    images = []
    moyennes = []
    poser(forcee === 'basse' ? P[P.length - 1] : P[0])
  })

  scene.onBeforeRenderObservable.add(() => {
    if (!pret || forcee) return
    // En VR, la fenêtre repart à zéro : une moyenne d'avant la session fausserait la première d'après.
    if (partie.getState().enVR) return void (images = [])
    const t = performance.now()
    images.push(t)
    const ecoule = t - images[0]
    if (ecoule < FENETRE) return
    const fps = Math.round((images.length / ecoule) * 1000)
    images = []
    rafraichissement = Math.max(rafraichissement, fps)
    moyennes.push(fps)
    if (moyennes.length < MOYENNES) return
    const verdict = verdictImages(moyennes, rafraichissement)
    moyennes = []
    if (!verdict) return
    const suivant = ajusterQualite(etat, verdict, P.length)
    if (suivant.palier !== etat.palier) poser(P[suivant.palier])
    etat = suivant
  })

  return { demarrer: () => void (pret = true) }
}
