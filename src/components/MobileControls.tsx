import { useRef, useCallback } from 'react'

export function MobileControlsOverlay({
  onMove,
  onLook,
}: {
  onMove: (dx: number, dy: number) => void
  onLook: (dx: number, dy: number) => void
}) {
  const joystickOrigin = useRef({ x: 0, y: 0 })
  const joystickTouchId = useRef<number | null>(null)

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i]
        const isLeftHalf = touch.clientX < window.innerWidth / 2

        if (isLeftHalf && joystickTouchId.current === null) {
          joystickTouchId.current = touch.identifier
          joystickOrigin.current = { x: touch.clientX, y: touch.clientY }
        }
      }
    },
    []
  )

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i]

        if (touch.identifier === joystickTouchId.current) {
          const dx = (touch.clientX - joystickOrigin.current.x) / 50
          const dy = (touch.clientY - joystickOrigin.current.y) / 50
          const len = Math.sqrt(dx * dx + dy * dy)
          const clamped = len > 1 ? { dx: dx / len, dy: dy / len } : { dx, dy }
          onMove(clamped.dx, clamped.dy)
        } else {
          onLook(touch.clientX, touch.clientY)
        }
      }
    },
    [onMove, onLook]
  )

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i]
        if (touch.identifier === joystickTouchId.current) {
          joystickTouchId.current = null
          onMove(0, 0)
        }
      }
    },
    [onMove]
  )

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        touchAction: 'none',
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Left joystick area indicator */}
      <div
        style={{
          position: 'absolute',
          left: '10%',
          bottom: '15%',
          width: 120,
          height: 120,
          borderRadius: '50%',
          border: '2px solid rgba(255,255,255,0.3)',
          pointerEvents: 'none',
        }}
      />
      {/* Right look area indicator */}
      <div
        style={{
          position: 'absolute',
          right: '10%',
          bottom: '15%',
          width: 120,
          height: 120,
          borderRadius: '50%',
          border: '2px solid rgba(255,255,255,0.3)',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
