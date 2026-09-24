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
import { step, type Walker } from '../plan/walk'
import { toucher, useGameStore } from '../stores/gameStore'

/**
 * 1,62 m : l'œil d'un adulte de 1,75 m. C'est l'unique référence d'échelle d'une
 * vue subjective ; 38 cm de trop rapetissaient tout le bâtiment.
 */
const HAUTEUR_OEIL = 1.62

/** Radians par pixel de glissé : la même sensibilité que la souris. */
const SENSIBILITE_TOUCHER = 0.002

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
  const walker = useRef<Walker>(DEPART)
  const reste = useRef(0)

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
    for (let i = 0; i < pas; i++) w = step(MUSEE, w, input, PAS_FIXE)
    walker.current = w
    camera.position.set(w.x, w.y + HAUTEUR_OEIL, w.z)
  })

  return null
}
