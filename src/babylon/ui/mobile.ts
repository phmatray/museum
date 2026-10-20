/**
 * Les contrôles tactiles (MobileControls.tsx, #31) : la moitié gauche de
 * l'écran est un joystick de marche, la droite un glissé de regard. Rien n'est
 * décidé ici : les deux gestes s'écrivent dans `toucher`, que visiteur.ts lit
 * (bornage, 0,002 rad/px, reprise de la main, ignoré en pause). Présent
 * seulement sous un pointeur grossier (useIsMobile) ; la VR Babylon n’est pas portée.
 */
import { toucher } from '../etat.ts'
import { el } from './dom.ts'

/** Pixels de débattement pour un joystick à fond. */
const RAYON_JOYSTICK = 50

const cercle = (cote: 'left' | 'right') =>
  el('div', { style: `position:absolute;${cote}:10%;bottom:15%;width:120px;height:120px;border-radius:50%;border:2px solid rgba(255,255,255,0.3);pointer-events:none` })

/** Monte la surcouche tactile ; rend le démontage (qui relâche le joystick). */
export function monterMobile(racine: HTMLElement = document.body): () => void {
  const couche = el('div', { style: 'position:fixed;inset:0;z-index:100;touch-action:none' }, cercle('left'), cercle('right'))
  racine.append(couche)
  let joystick: { id: number; x: number; y: number } | null = null
  const regards = new Map<number, { x: number; y: number }>()
  // Masqué doigt posé (un clavier branché, la VR) : le joystick ne doit pas rester enfoncé.
  const relacher = () => {
    joystick = null
    regards.clear()
    toucher.forward = toucher.strafe = 0
  }

  couche.addEventListener('touchstart', (e) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX < window.innerWidth / 2 && !joystick) joystick = { id: t.identifier, x: t.clientX, y: t.clientY }
      else regards.set(t.identifier, { x: t.clientX, y: t.clientY })
    }
  })
  couche.addEventListener('touchmove', (e) => {
    for (const t of Array.from(e.changedTouches)) {
      if (joystick && t.identifier === joystick.id) {
        const dx = (t.clientX - joystick.x) / RAYON_JOYSTICK
        const dy = (t.clientY - joystick.y) / RAYON_JOYSTICK
        const l = Math.max(1, Math.hypot(dx, dy))
        toucher.strafe = dx / l
        toucher.forward = -dy / l // doigt vers le haut = avancer
        continue
      }
      const avant = regards.get(t.identifier)
      if (!avant) continue
      toucher.lookX += t.clientX - avant.x
      toucher.lookY += t.clientY - avant.y
      regards.set(t.identifier, { x: t.clientX, y: t.clientY })
    }
  })
  const fin = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === joystick?.id) {
        joystick = null
        toucher.forward = toucher.strafe = 0
      }
      regards.delete(t.identifier)
    }
  }
  couche.addEventListener('touchend', fin)
  couche.addEventListener('touchcancel', fin)

  const mq = window.matchMedia('(pointer: coarse)')
  let mobile = mq.matches
  const montrer = () => {
    couche.hidden = !mobile
    if (couche.hidden) relacher()
  }
  const changer = (e: MediaQueryListEvent) => { mobile = e.matches; montrer() }
  mq.addEventListener('change', changer)
  montrer()

  return () => {
    mq.removeEventListener('change', changer)
    couche.remove()
    relacher()
  }
}
