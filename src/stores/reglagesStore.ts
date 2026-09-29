/**
 * Les réglages du visiteur (`domain/reglages.ts`), retenus dans localStorage.
 *
 * `recherche()` est l'adresse que lisent les forçages (`?heure=`, `?meteo=`…) :
 * celle du navigateur, complétée des réglages. Qui lisait `location.search`
 * pour un forçage la lit ici.
 */
import { create } from 'zustand'

import { ecrireReglages, lireReglages, mouvementReduitPour, rechercheAvec, type Reglages } from '../domain/reglages'

const CLE = 'museum:reglages'

function lu(): Reglages {
  try {
    return lireReglages(localStorage.getItem(CLE))
  } catch {
    return lireReglages(null)
  }
}

export const useReglages = create<Reglages>(lu)

export function changerReglages(p: Partial<Reglages>) {
  useReglages.setState(p)
  try {
    localStorage.setItem(CLE, ecrireReglages(useReglages.getState()))
  } catch {
    // Navigation privée stricte : les réglages valent pour la visite.
  }
}

export const recherche = () => (typeof location === 'undefined' ? '' : rechercheAvec(location.search, useReglages.getState()))

const prefereReduit = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Le mouvement est-il à réduire, maintenant (hors React). */
export const mouvementReduit = () => mouvementReduitPour(useReglages.getState().mouvement, prefereReduit())

/** Le même, suivi : la scène se calme (ou repart) dès qu'on change le réglage. */
export const useCalme = () => useReglages((s) => mouvementReduitPour(s.mouvement, prefereReduit()))
