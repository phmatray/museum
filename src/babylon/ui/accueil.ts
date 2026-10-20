/**
 * L'accueil (PointerLockOverlay.tsx, sans React) : le billet d'entrée, affiché
 * tant que la visite est en pause, et le bouton « Quitter la visite » pendant
 * la visite guidée. Orsay était une gare : on entre en compostant son billet.
 *
 * Le billet est imprimé du vrai musée (`domain/billet.ts`) : l'accrochage (lu
 * plus tard que le montage, relu à chaque changement de `partie` en pause),
 * les vitrines du catalogue, l'heure figée au montage, le numéro du compteur.
 * Le verrou du pointeur et sa perte (Échap) restent à visiteur.ts.
 * ponytail : pas de bouton VR, la VR Babylon n'est pas portée (entrerEnVR fermerait la session).
 */
import '@fontsource/marcellus/latin-400.css'
import '@fontsource/marcellus/latin-ext-400.css'
import '@fontsource/source-sans-3/latin-400.css'
import '@fontsource/source-sans-3/latin-600.css'
import '@fontsource/source-sans-3/latin-ext-400.css'
import './accueil.css'

import config from '../../../museum.config.json'
import { billet } from '../../domain/billet.ts'
import { heureDemandee } from '../../domain/soleil.ts'
import { laVisite } from '../../io/visite.ts'
import type { Accrochage } from '../../plan/hang.ts'
import { choisirVitrines } from '../../plan/vitrines.ts'
import { catalogue, mouvementReduit, partie, recherche } from '../etat.ts'
import { el, observer } from './dom.ts'

/** Le coup de composteur, la lecture du tampon, l'effacement du billet (ms). */
const COUP = 260
const LECTURE = 380
const EFFACEMENT = 520

