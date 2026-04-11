import { useCallback, useEffect, useState } from 'react'
import { useGameStore } from '../stores/gameStore'

export function usePointerLock() {
  const [isLocked, setIsLocked] = useState(false)
  const setPointerLocked = useGameStore((s) => s.setPointerLocked)
  const setPaused = useGameStore((s) => s.setPaused)

  useEffect(() => {
    function handleChange() {
      const locked = document.pointerLockElement !== null
      setIsLocked(locked)
      setPointerLocked(locked)
      if (!locked) {
        setPaused(true)
      }
    }

    document.addEventListener('pointerlockchange', handleChange)
    return () => document.removeEventListener('pointerlockchange', handleChange)
  }, [setPointerLocked, setPaused])

  const lock = useCallback((element: HTMLElement) => {
    element.requestPointerLock()
  }, [])

  const unlock = useCallback(() => {
    document.exitPointerLock()
  }, [])

  return { isLocked, lock, unlock }
}
