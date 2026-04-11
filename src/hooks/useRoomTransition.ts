import { useState, useCallback, useRef } from 'react'
import { useGameStore } from '../stores/gameStore'

export function useRoomTransition() {
  const [transitioning, setTransitioning] = useState(false)
  const setCurrentRoomId = useGameStore((s) => s.setCurrentRoomId)
  const fadeRef = useRef<HTMLDivElement | null>(null)

  const triggerTransition = useCallback(
    (targetRoomId: string) => {
      if (transitioning) return

      setTransitioning(true)

      if (fadeRef.current) {
        fadeRef.current.style.opacity = '1'
      }

      setTimeout(() => {
        setCurrentRoomId(targetRoomId)

        if (fadeRef.current) {
          fadeRef.current.style.opacity = '0'
        }

        setTimeout(() => {
          setTransitioning(false)
        }, 500)
      }, 500)
    },
    [transitioning, setCurrentRoomId]
  )

  return { transitioning, triggerTransition, fadeRef }
}
