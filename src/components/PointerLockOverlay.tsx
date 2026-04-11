import React, { useEffect, useCallback } from 'react'
import { useThree } from '@react-three/fiber'
import { useGameStore } from '../stores/gameStore'

export function PointerLockCamera() {
  const { camera, gl } = useThree()
  const paused = useGameStore((s) => s.paused)
  const setPaused = useGameStore((s) => s.setPaused)
  const setPointerLocked = useGameStore((s) => s.setPointerLocked)

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (document.pointerLockElement !== gl.domElement) return

      const sensitivity = 0.002
      camera.rotation.order = 'YXZ'
      camera.rotation.y -= event.movementX * sensitivity
      camera.rotation.x -= event.movementY * sensitivity
      camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x))
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
  const tourActive = useGameStore((s) => s.tourActive)
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
        background: 'rgba(0,0,0,0.7)',
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

  if (!tourActive) return null

  return (
    <button
      onClick={() => {
        setTourActive(false)
      }}
      style={{
        position: 'fixed',
        top: '1rem',
        right: '1rem',
        padding: '0.5rem 1rem',
        background: 'rgba(0,0,0,0.7)',
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
