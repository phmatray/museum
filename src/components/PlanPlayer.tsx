/**
 * Le visiteur du PLAN : une caméra que `plan/walk.ts` promène.
 *
 * Aucune physique : `step` décide où l'on peut aller, ce composant ne fait que
 * lire le clavier, cadencer les pas fixes et poser la caméra à hauteur d'œil.
 * Le regard (souris) reste à `PointerLockCamera`, seul propriétaire de la rotation.
 */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useKeyboardControls } from '@react-three/drei'
import { PAS_FIXE, cadencer } from '../domain/locomotion'
import { MUSEE } from '../plan/musee'
import { surfaceAt } from '../plan/rules'
import { step, type Walker } from '../plan/walk'
import { useGameStore } from '../stores/gameStore'
import { HAUTEUR_OEIL } from './Player'

export function PlanPlayer() {
  const { camera } = useThree()
  const [, getKeys] = useKeyboardControls()
  const paused = useGameStore((s) => s.paused)
  const { level, x, z } = MUSEE.spawn
  const elevation = MUSEE.levels.find((l) => l.id === level)?.elevation ?? 0
  const surface = surfaceAt(MUSEE, x, z, elevation)
  if (!surface) throw new Error("le point d'apparition n'est sur aucune surface")
  const walker = useRef<Walker>({ level, surface, x, z, y: elevation, yaw: 0 })
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
  // piloté (cap, pause, surface sous le pied), comme `window.__MUSEUM__`.
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
    const input = {
      forward: Number(t.forward) - Number(t.backward),
      strafe: Number(t.right) - Number(t.left),
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
