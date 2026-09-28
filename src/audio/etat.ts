/**
 * Le son est-il voulu, et le moteur qui le joue.
 *
 * Éteint par défaut : un navigateur n'ouvre un `AudioContext` qu'au geste de
 * l'utilisateur, et un musée qui parle sans qu'on le lui demande surprend. Le
 * choix est retenu (localStorage) ; retenu allumé, le son démarre au premier
 * clic ou à la première touche de la visite suivante.
 */
import { create } from 'zustand'

import { MUSEE } from '../plan/musee'
import { parkPlacements, type Parc } from '../plan/park'
import { Moteur } from './moteur'

const CLE = 'museum:son'

function lu(): boolean {
  try {
    return localStorage.getItem(CLE) === '1'
  } catch {
    return false
  }
}

export const useSon = create<{ actif: boolean }>(() => ({ actif: lu() }))

let moteur: Moteur | null = null
let parc: Parc | null = null

/** Le parc, pour le sol sous le pied et les érables où chantent les oiseaux ; calculé au premier son. */
export const parcSonore = () => (parc ??= parkPlacements(MUSEE))

/** Le moteur s'il existe déjà : on ne crée rien hors d'un geste. */
export const moteurCourant = () => moteur

/**
 * Crée (au besoin) et réveille le moteur. À appeler DANS un geste de
 * l'utilisateur : c'est la seule condition pour qu'un navigateur laisse jouer.
 * Rien sans `AudioContext` (jsdom, vieux navigateurs).
 */
export function eveillerSon(): Moteur | null {
  if (typeof AudioContext === 'undefined') return null
  moteur ??= new Moteur(new AudioContext({ latencyHint: 'playback' }), parcSonore().plantations.filter((p) => p.espece.startsWith('erable')))
  void moteur.ctx.resume().catch(() => {})
  return moteur
}

export function basculerSon() {
  const actif = !useSon.getState().actif
  useSon.setState({ actif })
  try {
    localStorage.setItem(CLE, actif ? '1' : '0')
  } catch {
    // Navigation privée stricte : le choix vaut pour la visite, sans plus.
  }
  if (actif) eveillerSon()
}
