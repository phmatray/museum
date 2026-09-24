/**
 * Les contrôles tactiles (#31) : la moitié gauche de l'écran est un joystick
 * de marche, la droite un glissé de regard. Rien n'est décidé ici — les deux
 * gestes s'écrivent dans `toucher`, que `PlanPlayer` passe au même `step()`
 * que le clavier.
 */
import { useRef } from 'react'
import { toucher } from '../stores/gameStore'

/** Pixels de débattement pour un joystick à fond. */
const RAYON_JOYSTICK = 50

const cercle = (cote: 'left' | 'right'): React.CSSProperties => ({
  position: 'absolute',
  [cote]: '10%',
  bottom: '15%',
  width: 120,
  height: 120,
  borderRadius: '50%',
  border: '2px solid rgba(255,255,255,0.3)',
  pointerEvents: 'none',
})

export function MobileControlsOverlay() {
  const joystick = useRef<{ id: number; x: number; y: number } | null>(null)
  const regards = useRef(new Map<number, { x: number; y: number }>())

  const debut = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX < window.innerWidth / 2 && !joystick.current) {
        joystick.current = { id: t.identifier, x: t.clientX, y: t.clientY }
      } else {
        regards.current.set(t.identifier, { x: t.clientX, y: t.clientY })
      }
    }
  }

  const glisse = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      const j = joystick.current
      if (j && t.identifier === j.id) {
        const dx = (t.clientX - j.x) / RAYON_JOYSTICK
        const dy = (t.clientY - j.y) / RAYON_JOYSTICK
        const l = Math.max(1, Math.hypot(dx, dy))
        toucher.strafe = dx / l
        toucher.forward = -dy / l // doigt vers le haut = avancer
        continue
      }
      const avant = regards.current.get(t.identifier)
      if (!avant) continue
      toucher.lookX += t.clientX - avant.x
      toucher.lookY += t.clientY - avant.y
      regards.current.set(t.identifier, { x: t.clientX, y: t.clientY })
    }
  }

  const fin = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === joystick.current?.id) {
        joystick.current = null
        toucher.forward = toucher.strafe = 0
      }
      regards.current.delete(t.identifier)
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, touchAction: 'none' }}
      onTouchStart={debut}
      onTouchMove={glisse}
      onTouchEnd={fin}
      onTouchCancel={fin}
    >
      <div style={cercle('left')} />
      <div style={cercle('right')} />
    </div>
  )
}
