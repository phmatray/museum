/**
 * Les contrôles tactiles (MobileControls.tsx, #31) : la moitié gauche de
 * l'écran est un joystick de marche, la droite un glissé de regard. Rien n'est
 * décidé ici : les deux gestes s'écrivent dans `toucher`, que visiteur.ts lit
 * (lissage, 0,002 rad/px, reprise de la main, ignoré en pause). Présent
 * seulement sous un pointeur grossier (useIsMobile), et jamais en VR : un
 * tapotement Cardboard ne doit pas devenir un pas de joystick.
 *
 * Le joystick est flottant : sa base naît sous le pouce et le suit au-delà du
 * débattement (revenir en arrière répond aussitôt) ; une zone morte et une
 * courbe douce donnent les petits pas sans à-coup.
 */
import { partie, toucher } from '../etat.ts'
import { el, observer } from './dom.ts'
import './mobile.css'

/** Pixels de débattement pour un joystick à fond. */
const RAYON_JOYSTICK = 50
/** Part du débattement ignorée (le pouce posé tremble). */
const ZONE_MORTE = 0.12

/** Le vecteur du pouce (en rayons) → la marche : zone morte puis courbe (petits gestes = petits pas). */
export function inclinaison(dx: number, dy: number): { strafe: number; forward: number } {
  const l = Math.hypot(dx, dy)
  if (l <= ZONE_MORTE) return { strafe: 0, forward: 0 }
  const n = Math.min(1, (l - ZONE_MORTE) / (1 - ZONE_MORTE))
  const f = (n * n * (3 - 2 * n)) / l // smoothstep : doux au départ, franc à fond
  return { strafe: dx * f, forward: -dy * f } // doigt vers le haut = avancer
}

/** Monte la surcouche tactile ; rend le démontage (qui relâche le joystick). */
export function monterMobile(racine: HTMLElement = document.body): () => void {
  const bouton = el('div', { class: 'joystick-bouton' })
  const base = el('div', { class: 'joystick', hidden: true }, bouton)
  const couche = el('div', { class: 'tactile' }, base)
  racine.append(couche)
  let joystick: { id: number; x: number; y: number } | null = null
  const regards = new Map<number, { x: number; y: number }>()
  const lacher = () => {
    joystick = null
    base.hidden = true
    toucher.forward = toucher.strafe = 0
  }
  // Masqué doigt posé (un clavier branché, la VR) : le joystick ne doit pas rester enfoncé.
  const relacher = () => {
    lacher()
    regards.clear()
  }

  couche.addEventListener('touchstart', (e) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX < window.innerWidth / 2 && !joystick) {
        joystick = { id: t.identifier, x: t.clientX, y: t.clientY }
        base.style.transform = `translate(${t.clientX}px, ${t.clientY}px)`
        bouton.style.transform = ''
        base.hidden = false
      } else regards.set(t.identifier, { x: t.clientX, y: t.clientY })
    }
  }, { passive: true })
  couche.addEventListener('touchmove', (e) => {
    for (const t of Array.from(e.changedTouches)) {
      if (joystick && t.identifier === joystick.id) {
        let dx = t.clientX - joystick.x
        let dy = t.clientY - joystick.y
        const l = Math.hypot(dx, dy)
        if (l > RAYON_JOYSTICK) {
          // La base suit le pouce : le bouton reste au bord, l'origine glisse derrière.
          joystick.x += (dx * (l - RAYON_JOYSTICK)) / l
          joystick.y += (dy * (l - RAYON_JOYSTICK)) / l
          dx = t.clientX - joystick.x
          dy = t.clientY - joystick.y
          base.style.transform = `translate(${joystick.x}px, ${joystick.y}px)`
        }
        bouton.style.transform = `translate(${dx}px, ${dy}px)`
        Object.assign(toucher, inclinaison(dx / RAYON_JOYSTICK, dy / RAYON_JOYSTICK))
        continue
      }
      const avant = regards.get(t.identifier)
      if (!avant) continue
      toucher.lookX += t.clientX - avant.x
      toucher.lookY += t.clientY - avant.y
      regards.set(t.identifier, { x: t.clientX, y: t.clientY })
    }
  }, { passive: true })
  const fin = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === joystick?.id) lacher()
      regards.delete(t.identifier)
    }
  }
  couche.addEventListener('touchend', fin)
  couche.addEventListener('touchcancel', fin)

  const mq = window.matchMedia('(pointer: coarse)')
  let mobile = mq.matches
  const montrer = () => {
    couche.hidden = !mobile || partie.getState().enVR
    if (couche.hidden) relacher()
  }
  const changer = (e: MediaQueryListEvent) => { mobile = e.matches; montrer() }
  mq.addEventListener('change', changer)
  const finVR = observer(partie, (s) => s.enVR, montrer)

  return () => {
    finVR()
    mq.removeEventListener('change', changer)
    couche.remove()
    relacher()
  }
}
