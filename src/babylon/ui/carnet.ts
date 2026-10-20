/**
 * Le carnet de tampons (domain/succes.ts, babylon/succes.ts) : le carnet ouvert
 * (un <dialog> du papier du billet, touche C ou le bouton du groupe des réglages)
 * et l'annonce d'un tampon frappé, en haut de l'écran.
 *
 * Ouvert pendant la marche, il rend la souris comme les réglages ; refermé d'un
 * clic, il la reprend. Les tampons manquants ne montrent que leur indice, et
 * leur avancée quand il y a un compte (3 / 5 salles).
 */
import './carnet.css'

import { SUCCES, merite, type Famille, type Succes } from '../../domain/succes.ts'
import { partie } from '../etat.ts'
import { auTampon, carnet } from '../succes.ts'
import { el, svg } from './dom.ts'

const FAMILLES: Famille[] = ['Découverte', 'Regard', 'Temps et monde', 'Secrets']
/** Une annonce reste lisible ce temps-là (ms) ; les suivantes attendent leur tour. */
const ANNONCE = 4200

const dateCourte = (iso: string) => {
  const [a, m, j] = iso.split('-').map(Number)
  return new Date(a, m - 1, j).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Le décompte affiché partout : « 7 / 23 ». */
export const compteDuCarnet = (): [number, number] => [Object.keys(carnet.getState().carnet.tampons).filter((id) => SUCCES.some((s) => s.id === id)).length, SUCCES.length]

/** Le tampon violet d'un succès obtenu (aussi celui de l'annonce). */
const empreinte = (s: Succes, date?: string) =>
  el('div', { class: 'tampon-empreinte', 'aria-hidden': 'true' }, el('span', { class: 'tampon-titre' }, s.titre), date ? el('span', { class: 'tampon-date' }, dateCourte(date)) : null)

let ouvrirCarnet: () => void = () => {}
/** Ouvre le carnet (le billet de la pause en a un bouton). */
export const ouvrir = (): void => ouvrirCarnet()

/** Monte le carnet et ses annonces ; rend le bouton à poser dans le groupe des réglages. */
export function monterCarnet(racine: HTMLElement, toile: HTMLCanvasElement): HTMLButtonElement {
  const compte = el('p', { class: 'carnet-compte' })
  const pages = el('div', { class: 'carnet-pages' })
  const fermer = el('button', { type: 'button', class: 'carnet-fermer', 'aria-label': 'Fermer le carnet' },
    svg('svg', { width: 18, height: 18, viewBox: '0 0 24 24', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' },
      svg('path', { d: 'M6 6l12 12M18 6L6 18' })))
  const dialogue = el('dialog', { class: 'carnet', 'aria-labelledby': 'carnet-titre' },
    el('header', {}, el('div', {}, el('h2', { id: 'carnet-titre' }, 'Carnet de visite'), compte), fermer),
    pages)
  const annonce = el('div', { class: 'tampon-annonce', role: 'status', 'aria-live': 'polite', hidden: true })
  racine.append(dialogue, annonce)

  const remplir = () => {
    const { carnet: c, contexte } = carnet.getState()
    const [n, total] = compteDuCarnet()
    compte.textContent = `${n} / ${total} tampons`
    pages.replaceChildren(...FAMILLES.map((f) => el('section', { 'aria-label': f },
      el('h3', {}, f),
      el('ul', {}, ...SUCCES.filter((s) => s.famille === f).map((s) => {
        const date = c.tampons[s.id]
        if (date) return el('li', { class: 'case obtenue' }, empreinte(s, date), el('p', {}, el('span', { class: 'lecteur' }, `${s.titre}, obtenu le ${dateCourte(date)}. `), s.texte))
        const [fait, but] = s.progres(c, contexte)
        return el('li', { class: 'case' },
          el('div', { class: 'case-vide', 'aria-hidden': 'true' }, '?'),
          el('p', {}, el('span', { class: 'lecteur' }, 'Tampon manquant. '), s.indice,
            but > 1 && !merite(s, c, contexte) ? el('span', { class: 'avancee' }, ` ${fait} / ${but}`) : null))
      })))))
  }

  let reprendre = false
  ouvrirCarnet = () => {
    if (dialogue.open) return
    reprendre = !!document.pointerLockElement
    if (reprendre) document.exitPointerLock()
    remplir()
    dialogue.showModal()
    fermer.focus()
  }
  const refermer = (geste: boolean) => {
    if (!dialogue.open) return
    dialogue.close()
    if (reprendre && geste) {
      // Le clic qui referme est un geste : le navigateur rend la souris.
      Promise.resolve(toile.requestPointerLock?.()).catch(() => {})
      partie.setState({ paused: false })
    }
    reprendre = false
  }
  fermer.addEventListener('click', () => refermer(true))
  // Échap (natif) referme sans geste rendu : on retrouve le billet de la pause.
  dialogue.addEventListener('cancel', (e) => { e.preventDefault(); refermer(false) })
  // Un clic sur le fond (hors du papier) referme aussi.
  dialogue.addEventListener('click', (e) => { if (e.target === dialogue) refermer(true) })
  addEventListener('keydown', (e) => {
    if (e.code !== 'KeyC' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target instanceof HTMLInputElement) return
    if (dialogue.open) refermer(true)
    else ouvrirCarnet()
  })
  carnet.subscribe(() => { if (dialogue.open) remplir() })

  // Les annonces, une à la fois.
  const file: Succes[] = []
  let enCours = false
  const suivante = () => {
    const s = file.shift()
    if (!s) {
      enCours = false
      annonce.hidden = true
      return
    }
    enCours = true
    annonce.replaceChildren(empreinte(s), el('div', {}, el('strong', {}, 'Tampon obtenu'), el('span', {}, s.texte)))
    annonce.hidden = false
    // Relancer l'animation du coup de tampon à chaque annonce.
    annonce.classList.remove('frappe')
    void annonce.offsetWidth
    annonce.classList.add('frappe')
    setTimeout(suivante, ANNONCE)
  }
  auTampon((s) => {
    file.push(s)
    if (!enCours) suivante()
  })

  const bouton = el('button', { type: 'button', class: 'reglages-bouton', 'aria-label': 'Carnet de visite', title: 'Carnet de visite (C)' },
    svg('svg', { width: 18, height: 18, viewBox: '0 0 24 24', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
      svg('path', { d: 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z' }),
      svg('path', { d: 'M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3' }),
      svg('circle', { cx: 12, cy: 10, r: 3 })))
  bouton.addEventListener('click', (e) => {
    e.stopPropagation()
    ouvrirCarnet()
  })
  return bouton
}
