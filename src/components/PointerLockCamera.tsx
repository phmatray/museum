/**
 * Le regard à la souris, une fois le pointeur capturé. À part de l'accueil
 * (`PointerLockOverlay`) : l'accueil s'affiche avant que la 3D soit chargée,
 * et ce module-ci tire `@react-three/fiber` avec lui.
 */
import { useEffect, useCallback } from 'react'
import { useThree } from '@react-three/fiber'
import { useGameStore } from '../stores/gameStore'

export function PointerLockCamera() {
  const { camera, gl } = useThree()
  const setPaused = useGameStore((s) => s.setPaused)
  const setPointerLocked = useGameStore((s) => s.setPointerLocked)

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (document.pointerLockElement !== gl.domElement) return

      const sensitivity = 0.002
      // La caméra de `useThree` est un objet three.js mutable, pas un état
      // React : la faire passer par un setState la re-rendrait à chaque pixel
      // de souris. La muter est ici le contrat de R3F, pas un contournement.
      /* eslint-disable react-hooks/immutability */
      camera.rotation.order = 'YXZ'
      camera.rotation.y -= event.movementX * sensitivity
      camera.rotation.x -= event.movementY * sensitivity
      camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x))
      /* eslint-enable react-hooks/immutability */
    },
    [camera, gl.domElement]
  )

  useEffect(() => {
    function handleLockChange() {
      const locked = document.pointerLockElement === gl.domElement
      setPointerLocked(locked)
      if (!locked) {
        setPaused(true)
      }
    }

    document.addEventListener('pointerlockchange', handleLockChange)
    document.addEventListener('mousemove', handleMouseMove)

    return () => {
      document.removeEventListener('pointerlockchange', handleLockChange)
      document.removeEventListener('mousemove', handleMouseMove)
    }
  }, [gl.domElement, handleMouseMove, setPointerLocked, setPaused])

  return null
}
