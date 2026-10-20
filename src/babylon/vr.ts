/**
 * La VR en Babylon (VRLayer de three, sans React) : le socle commun de la vague 6.
 *
 * - La détection reste celle d'io/xr.ts (`vrDisponible`) : WebXR natif (casque),
 *   sinon le Cardboard du polyfill. main.ts ne charge ce module que si la VR est
 *   possible et que le socle (socle.ts) a pris WebGL2 (XR impossible sur WebGPU).
 * - L'expérience XR (`WebXRExperienceHelper`, nue : ni bouton, ni téléportation,
 *   ni modèles de manettes du CDN) n'est créée qu'au premier `entrer()`, DANS le
 *   geste du visiteur : Babylon ouvre lui-même la session (`enterXRAsync`), le
 *   `entrerEnVR` d'io/xr ne sert pas ici.
 * - Le GRÉEMENT ('vr:greement') porte la caméra XR : la tête bouge librement
 *   dedans, la marche (visiteur.ts) promène le gréement au pied du marcheur.
 *   À l'entrée, la caméra XR est remise à zéro dedans et le gréement prend la place
 *   et le cap du visiteur (rien ne saute).
 * - L'état : `partie.enVR` (vrai au premier frame XR, avec pause et visite levées,
 *   comme three ; faux à la fin de session, sans toucher la pause) et `vrEntree`
 *   (etat.ts), remis à zéro à la sortie.
 *
 * Espace de référence comme three : 'local-floor' demandé en option, pris seulement
 * s'il est accordé, sinon 'local' (l'œil posé à 1,62 m par le gréement). Babylon,
 * lui, retomberait sur 'viewer' (tête fixe) : on choisit avant sa requête.
 */
import type { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import { WebXRExperienceHelper } from '@babylonjs/core/XR/webXRExperienceHelper'
import { WebXRManagedOutputCanvasOptions } from '@babylonjs/core/XR/webXRManagedOutputCanvas'
import { WebXRState } from '@babylonjs/core/XR/webXRTypes'

import type { Manette } from '../domain/vr.ts'
import { permettreGyroscope, type ModeVR } from '../io/xr.ts'
import type { Walker } from '../plan/walk.ts'
import { partie, vrEntree } from './etat.ts'

const OEIL = 1.62
/** Sous un doigt (téléphone), le framebuffer XR à 80 % : le Cardboard tient sa cadence (VRLayer.tsx). */
const ECHELLE_TELEPHONE = 0.8
/** La case de la flèche retour du polyfill (en haut à gauche) et la demi-largeur de sa roue des réglages (en bas au centre), en px. */
const CASE = 64

/** L'espace de référence selon ce que la session accorde (VRLayer.tsx : `enabledFeatures` absent, pas de sol). */
export function espaceDeReference(accordees: readonly string[] | undefined): 'local' | 'local-floor' {
  return accordees?.includes('local-floor') ? 'local-floor' : 'local'
}

/** Une source d'entrée WebXR telle que la lit `lireEntrees` (domain/vr.ts). */
export function manetteDe(s: Pick<XRInputSource, 'handedness' | 'targetRayMode' | 'gamepad'>): Manette {
  return {
    handedness: s.handedness,
    targetRayMode: s.targetRayMode,
    axes: s.gamepad ? [...s.gamepad.axes] : [],
    boutons: s.gamepad ? s.gamepad.buttons.map((b) => b.pressed) : [],
  }
}

/** Un tapotement d'écran (Cardboard) compte comme sélection, sauf sur la flèche retour et la roue des réglages du polyfill. */
export function tapotementCompte(x: number, y: number, largeur: number, hauteur: number): boolean {
  if (x < CASE && y < CASE) return false
  return !(Math.abs(x - largeur / 2) < CASE && y > hauteur - CASE)
}

export interface PorteVR {
  mode: ModeVR
  /** Ouvre la session : à appeler dans le geste du visiteur (clic du billet), sans rien attendre avant. */
  entrer(): Promise<void>
  /** L'expérience XR, null avant le premier `entrer()`. */
  xr(): WebXRExperienceHelper | null
  /** Le gréement qui porte la caméra XR ; la marche le pose au pied du marcheur (+ OEIL si `vrEntree.sansSol`). */
  gree: TransformNode
}

/** Monte la porte de la VR (rien de créé avant `entrer()`) ; `camera` : la FreeCamera du visiteur et son marcheur. */
export function monterVR(scene: Scene, camera: FreeCamera & { walker(): Walker }, mode: ModeVR): PorteVR {
  const gree = new TransformNode('vr:greement', scene)
  let helper: WebXRExperienceHelper | null = null

  const creer = async () => {
    const xr = await WebXRExperienceHelper.CreateAsync(scene)
    xr.camera.minZ = 0.1
    xr.camera.maxZ = 1000
    xr.camera.parent = gree
    // 'local-floor' seulement s'il est accordé (sinon Babylon prendrait 'viewer') ; le gréement lit le même choix.
    let sol = false
    const sm = xr.sessionManager
    const poser = sm.setReferenceSpaceTypeAsync.bind(sm)
    sm.setReferenceSpaceTypeAsync = (t) => {
      sol = t === 'local-floor' && espaceDeReference(sm.session.enabledFeatures) === 'local-floor'
      return poser(t === 'local-floor' && !sol ? 'local' : t)
    }
    // Babylon vient de recopier le visiteur dans la caméra XR : on le reporte sur le gréement, la caméra à zéro dedans.
    xr.onInitialXRPoseSetObservable.add((c) => {
      vrEntree.sansSol = !sol
      // Au pied du marcheur, pas de la caméra (elle porte un saut en cours) : la marche l'y repose ensuite.
      const w = camera.walker()
      gree.position.set(w.x, w.y + (sol ? 0 : OEIL), w.z)
      gree.rotation.set(0, camera.rotation.y, 0)
      c.position.setAll(0)
      c.rotationQuaternion.set(0, 0, 0, 1)
    })
    xr.onStateChangedObservable.add((s) => {
      if (s === WebXRState.IN_XR) partie.setState({ enVR: true, paused: false, tourActive: false })
    })
    xr.sessionManager.onXRSessionEnded.add(() => {
      Object.assign(vrEntree, { avance: 0, cote: 0, hate: false, confort: 0 })
      partie.setState({ enVR: false })
    })
    return xr
  }

  return {
    mode,
    gree,
    xr: () => helper,
    entrer: async () => {
      permettreGyroscope()
      const xr = (helper ??= await creer())
      const opts = WebXRManagedOutputCanvasOptions.GetDefaults(scene.getEngine())
      opts.canvasOptions = { ...opts.canvasOptions, framebufferScaleFactor: matchMedia('(pointer: coarse)').matches ? ECHELLE_TELEPHONE : 1 }
      await xr.enterXRAsync('immersive-vr', 'local-floor', xr.sessionManager.getWebXRRenderTarget(opts), { optionalFeatures: ['bounded-floor'] })
      // Fovéation fixe au plus fort, là où la couche la connaît (casques ; pas le polyfill).
      const couche = xr.sessionManager.session.renderState.baseLayer as (XRWebGLLayer & { fixedFoveation?: number }) | undefined
      if (couche && 'fixedFoveation' in couche) couche.fixedFoveation = 1
    },
  }
}
