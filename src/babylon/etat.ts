/**
 * L'état partagé de la tranche Babylon, sans React (`zustand/vanilla` : les
 * stores de src/stores importent `zustand`, qui tire React) :
 *
 * - `reglages` : les réglages du visiteur (localStorage 'museum:reglages', écrits
 *   par le panneau de three), `recherche()` l'adresse complétée de ces réglages (comme reglagesStore) :
 *   tous les forçages (?heure, ?meteo, ?saison, ?qualite, ?ombres) la lisent.
 * - `vivant` : ciel (soleil, jour 0-1), météo CIBLE (non lissée : voir METEO
 *   d'intemperies.ts) et saison, comme gameStore. `demarrerCycle()` (main.ts)
 *   recalcule le ciel toutes les 30 s et relève Open-Meteo tous les quarts
 *   d'heure (MeteoLayer). Les couches lisent `vivant.getState()` à chaque image
 *   ou s'abonnent (`auCiel(f)` pour le ciel, `auCielMatiere(m, f)` pour régler une matière).
 * - `etat.annonce` : la dernière annonce sonnée par la cloche, que le tableau
 *   des départs affiche (lue par sondage).
 * - `VIVANTES` : les matières que main.ts ne fige pas (leurs textures ou leurs
 *   uniforms changent à chaque image). Une couche y ajoute le NOM d'une matière
 *   avant la fin de `couches` ; une matière réglée par l'heure passe plutôt par `auCielMatiere`.
 * - `catalogue(base)` : data/catalogue.json chargé une fois pour toutes les couches.
 * - `mouvementReduit()` : le « calme » de reglagesStore.
 */
import type { Material } from '@babylonjs/core/Materials/material'
import { createStore } from 'zustand/vanilla'

import config from '../../museum.config.json'
import { CLAIR, meteoDemandee, meteoDuReleve, urlOpenMeteo, type Meteo, type Releve } from '../domain/meteo.ts'
import { lireReglages, mouvementReduitPour, rechercheAvec, type Reglages } from '../domain/reglages.ts'
import { saisonA, type Saison } from '../domain/saisons.ts'
import { cielA, heureDemandee, type Ciel } from '../domain/soleil.ts'
import type { Artwork, Catalogue } from '../domain/types.ts'

/** `at` : Date.now() à l'impact. */
export const etat: { annonce: { key: string; tag: string; at: number } | null } = { annonce: null }

/** La lentille fond, l'atlas des toiles peut se replier. */
export const VIVANTES = new Set(['lentille-allumee', 'toiles'])

let promesse: Promise<(Catalogue & { parCle: Map<string, Artwork> }) | null> | null = null
/** Le catalogue (null s'il manque : chaque couche décide de ce qu'elle montre sans lui). */
export function catalogue(base: string): Promise<(Catalogue & { parCle: Map<string, Artwork> }) | null> {
  promesse ??= fetch(`${base}data/catalogue.json`)
    .then((r) => r.json() as Promise<Catalogue>)
    .then((c) => ({ ...c, parCle: new Map(c.artworks.map((a) => [a.key, a])) }))
    .catch(() => null)
  return promesse
}

const CLE = 'museum:reglages'
const lus = (): Reglages => {
  try {
    return lireReglages(localStorage.getItem(CLE))
  } catch {
    return lireReglages(null)
  }
}
/** Relus au chargement. */
export const reglages = createStore<Reglages>(lus)

/** L'adresse telle que la lisent les forçages : les réglages ajoutés, sans écraser l'adresse. */
export const recherche = (): string => rechercheAvec(typeof location === 'undefined' ? '' : location.search, reglages.getState())

/** Le ciel de maintenant, ou de l'heure forcée (`?heure=`, qui reste fixe). */
export function cielDuMoment(): Ciel {
  const m = new Date()
  return cielA(heureDemandee(recherche(), m) ?? m, config.location.latitude, config.location.longitude)
}

export interface Vivant { ciel: Ciel; meteo: Meteo; saison: Saison }
export const vivant = createStore<Vivant>(() => ({ ciel: cielDuMoment(), meteo: meteoDemandee(recherche()) ?? CLAIR, saison: saisonA(new Date(), recherche()) }))

/**
 * Appelle `f` tout de suite puis à chaque nouveau ciel (le jour qui avance) ;
 * rend le désabonnement. Une matière ainsi réglée après le gel doit être dans
 * VIVANTES (ou passer par le `lier` d'une greffe).
 */
export function auCiel(f: (ciel: Ciel) => void): () => void {
  f(vivant.getState().ciel)
  return vivant.subscribe((s, avant) => s.ciel !== avant.ciel && f(s.ciel))
}

/**
 * `auCiel` pour une matière que `f` règle (intensité, couleur : jamais un
 * define) : elle reste gelable. Gelée, elle est marquée à relier, et chaque
 * maillage qui la porte relit ses valeurs à son prochain dessin, au lieu d'une
 * préparation complète à chaque image (VIVANTES).
 */
export function auCielMatiere(m: Material, f: (ciel: Ciel) => void): () => void {
  return auCiel((c) => {
    f(c)
    if (m.isFrozen) m.markDirty(true)
  })
}

const TRENTE_S = 30_000
const QUART_D_HEURE = 15 * 60_000

/**
 * Le ciel toutes les 30 s (publié seulement s'il a bougé), la météo tous les
 * quarts d'heure : celle de `?meteo=` si elle est forcée, sinon Open-Meteo
 * (sauf en test) ; rend l'arrêt.
 */
export function demarrerCycle(): () => void {
  const cycle = setInterval(() => {
    const c = cielDuMoment()
    const a = vivant.getState().ciel
    if (c.elevation !== a.elevation || c.azimut !== a.azimut) vivant.setState({ ciel: c })
  }, TRENTE_S)
  const abandon = new AbortController()
  const relever = () => {
    const forcee = meteoDemandee(recherche())
    if (forcee) return void vivant.setState({ meteo: forcee })
    if (import.meta.env.MODE === 'test') return
    void fetch(urlOpenMeteo(config.location.latitude, config.location.longitude), { signal: abandon.signal })
      .then((r) => r.json() as Promise<{ current?: Releve }>)
      // Un temps forcé entre-temps l'emporte sur le relevé en vol.
      .then((j) => j.current && !meteoDemandee(recherche()) && vivant.setState({ meteo: meteoDuReleve(j.current) }))
      // Hors ligne : le temps d'avant reste.
      .catch((e: unknown) => abandon.signal.aborted || console.warn('météo indisponible', e))
  }
  relever()
  const releve = setInterval(relever, QUART_D_HEURE)
  return () => {
    clearInterval(cycle)
    clearInterval(releve)
    abandon.abort()
  }
}

/** Mouvement réduit (réglage du musée, sinon la préférence du système). */
export function mouvementReduit(): boolean {
  try {
    return mouvementReduitPour(reglages.getState().mouvement, matchMedia('(prefers-reduced-motion: reduce)').matches)
  } catch {
    return false
  }
}
