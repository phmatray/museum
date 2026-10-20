/**
 * Le son (audio/etat.ts, BoutonSon.tsx, AmbianceSonore.tsx sans React) :
 *
 * - `son` : le son voulu, éteint par défaut (un navigateur n'ouvre un
 *   `AudioContext` qu'au geste de l'utilisateur), retenu dans localStorage ;
 *   retenu allumé, le premier clic ou la première touche de la visite l'éveille.
 * - `monterBoutonSon` : le bouton (et la touche M), que le groupe des réglages accueille.
 * - `monterSon` : nourrit le `Moteur` (audio/moteur.ts, tel quel) de ce que la
 *   scène sait (caméra, allure, sol, Bavette, jour, pluie, heure pleine, annonce)
 *   et le suspend en pause, page cachée ou son coupé.
 * - `sonVolets` (tableau des départs) et `froisser` (hérissons) : ne jouent que s'il y a du son.
 */
import type { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Scene } from '@babylonjs/core/scene'
import { createStore } from 'zustand/vanilla'

import { Moteur } from '../audio/moteur.ts'
import { avancerPas, carillonDu, lieuDe, matiereSous, partitionAnnonce, partitionHeure } from '../domain/son.ts'
import { MUSEE } from '../plan/musee.ts'
import { parkPlacements, type Parc } from '../plan/park.ts'
import { solDuParc } from '../plan/relief.ts'
import type { Walker } from '../plan/walk.ts'
import { BAVETTE } from './bavette.ts'
import { etat, partie, reglages, vivant } from './etat.ts'
import { el, observer, svg } from './ui/dom.ts'
import './son.css'

const CLE = 'museum:son'
const lu = (): boolean => {
  try {
    return localStorage.getItem(CLE) === '1'
  } catch {
    return false
  }
}
export const son = createStore<{ actif: boolean }>(() => ({ actif: lu() }))

let moteur: Moteur | null = null
let parc: Parc | null = null
/** Le parc, pour le sol sous le pied et les érables où chantent les oiseaux ; calculé au premier son. */
const parcSonore = () => (parc ??= parkPlacements(MUSEE))

/** Le son doit s'entendre : voulu, visite en cours (pas en pause, billet compris), page visible. */
const doitJouer = () => son.getState().actif && !partie.getState().paused && document.visibilityState === 'visible'
/** Relance ou suspend le moteur selon `doitJouer` (le geste a déjà débloqué le contexte : la reprise suit). */
const regler = () => {
  if (moteur) void (doitJouer() ? moteur.ctx.resume() : moteur.ctx.suspend()).catch(() => {})
}

/**
 * Crée (au besoin) le moteur DANS un geste de l'utilisateur, qui débloque son contexte, puis le règle :
 * en pause, il reste suspendu jusqu'à l'entrée dans la visite (comme AmbianceSonore). Rien sans `AudioContext` (jsdom).
 */
export function eveillerSon(): Moteur | null {
  if (typeof AudioContext === 'undefined') return null
  if (moteur === null) {
    const m = (moteur = new Moteur(new AudioContext({ latencyHint: 'playback' }), parcSonore().plantations.filter((p) => p.espece.startsWith('erable'))))
    m.volume(reglages.getState().volume)
    reglages.subscribe((r, a) => r.volume !== a.volume && m.volume(r.volume))
  }
  regler()
  return moteur
}

export function basculerSon(): void {
  const actif = !son.getState().actif
  son.setState({ actif })
  try {
    localStorage.setItem(CLE, actif ? '1' : '0')
  } catch { /* navigation privée stricte : le choix vaut pour la visite */ }
  if (actif) eveillerSon()
}

/** Le moteur s'il doit jouer maintenant. */
const jouable = (): Moteur | null => (moteur && son.getState().actif && moteur.ctx.state === 'running' ? moteur : null)

/** Le cliquetis des palettes du tableau des départs, `ms` millisecondes. */
export function sonVolets(ms: number): void {
  if (moteur && son.getState().actif) moteur.volets(ms / 1000)
}

/** Un hérisson froisse l'herbe ; `voix` : 0 le plus proche, 1 le suivant. */
export function froisser(x: number, z: number, force: number, voix: 0 | 1): void {
  jouable()?.froisser([x, solDuParc(x, z) + 0.05, z], force, voix)
}

