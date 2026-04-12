import { useCallback } from 'react'
import { useGameStore } from '../stores/gameStore'

export function useRoomTransition() {
  const setCurrentRoomId = useGameStore((s) => s.setCurrentRoomId)

  const triggerTransition = useCallback(
    (targetRoomId: string) => {
      setCurrentRoomId(targetRoomId)
    },
    [setCurrentRoomId]
  )

  return { triggerTransition }
}
