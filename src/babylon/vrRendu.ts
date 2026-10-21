/**
 * Le rendu en VR (SortieVR de VRLayer.tsx) : deux passes par œil, attachées aux
 * caméras d'œil de la WebXRCamera (Babylon ne leur cascade pas les passes de la
 * caméra parente, et ne les crée qu'au premier frame à deux vues).
 *
 *   Bloom     le halo des lumières (constellation, lustres la nuit), le même qu'à
 *   et tons   l'écran (`bloomEtTons` de postTraitement.ts : seuil 1, poids 0,25, puis
 *             Neutral × 1,15 et gamma), sur la scène en demi-flottant, MSAA 4.
 *   Sortie    l'étalonnage de postTraitement.ts ('etalonnageVR' : sans rayons) et la
 *             vignette de confort de three (vrEntree.confort), par œil, puis sRGB.
 *
 * En XR, la caméra active est la WebXRCamera parente, sans passe : le prepass (SSAO2)
 * s'éteint de lui-même, et en s'éteignant remet applyByPostProcess à faux. Les matières
 * figées garderaient la sortie linéaire, les vivantes (toiles) prendraient la courbe
 * en double : on le remet à vrai avant chaque caméra, tant qu'on est en VR.
 *
 * Chaque œil finit dans le framebuffer XR, à son viewport : vUV couvre 0..1 par œil.
 * Écarts assumés : le halo vient du bloom de l'écran, pas des mips de la cible HDR
 * de three (Babylon n'en fait pas sur l'entrée d'une passe) ; pas d'AO d'écran
 * (comme three), pas de rayons, pas de FXAA (le MSAA le remplace).
 */
import { Constants } from '@babylonjs/core/Engines/constants'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess'
import type { Scene } from '@babylonjs/core/scene'

import { partie, vrEntree } from './etat.ts'
import { appliquerEtalonnage, bloomEtTons, etalonnage, langueDe } from './postTraitement.ts'
import type { PorteVR } from './vr.ts'

/** Monte les passes par œil, au premier passage en VR (rien n'est créé avant). */
export function monterRenduVR(scene: Scene, porte: PorteVR): void {
  const engine = scene.getEngine()
  let monte = false
  partie.subscribe((s) => {
    const xr = porte.xr()
    if (!s.enVR || monte || !xr) return
    monte = true
    etalonnage(true)
    const sortie = new PostProcess('vr:sortie', 'etalonnageVR', ['lift', 'gamma', 'gain', 'saturation', 'contraste', 'nuit', 'confort'], null, 1, null,
      Texture.BILINEAR_SAMPLINGMODE, engine, false, null, Constants.TEXTURETYPE_UNSIGNED_BYTE, undefined, undefined, false, undefined, langueDe(engine))
    sortie.onApply = (e) => {
      appliquerEtalonnage(e)
      e.setFloat('confort', vrEntree.confort)
    }
    // Les caméras d'œil n'existent qu'au premier frame à deux vues, et survivent d'une session à l'autre :
    // le pipeline (bloom et tons) les prend alors toutes deux, la sortie après lui.
    const brancher = () => {
      const yeux = xr.camera.rigCameras
      if (yeux.length < 2) return
      xr.sessionManager.onXRFrameObservable.removeCallback(brancher)
      const rendu = bloomEtTons('vr:rendu', scene, [...yeux])
      rendu.samples = 4
      // Le halo de three en VR (mips 2 à 5 de sa cible, à la résolution d'un œil) porte bien plus loin que son bloom
      // d'écran : poids 1 plutôt que 0,25, comparé à 22 h au hall (la constellation reste moins nimbée que dans three).
      rendu.bloomWeight = 1
      for (const r of yeux) r.attachPostProcess(sortie)
    }
    xr.sessionManager.onXRFrameObservable.add(brancher)
    const ip = scene.imageProcessingConfiguration
    scene.onBeforeCameraRenderObservable.add(() => {
      if (partie.getState().enVR) ip.applyByPostProcess = true
    })
    // Le polyfill du Cardboard touche l'état GL derrière le cache de Babylon (gl.resetState() de three).
    if (porte.mode === 'cardboard') xr.sessionManager.onXRFrameObservable.add(() => engine.wipeCaches(true))
  })
}