/** Monte le billet et le bouton de sortie de visite ; rend le démontage (tests). */
export function monterAccueil(racine: HTMLElement, toile: HTMLCanvasElement, o: { accrochage: () => Accrochage | null; base: string }): () => void {
  const quand = heureDemandee(recherche(), new Date()) ?? new Date()
  const doigt = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  let visite: number | null = null
  let vitrines = 0
  let sortie: 'entree' | 'visite' | null = null

  const dl = el('dl')
  const absent = el('p', { class: 'billet-absent', hidden: true })
  const numero = el('span', { class: 'numero' })
  const heureTampon = el('span')
  const texteTampon = document.createTextNode('Composté')
  const tampon = el('div', { class: 'billet-tampon', 'aria-hidden': 'true' }, texteTampon, heureTampon)
  const bEntrer = el('button', { type: 'button', class: 'billet-entrer', autofocus: true }, 'Composter et entrer')
  const bGuide = el('button', { type: 'button', class: 'billet-guide' }, 'Visite guidée')
  const consignes = doigt
    ? el('p', { class: 'billet-consignes' }, 'Pouce gauche pour marcher, glisser à droite pour regarder, toucher le plan pour l’agrandir.')
    : el('p', { class: 'billet-consignes' },
      el('kbd', {}, 'Z'), el('kbd', {}, 'Q'), el('kbd', {}, 'S'), el('kbd', {}, 'D'), ' ou flèches pour marcher, ',
      el('kbd', {}, 'Maj'), ' pour presser le pas, ', el('kbd', {}, 'Espace'), ' pour sauter, la souris pour regarder, ',
      el('kbd', {}, 'Échap'), ' pour la pause.')
  const article = el('article', { class: 'billet', 'aria-labelledby': 'billet-titre' },
    el('div', { class: 'billet-corps' },
      el('header', {},
        el('h1', { id: 'billet-titre' }, config.name),
        el('p', { class: 'billet-accroche' }, 'Les projets GitHub de Philippe Matray, accrochés comme des tableaux dans une ancienne gare.')),
      dl, absent,
      el('div', { class: 'billet-actions' }, bEntrer, bGuide),
      consignes),
    el('aside', { class: 'billet-talon', 'aria-label': 'Talon du billet' },
      el('div', {}, el('div', { class: 'entree' }, 'ENTRÉE'), el('p', { class: 'tarif' }, '1 personne · gratuit')),
      el('div', { class: 'billet-compostage' }, 'Compostage'),
      el('div', {}, el('span', { class: 'no' }, 'Visiteur n°'), numero),
      tampon))
  // Repère stable pour un navigateur piloté, qui escamote cet écran avant de mesurer la scène.
  const voile = el('div', { 'data-museum-overlay': 'accueil', class: 'billet-voile' }, article)
  const quitter = el('button', { type: 'button', class: 'visite-quitter', hidden: true }, 'Quitter la visite (Échap) · ou marchez pour reprendre la main')
  racine.append(voile, quitter)

  /** Réimprime les lignes du billet (accrochage, vitrines, rendez-vous, numéro). */
  const imprimer = () => {
    const lignes = billet(o.accrochage(), vitrines, quand, visite)
    const rdv = partie.getState().rendezVous
    const lignesDl: [string, string, string?][] = []
    if (rdv?.cle) lignesDl.push(['Destination', rdv.cle.slice(rdv.cle.indexOf('/') + 1), 'destination'])
    if (lignes.collection) lignesDl.push(['Collection', `${lignes.collection}, un jardin, un chat`])
    lignesDl.push(['Date', lignes.jour], ['Heure', lignes.heure])
    dl.replaceChildren(...lignesDl.flatMap(([t, d, c]) => [el('dt', {}, t), el('dd', { class: c }, d)]))
    absent.hidden = !(rdv && rdv.cle === null)
    absent.textContent = rdv ? `« ${rdv.demande} » n’est pas exposé ici : la visite commence à l’entrée.` : ''
    numero.textContent = lignes.numero
    heureTampon.textContent = lignes.heure
  }
  imprimer()
  let monte = true
  void laVisite().then((n) => { if (monte) { visite = n; imprimer() } })
  void catalogue(o.base).then((c) => { if (monte && c) { vitrines = choisirVitrines(c.artworks, c.owners).length; imprimer() } })

  const entrer = (comment: 'entree' | 'visite') => {
    if (sortie) return
    // Le verrou part du geste lui-même ; absent sur iPhone, refusé au toucher : la visite démarre quand même.
    if (comment === 'entree') Promise.resolve(toile.requestPointerLock?.()).catch(() => {})
    sortie = comment
    texteTampon.data = comment === 'visite' ? 'Visite guidée' : 'Composté'
    voile.setAttribute('data-sortie', '')
    article.setAttribute('data-composte', '')
    setTimeout(() => {
      // Le billet se réimprime pour la prochaine pause (Échap).
      sortie = null
      voile.removeAttribute('data-sortie')
      article.removeAttribute('data-composte')
      if (monte) partie.setState(comment === 'visite' ? { tourActive: true, paused: false } : { paused: false })
    }, mouvementReduit() ? 0 : COUP + LECTURE + EFFACEMENT * 0.7)
  }
  bEntrer.addEventListener('click', () => entrer('entree'))
  bGuide.addEventListener('click', () => entrer('visite'))
  const finVisite = () => partie.setState({ tourActive: false, paused: true })
  quitter.addEventListener('click', finVisite)

  const touche = (e: KeyboardEvent) => {
    const { paused, tourActive } = partie.getState()
    // Entrée sur un bouton suit déjà son clic natif.
    if (paused && e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) entrer('entree')
    // Pendant la visite le pointeur n'est pas verrouillé : Échap n'arrive pas par pointerlockchange.
    else if (tourActive && e.key === 'Escape') finVisite()
  }
  addEventListener('keydown', touche)

  const fins = [
    observer(partie, (s) => s.paused, (v) => {
      voile.hidden = !v
      if (v) bEntrer.focus()
    }),
    observer(partie, (s) => s.tourActive, (v) => { quitter.hidden = !v }),
    // L'accrochage et le rendez-vous arrivent après le montage : le billet en pause les relit.
    partie.subscribe((s) => { if (s.paused) imprimer() }),
  ]
  return () => {
    monte = false
    removeEventListener('keydown', touche)
    for (const f of fins) f()
    voile.remove()
    quitter.remove()
  }
}