/** Le bouton du son (non attaché), la touche M, et l'éveil au premier geste si le son est retenu allumé. */
export function monterBoutonSon(): HTMLButtonElement {
  const icone = svg('svg', { width: 18, height: 18, viewBox: '0 0 24 24', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
  const bouton = el('button', { type: 'button', class: 'bouton-son', 'aria-label': 'Son' }, icone, el('span', {}, 'Son'), el('kbd', {}, 'M'))
  // Sinon le clic tombe sur la toile et capture la souris.
  bouton.addEventListener('click', (e) => {
    e.stopPropagation()
    basculerSon()
  })
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) basculerSon()
  })
  const geste = () => eveillerSon()
  observer(son, (s) => s.actif, (actif) => {
    bouton.setAttribute('aria-pressed', String(actif))
    bouton.title = actif ? 'Couper le son (M)' : 'Activer le son (M)'
    icone.replaceChildren(
      svg('path', { d: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4z', fill: 'currentColor', 'fill-opacity': actif ? 0.9 : 0.35 }),
      ...(actif
        ? [svg('path', { d: 'M15.5 9a4 4 0 0 1 0 6', stroke: '#e0b060' }), svg('path', { d: 'M18 6.5a7.5 7.5 0 0 1 0 11', stroke: '#e0b060' })]
        : [svg('path', { d: 'M16 9.5l5 5M21 9.5l-5 5' })]),
    )
    if (actif) {
      window.addEventListener('pointerdown', geste, { once: true })
      window.addEventListener('keydown', geste, { once: true })
    } else {
      window.removeEventListener('pointerdown', geste)
      window.removeEventListener('keydown', geste)
    }
  })
  return bouton
}

const avant = new Vector3()
const haut = new Vector3()

/** L'ambiance sonore de la scène. */
export function monterSon(scene: Scene, camera: FreeCamera & { walker(): Walker }): void {
  // Suspendu dès que rien ne doit s'entendre : en pause, page cachée, son coupé.
  observer(son, (s) => s.actif, regler)
  observer(partie, (s) => s.paused, regler)
  document.addEventListener('visibilitychange', regler)

  const vers = new Vector3(0, 0, scene.useRightHandedSystem ? -1 : 1)
  const f = { phase: 0.7, vitesse: 0, x: NaN, z: NaN, carillon: null as number | null, horloge: 0, annonce: etat.annonce?.at ?? 0 }
  scene.onBeforeRenderObservable.add(() => {
    // Une nouvelle annonce de la cloche (posée sans abonnement : sondée).
    const annonce = etat.annonce?.at ?? 0
    if (annonce !== f.annonce) {
      f.annonce = annonce
      if (moteur && son.getState().actif) moteur.carillon(partitionAnnonce())
    }
    const m = jouable()
    if (!m || partie.getState().paused) return
    const w = camera.walker()
    const delta = scene.getEngine().getDeltaTime() / 1000

    // L'allure, mesurée sur ce que le visiteur a vraiment parcouru ; un saut (téléport) ne compte pas.
    const d = Math.hypot(w.x - f.x, w.z - f.z)
    const v = Number.isFinite(d) && d < 1 ? d / Math.max(delta, 1e-3) : 0
    f.vitesse += (v - f.vitesse) * Math.min(1, delta * 12)
    f.x = w.x
    f.z = w.z
    const p = avancerPas(f.phase, f.vitesse, delta)
    f.phase = p.phase
    if (p.pas) m.pas(matiereSous(w, parcSonore()), f.vitesse > 4.5 ? 1.15 : 1)

    camera.getDirectionToRef(vers, avant)
    camera.getDirectionToRef(Vector3.UpReadOnly, haut)
    const { ciel, meteo } = vivant.getState()
    m.maj({
      position: [camera.position.x, camera.position.y, camera.position.z],
      avant: [avant.x, avant.y, avant.z],
      haut: [haut.x, haut.y, haut.z],
      lieu: lieuDe(w.surface),
      jour: ciel.jour,
      bavette: BAVETTE.monte && BAVETTE.level === w.level ? [BAVETTE.x, w.y + 0.2, BAVETTE.z] : null,
      pluie: meteo.pluie,
    })

    // L'heure pleine, vérifiée une fois par seconde.
    f.horloge += delta
    if (f.horloge >= 1) {
      f.horloge = 0
      const c = carillonDu(new Date(), f.carillon)
      if (c) {
        f.carillon = c.cle
        m.carillon(partitionHeure(c.coups))
      }
    }
  })
}
