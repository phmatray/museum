/**
 * Le visiteur du PLAN : une caméra que `plan/walk.ts` promène.
 *
 * Aucune physique : `step` décide où l'on peut aller, ce composant ne fait que
 * lire le clavier, cadencer les pas fixes et poser la caméra à hauteur d'œil.
 * Le regard (souris) reste à `PointerLockCamera` ; au doigt (#31), c'est ce
 * composant qui applique le glissé que `MobileControlsOverlay` accumule.
 */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useKeyboardControls } from '@react-three/drei'
import { PAS_FIXE, cadencer } from '../domain/locomotion'
import { MUSEE } from '../plan/musee'
import { surfaceAt } from '../plan/rules'
import { VISITE as ITINERAIRE, avancer, capVers, type Curseur } from '../plan/tour'
import { step, type Walker } from '../plan/walk'
import { toucher, useGameStore } from '../stores/gameStore'

/**
 * 1,62 m : l'œil d'un adulte de 1,75 m. C'est l'unique référence d'échelle d'une
 * vue subjective ; 38 cm de trop rapetissaient tout le bâtiment.
 */
const HAUTEUR_OEIL = 1.62

/** Radians par pixel de glissé : la même sensibilité que la souris. */
const SENSIBILITE_TOUCHER = 0.002

/** Secondes d'arrêt au centre de chaque salle de la visite. */
const PAUSE_VISITE = 4
/** Vitesse de convergence du regard vers le cap de la visite, en s⁻¹. */
const TAUX_REGARD = 3.5

/** Le visiteur au point d'apparition, calculé une fois : un plan faux casse à l'import. */
const DEPART: Walker = (() => {
  const { level, x, z } = MUSEE.spawn
  const y = MUSEE.levels.find((l) => l.id === level)?.elevation ?? 0
  const surface = surfaceAt(MUSEE, x, z, y)
  if (!surface) throw new Error("le point d'apparition n'est sur aucune surface")
  return { level, surface, x, z, y, yaw: 0 }
})()

export function PlanPlayer() {
  const { camera } = useThree()
  const [, getKeys] = useKeyboardControls()
  const paused = useGameStore((s) => s.paused)
  const tourActive = useGameStore((s) => s.tourActive)
  const walker = useRef<Walker>(DEPART)
  const reste = useRef(0)
  const curseur = useRef<Curseur | null>(null)
  const attente = useRef(0)

  /**
   * L'entrée d'un pas de visite guidée : marcher vers le prochain point de
   * l'arrêt, puis s'y arrêter `PAUSE_VISITE` secondes. `null` : visite finie.
   */
  const guider = (w: Walker, dt: number) => {
    const c = avancer(ITINERAIRE, curseur.current ?? { stop: 0, point: 0 }, w)
    curseur.current = c
    if (useGameStore.getState().tourEtape !== c.stop) useGameStore.setState({ tourEtape: c.stop })
    const pts = ITINERAIRE[c.stop].points
    if (c.point < pts.length) return { forward: 1, strafe: 0, yaw: capVers(w, ...pts[c.point]) }
    attente.current += dt
    if (attente.current >= PAUSE_VISITE) {
      attente.current = 0
      if (c.stop + 1 >= ITINERAIRE.length) return null
      curseur.current = { stop: c.stop + 1, point: 0 }
    }
    return { forward: 0, strafe: 0, yaw: w.yaw }
  }

  // Cadrage initial, face au nord (yaw 0 = −z) : l'accueil s'affiche en pause,
  // et sans ça la première image serait celle de la caméra par défaut de R3F.
  useEffect(() => {
    const w = walker.current
    /* eslint-disable react-hooks/immutability */
    camera.rotation.order = 'YXZ'
    camera.rotation.set(0, 0, 0)
    camera.position.set(w.x, w.y + HAUTEUR_OEIL, w.z)
    /* eslint-enable react-hooks/immutability */
  }, [camera])

  // Chaque visite repart du point d'apparition, où commence son itinéraire :
  // lancée depuis l'étage, sa première ligne droite buterait contre un mur.
  useEffect(() => {
    curseur.current = null
    attente.current = 0
    if (tourActive) {
      walker.current = DEPART
      useGameStore.setState({ tourEtape: 0 })
    }
  }, [tourActive])

  // En développement seulement : de quoi suivre le visiteur depuis un navigateur
  // piloté (cap, pause, surface sous le pied).
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __PLAN__?: unknown }
    w.__PLAN__ = { camera, walker: () => walker.current, reprendre: () => useGameStore.setState({ paused: false }) }
    return () => { delete w.__PLAN__ }
  }, [camera])

  useFrame((_, delta) => {
    if (paused) return
    const t = getKeys() as { forward: boolean; backward: boolean; left: boolean; right: boolean; hate?: boolean }
    const { pas, reste: r } = cadencer(reste.current, delta)
    reste.current = r
    if (toucher.lookX || toucher.lookY) {
      /* eslint-disable react-hooks/immutability */
      camera.rotation.order = 'YXZ'
      camera.rotation.y -= toucher.lookX * SENSIBILITE_TOUCHER
      camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x - toucher.lookY * SENSIBILITE_TOUCHER))
      /* eslint-enable react-hooks/immutability */
      toucher.lookX = toucher.lookY = 0
    }
    // Clavier et joystick s'additionnent, bornés à [−1, 1] comme l'attend `step`.
    const borne = (v: number) => Math.max(-1, Math.min(1, v))
    const input = {
      forward: borne(Number(t.forward) - Number(t.backward) + toucher.forward),
      strafe: borne(Number(t.right) - Number(t.left) + toucher.strafe),
      yaw: camera.rotation.y,
      hate: t.hate,
    }
    let w = walker.current
    for (let i = 0; i < pas; i++) {
      const entree = tourActive ? guider(w, PAS_FIXE) : input
      if (!entree) {
        // Fin de visite : on rend la main à l'accueil, comme l'ancienne.
        curseur.current = null
        useGameStore.setState({ tourActive: false, paused: true })
        break
      }
      w = step(MUSEE, w, entree, PAS_FIXE)
    }
    walker.current = w
    if (tourActive) {
      // Le regard rejoint le cap de la marche, amorti et indépendant de la cadence.
      const k = 1 - Math.exp(-TAUX_REGARD * delta)
      const ecart = Math.atan2(Math.sin(w.yaw - camera.rotation.y), Math.cos(w.yaw - camera.rotation.y))
      camera.rotation.order = 'YXZ'
      camera.rotation.y += ecart * k
      camera.rotation.x -= camera.rotation.x * k
    }
    // Publié seulement s'il a bougé ou tourné : à l'arrêt, la minimap ne se redessine pas.
    const v = useGameStore.getState().visiteur
    if (!v || v.x !== w.x || v.z !== w.z || v.yaw !== w.yaw || v.surface !== w.surface) useGameStore.setState({ visiteur: w })
    camera.position.set(w.x, w.y + HAUTEUR_OEIL, w.z)
  })

  return null
}
