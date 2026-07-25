import React, { useEffect, useCallback } from 'react'
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

export function PointerLockOverlay() {
  const paused = useGameStore((s) => s.paused)
  const setPaused = useGameStore((s) => s.setPaused)
  const setTourActive = useGameStore((s) => s.setTourActive)

  const handleClick = () => {
    const canvas = document.querySelector('canvas')
    if (canvas) {
      canvas.requestPointerLock()
      setPaused(false)
    }
  }

  const handleStartTour = (e: React.MouseEvent) => {
    e.stopPropagation()
    setTourActive(true)
    setPaused(false)
  }

  if (!paused) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Dégradé plutôt qu'un voile uniforme : à 0,7 d'opacité sur toute la
        // surface, la PREMIÈRE image du musée était assombrie de 70 % avant même
        // que la 3D n'entre en jeu — la moitié de l'impression « trop sombre »
        // venait de là. Le dégradé ne charge que la bande centrale, là où le
        // texte a besoin de contraste, et laisse voir le bâtiment autour.
        background:
          'radial-gradient(ellipse at center, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.55) 35%, rgba(0,0,0,0.18) 70%, rgba(0,0,0,0.06) 100%)',
        color: 'white',
        zIndex: 1000,
        cursor: 'pointer',
        flexDirection: 'column',
        gap: '1rem',
      }}
      onClick={handleClick}
    >
      <h1 style={{ fontSize: '2rem', margin: 0 }}>Virtual Museum</h1>
      <p style={{ fontSize: '1.2rem', opacity: 0.8 }}>Click to enter</p>
      <p style={{ fontSize: '0.9rem', opacity: 0.6 }}>
        WASD to move | Mouse to look | Escape to pause
      </p>
      <button
        onClick={handleStartTour}
        style={{
          marginTop: '1rem',
          padding: '0.75rem 1.5rem',
          fontSize: '1rem',
          background: '#4a90d9',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
        }}
      >
        Start Guided Tour
      </button>
    </div>
  )
}

export function TourExitButton() {
  const tourActive = useGameStore((s) => s.tourActive)
  const setTourActive = useGameStore((s) => s.setTourActive)
  const setPaused = useGameStore((s) => s.setPaused)

  // ESC key exits the tour. We need a separate keydown listener because
  // pointer lock isn't engaged during the tour, so the pointerlockchange
  // handler never fires.
  useEffect(() => {
    if (!tourActive) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setTourActive(false)
        setPaused(true)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [tourActive, setTourActive, setPaused])

  if (!tourActive) return null

  return (
    <button
      onClick={() => {
        setTourActive(false)
        setPaused(true)
      }}
      style={{
        position: 'fixed',
        top: '1rem',
        right: '1rem',
        padding: '0.5rem 1rem',
        // Dégradé plutôt qu'un voile uniforme : à 0,7 d'opacité sur toute la
        // surface, la PREMIÈRE image du musée était assombrie de 70 % avant même
        // que la 3D n'entre en jeu — la moitié de l'impression « trop sombre »
        // venait de là. Le dégradé ne charge que la bande centrale, là où le
        // texte a besoin de contraste, et laisse voir le bâtiment autour.
        background:
          'radial-gradient(ellipse at center, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.55) 35%, rgba(0,0,0,0.18) 70%, rgba(0,0,0,0.06) 100%)',
        color: 'white',
        border: '1px solid rgba(255,255,255,0.3)',
        borderRadius: '4px',
        cursor: 'pointer',
        zIndex: 1000,
      }}
    >
      Exit Tour (ESC)
    </button>
  )
}
