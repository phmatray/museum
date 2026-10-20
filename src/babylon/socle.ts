/**
 * Le socle Babylon : le moteur (WebGPU s'il répond, sinon WebGL2) et une scène
 * en main droite, pour lire le plan tel quel (x est, z sud, y haut, mètres).
 */
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'
import { Engine } from '@babylonjs/core/Engines/engine'
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration'
import { Scene } from '@babylonjs/core/scene'

import { vrDisponible } from '../io/xr.ts'

export async function creerSocle(toile: HTMLCanvasElement): Promise<{ engine: AbstractEngine; scene: Scene }> {
  let engine: AbstractEngine | null = null
  // `?gpu=0` force WebGL2 : de quoi mesurer les deux chemins. Un adaptateur de repli (SwiftShader,
  // rendu sur le processeur, celui de Chromium headless) est 300 fois plus lent que WebGL2 : écarté.
  // Un casque (WebXR natif, sans polyfill à charger) ou `?vr=` (Cardboard forcé, ou demandé par le bouton du billet
  // sur un téléphone en WebGPU, main.ts) : WebGL2, contexte compatible XR. Un téléphone qui n'entre pas en VR garde WebGPU,
  // et son polyfill Cardboard s'installe après le moteur (main.ts).
  // ponytail : le XR de Babylon sur WebGPU exige XRGPUBinding et WebXR Layers, que ni les casques ni le polyfill
  // n'exposent encore ; à revoir quand WebXRSessionManager.IsWebGPUXRSupported deviendra vrai.
  const voulue = new URLSearchParams(location.search).has('vr') || (await navigator.xr?.isSessionSupported('immersive-vr').catch(() => false)) === true
  const vr = voulue && (await vrDisponible()) !== null
  const adaptateur = !vr && new URLSearchParams(location.search).get('gpu') !== '0' ? await navigator.gpu?.requestAdapter().catch(() => null) : null
  if (adaptateur && !adaptateur.info?.isFallbackAdapter) {
    try {
      const gpu = new WebGPUEngine(toile, { antialias: false, adaptToDeviceRatio: true })
      await gpu.initAsync()
      engine = gpu
    } catch {
      engine = null
    }
  }
  // Sans MSAA : l'écran ne reçoit plus que la dernière passe du post-traitement (FXAA), un quad plein écran.
  engine ??= new Engine(toile, false, { stencil: false, xrCompatible: vr }, true)

  const scene = new Scene(engine)
  // Avant toute caméra ou tout maillage : le sens des faces en dépend.
  scene.useRightHandedSystem = true
  const ip = scene.imageProcessingConfiguration
  ip.toneMappingEnabled = true
  ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL
  ip.exposure = 1.15

  addEventListener('resize', () => engine.resize())
  return { engine, scene }
}
