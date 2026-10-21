/**
 * Les entrées de la VR (VRLayer de three, sans React) : manettes et tapotements
 * lus par `lireEntrees` (domain/vr.ts), traduits pour la marche (`vrEntree`,
 * que visiteur.ts lit en VR), la rotation par crans appliquée au gréement, et la
 * vignette de confort tirée du mouvement du gréement (vitesse et rotation).
 *
 * Chargé par `import()` comme vr.ts, dès que la VR est possible ici (main.ts) : l'observateur
 * d'image vit avec la scène, mais rend la main aussitôt tant qu'aucune session n'est ouverte.
 */
import type { Scene } from '@babylonjs/core/scene'

import { ETAT_VR, confort, lireEntrees } from '../domain/vr.ts'
import { partie, vrEntree } from './etat.ts'
import { manetteDe, tapotementCompte, type PorteVR } from './vr.ts'

export function monterEntreesVR(scene: Scene, porte: PorteVR): void {
  let selections = 0
  let etat = ETAT_VR
  // La pose du gréement à l'image précédente (`a` : relevée), réécrite en place.
  const prec = { a: false, x: 0, z: 0, cap: 0 }
  let session: XRSession | null = null

  // Un « select » qui ne vient pas d'une manette (le regard du Cardboard, un casque sans manette) bascule la marche.
  const surSelect = (e: XRInputSourceEvent) => e.inputSource.targetRayMode !== 'tracked-pointer' && selections++
  // Le polyfill ne sait pas toujours relayer le tapotement d'écran en « select » : on le compte aussi.
  const surTape = (e: PointerEvent) => tapotementCompte(e.clientX, e.clientY, innerWidth, innerHeight) && selections++

  partie.subscribe((s, a) => {
    if (s.enVR === a.enVR) return
    session?.removeEventListener('select', surSelect)
    removeEventListener('pointerdown', surTape)
    session = null
    selections = 0
    etat = ETAT_VR
    prec.a = false
    if (!s.enVR) return
    session = porte.xr()?.sessionManager.session ?? null
    session?.addEventListener('select', surSelect)
    if (porte.mode === 'cardboard') addEventListener('pointerdown', surTape)
  })

  // En tête de file : la marche (visiteur.ts) lit `vrEntree` la même image.
  scene.onBeforeRenderObservable.add(() => {
    if (!session) return
    const dt = scene.getEngine().getDeltaTime() / 1000
    const r = lireEntrees(Array.from(session.inputSources, manetteDe), selections, etat)
    selections = 0
    const g = porte.gree
    g.rotation.y += r.entree.tourner
    vrEntree.avance = r.entree.avance
    vrEntree.cote = r.entree.cote
    vrEntree.hate = r.entree.hate
    const vitesse = prec.a && dt > 0 ? Math.hypot(g.position.x - prec.x, g.position.z - prec.z) / dt : 0
    const rotation = prec.a && dt > 0 ? Math.abs(g.rotation.y - prec.cap) / dt : 0
    prec.a = true
    prec.x = g.position.x
    prec.z = g.position.z
    prec.cap = g.rotation.y
    // `r.etat` est neuf à chaque lecture : la vignette s'y écrit en place.
    etat = r.etat
    vrEntree.confort = etat.confort = confort(etat.confort, vitesse, rotation, dt)
  }, undefined, true)
}
