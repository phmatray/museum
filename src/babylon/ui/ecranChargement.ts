/**
 * L'écran de chargement (components/EcranChargement.tsx) : la visite ne s'ouvre
 * qu'une fois le musée monté en entier (chargement.ts compte ce que main.ts attend).
 *
 * L'horloge de la gare sert de cadran : l'aiguille des minutes fait le tour
 * pendant que la barre dorée avance ; prêt, fondu vers l'accueil. Au-delà de
 * 20 s sans qu'un seul élément n'arrive, on lève le rideau quand même. Un
 * navigateur piloté qui reprend la visite (`__BABYLON__.reprendre`) ou
 * verrouille le pointeur l'escamote aussi.
 */
import config from '../../../museum.config.json'
import { avancer, chargement, marquerPret } from '../chargement.ts'
import { mouvementReduit, partie } from '../etat.ts'
import { el, observer, svg } from './dom.ts'
import './ecranChargement.css'

const OR = '#d1a54a'
const CREME = '#f5eedc'
const NUIT = '#1c2530'
/** Sans nouvelle arrivée pendant ce temps, on n'attend plus (ms). */
const PATIENCE = 20000
/** La durée du fondu vers l'accueil (ms). */
const FONDU = 700

/** Le total du dernier chargement complet, mémorisé ; à défaut, l'ordre de grandeur du musée Babylon (~34 suivis, main.ts). */
const CLE_TOTAL = 'musee:total-chargement-babylon'
const TOTAL_PAR_DEFAUT = 34
function totalAttendu(): number {
  try {
    return Number(localStorage.getItem(CLE_TOTAL)) || TOTAL_PAR_DEFAUT
  } catch {
    return TOTAL_PAR_DEFAUT
  }
}

export function monterEcranChargement(racine: HTMLElement): void {
  const calme = mouvementReduit()
  const attendu = totalAttendu()
  const heure = svg('line', { x1: 32, y1: 32, x2: 32, y2: 20, 'stroke-width': 5 })
  const minute = svg('line', { x1: 32, y1: 32, x2: 32, y2: 14, 'stroke-width': 3.5 })
  const etape = el('p', { class: 'etape' })
  const remplie = el('div')
  const barre = el('div', { role: 'progressbar', 'aria-label': 'Chargement du musée', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 }, remplie)
  const compteur = el('p', { class: 'compteur' })
  const ecran = el(
    'div',
    { 'data-museum-overlay': 'chargement', 'aria-busy': 'true', style: calme ? 'transition:none' : null },
    svg(
      'svg',
      { viewBox: '0 0 64 64', width: 84, height: 84, 'aria-hidden': 'true' },
      svg('circle', { cx: 32, cy: 32, r: 25, fill: CREME, stroke: OR, 'stroke-width': 4 }),
      svg(
        'g',
        { fill: NUIT },
        svg('rect', { x: 30, y: 10.5, width: 4, height: 6, rx: 1 }),
        svg('rect', { x: 30, y: 47.5, width: 4, height: 6, rx: 1 }),
        svg('rect', { x: 10.5, y: 30, width: 6, height: 4, rx: 1 }),
        svg('rect', { x: 47.5, y: 30, width: 6, height: 4, rx: 1 }),
      ),
      svg('g', { stroke: NUIT, 'stroke-linecap': 'round' }, heure, minute),
      svg('circle', { cx: 32, cy: 32, r: 2.6, fill: OR }),
    ),
    el('h1', {}, config.name),
    etape,
    barre,
    compteur,
  )
  racine.append(ecran)

  // La barre suit la cible en douceur, sans jamais reculer.
  let affiche = 0
  let parti = false
  let avant = performance.now()
  requestAnimationFrame(function image(t) {
    if (parti) return
    const { faits, total, etape } = chargement.getState()
    affiche = avancer(affiche, faits, total, etape, (t - avant) / 1000, !calme, attendu)
    avant = t
    const minutes = affiche * 360
    heure.setAttribute('transform', `rotate(${minutes / 12} 32 32)`)
    minute.setAttribute('transform', `rotate(${minutes} 32 32)`)
    barre.setAttribute('aria-valuenow', String(Math.round(affiche * 100)))
    remplie.style.width = `${affiche * 100}%`
    requestAnimationFrame(image)
  })

  let patience: ReturnType<typeof setTimeout> | undefined
  const fins: (() => void)[] = []
  const partir = () => {
    parti = true
    ecran.remove()
    fins.forEach((f) => f())
    document.removeEventListener('pointerlockchange', montrer)
  }
  fins.push(
    observer(chargement, (s) => [s.faits, s.total, s.etape], ([faits, total, e]) => {
      const pret = e === 'pret'
      etape.textContent = e === 'chargement' ? 'Le musée s’installe' : 'Dernières retouches'
      compteur.textContent = total === 0 ? '…' : `${Math.min(faits as number, total as number)} / ${total}`
      ecran.setAttribute('aria-busy', String(!pret))
      clearTimeout(patience)
      if (!pret) {
        patience = setTimeout(() => {
          console.warn(`museum: chargement bloqué à ${faits}/${total} depuis ${PATIENCE / 1000} s, on ouvre quand même`)
          marquerPret()
        }, PATIENCE)
        return
      }
      try {
        localStorage.setItem(CLE_TOTAL, String(total))
      } catch {
        // Stockage refusé (navigation privée) : la prochaine fois, l'ordre de grandeur.
      }
      setTimeout(partir, calme ? 0 : FONDU)
    }),
  )
  // Escamoté hors pause ou pointeur verrouillé ; il revient si la pause revient avant le départ.
  const montrer = () => (ecran.hidden = !partie.getState().paused || document.pointerLockElement != null)
  document.addEventListener('pointerlockchange', montrer)
  fins.push(observer(partie, (s) => s.paused, montrer))
}
