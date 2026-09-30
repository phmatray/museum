/**
 * Le journal de chantier lu comme des données (`public/data/chantier.json`,
 * écrit par `tools/chantier.ts`) : la salle du chantier l'accroche, la carte
 * d'étape le raconte. Chargé une fois ; sans lui, la baraque reste vide.
 */
import { useEffect, useState } from 'react'

import type { Journal } from '../domain/journal'
import { suivre } from '../stores/chargementStore'

let journal: Promise<Journal | null> | null = null

function charger() {
  // Suivi par l'écran de chargement : les cadres sont montés avant la compilation des shaders (`chargement.tsx`).
  journal ??= suivre(fetch(`${import.meta.env.BASE_URL}data/chantier.json`))
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<Journal>
    })
    .catch((erreur: unknown) => {
      console.error('chantier.json indisponible', erreur)
      return null
    })
  return journal
}

/** `actif` faux : rien ne se charge encore (la carte attend qu'on regarde un cadre). */
export function useJournal(actif = true): Journal | null {
  const [j, setJ] = useState<Journal | null>(null)
  useEffect(() => {
    if (!actif) return
    let vivant = true
    void charger().then((c) => vivant && setJ(c))
    return () => {
      vivant = false
    }
  }, [actif])
  return j
}

/** L'adresse d'un fichier du journal publié (`dist/journal/`, servi en dév par `vite.config.ts`). */
export const adresseJournal = (chemin = '') => `${import.meta.env.BASE_URL}journal/${chemin}`

/** Les couleurs des catégories du journal : des teintes du musée, pierre, sang de bœuf, mousse… */
export const TEINTE_CATEGORIE: Record<string, string> = {
  hall: '#b08d57',
  galeries: '#9a3b2c',
  jardin: '#5f7d3a',
  bavette: '#c47a36',
  ambiance: '#3e5c86',
  site: '#6b6660',
  idees: '#7d5f93',
}
export const teinteCategorie = (c: string) => TEINTE_CATEGORIE[c] ?? '#6b6660'
