import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../stores/gameStore'
import type { TourStop } from '../types/museum'

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
    if (!tourActive || stops.length < 2) {
      wasActive.current = false
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
