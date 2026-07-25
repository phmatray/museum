import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../stores/gameStore'

/**
 * Une étape de visite.
 *
 * Le type vivait dans `src/types/museum.ts`, supprimé au lot 2 avec l'ancien
 * modèle de musée. Il descend ici parce que c'est un objet de MISE EN SCÈNE et
 * non de bâtiment : `domain/types.ts` décrit ce qui existe, pas la façon dont
 * on le fait visiter. Le lot 3 dérivera un itinéraire des accrochages.
 */
export interface TourStop {
  position: { x: number; y: number; z: number }
  lookAt: { x: number; y: number; z: number }
  /** Temps d'arrêt à cette étape, en secondes. */
  pauseDuration: number
}

interface GuidedTourProps {
  stops: TourStop[]
  onComplete: () => void
}

const SPEED = 2 // meters per second

export function GuidedTour({ stops, onComplete }: GuidedTourProps) {
  const { camera } = useThree()
  const tourActive = useGameStore((s) => s.tourActive)

  const currentStopIndex = useRef(0)
  const progress = useRef(0)
  const pauseTimer = useRef(0)
  const isPaused = useRef(false)
  const wasActive = useRef(false)

  useFrame((_, delta) => {
    if (!tourActive) {
      wasActive.current = false
      return
    }

    // Visite sans itinéraire : on rend la main IMMÉDIATEMENT. Se contenter de
    // sortir laisserait `tourActive` à vrai, c'est-à-dire un joueur figé (le
    // `Player` ne bouge pas pendant une visite) dans une visite qui ne se
    // termine jamais — seule la touche Échap en sortirait. Le lot 2 n'a pas
    // encore d'itinéraire : ce chemin est celui qu'on prend réellement.
    if (stops.length < 2) {
      wasActive.current = false
      onComplete()
      return
    }

    // Reset state synchronously when the tour just became active.
    // We can't rely on useEffect because it runs AFTER useFrame on the first frame,
    // which means useFrame would see stale refs from a previous completed tour.
    if (!wasActive.current) {
      currentStopIndex.current = 0
      progress.current = 0
      isPaused.current = false
      pauseTimer.current = 0
      wasActive.current = true
    }

    const idx = currentStopIndex.current
    if (idx >= stops.length - 1) {
      onComplete()
      return
    }

    if (isPaused.current) {
      pauseTimer.current += delta
      if (pauseTimer.current >= stops[idx].pauseDuration) {
        isPaused.current = false
        pauseTimer.current = 0
        currentStopIndex.current += 1
        progress.current = 0
      }
      return
    }

    const from = stops[idx]
    const to = stops[idx + 1]
    const fromPos = new THREE.Vector3(from.position.x, from.position.y, from.position.z)
    const toPos = new THREE.Vector3(to.position.x, to.position.y, to.position.z)
    const distance = fromPos.distanceTo(toPos)
    const travelTime = distance / SPEED

    progress.current += delta / travelTime

    if (progress.current >= 1) {
      progress.current = 1
      isPaused.current = true
      pauseTimer.current = 0
    }

    const pos = fromPos.lerp(toPos, progress.current)
    camera.position.copy(pos)

    const fromLook = new THREE.Vector3(from.lookAt.x, from.lookAt.y, from.lookAt.z)
    const toLook = new THREE.Vector3(to.lookAt.x, to.lookAt.y, to.lookAt.z)
    const lookTarget = fromLook.lerp(toLook, progress.current)
    camera.lookAt(lookTarget)
  })

  return null
}
