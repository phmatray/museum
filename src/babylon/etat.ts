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
 * - `catalogue(base)` : data/catalogue.json chargé une fois pour toutes les couches ; `readme(base, cle)`
 *   le README d'un dépôt des vitrines, une fois par clé (panneaux de vitrines.ts, carte de la borne).
 * - `mouvementReduit()` : le « calme » de reglagesStore.
 * - `partie` : l'état de l'interface de la vague 5 (gameStore) : pause, visite guidée,
 *   rendez-vous de `?p=`, visiteur publié (minimap), ce que le regard désigne (toile,
 *   borne, Bavette, étape du journal). `publier(partie, p)` n'écrit que ce qui change
 *   (sûr à chaque image). `toucher` : le joystick et le glissé du doigt, mutables.
 *   `enVR` : une session VR ouverte (vr.ts) ; `vrEntree` : ce que les manettes ou le
 *   Cardboard demandent à la marche, et la vignette de confort, mutables (gameStore.vrEntree).
 * - `changerReglages(p)` : écrit les réglages (et localStorage) ; `demarrerCycle`
 *   republie alors le ciel, la saison et la météo s'ils en dépendent.
 */
import type { Material } from '@babylonjs/core/Materials/material'
import { createStore } from 'zustand/vanilla'

import config from '../../museum.config.json'
import { CLAIR, meteoDemandee, meteoDuReleve, urlOpenMeteo, type Meteo, type Releve } from '../domain/meteo.ts'
import { ecrireReglages, lireReglages, mouvementReduitPour, rechercheAvec, type Reglages } from '../domain/reglages.ts'
import { saisonA, type Saison } from '../domain/saisons.ts'
import { cielA, heureDemandee, type Ciel } from '../domain/soleil.ts'
import type { Artwork, Catalogue } from '../domain/types.ts'
import { cheminReadme } from '../plan/vitrines.ts'
import type { Walker } from '../plan/walk.ts'

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

const readmes = new Map<string, Promise<string | null>>()
/** Le README d'un dépôt des vitrines, une fois par clé ; null s'il manque. */
export function readme(base: string, cle: string): Promise<string | null> {
  let p = readmes.get(cle)
  if (!p) readmes.set(cle, (p = fetch(`${base}${cheminReadme(cle)}`).then((r) => (r.ok ? r.text() : null)).catch(() => null)))
  return p
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

/** Les réglages changés, retenus sur cet appareil (navigation privée : en mémoire seulement). */
export function changerReglages(p: Partial<Reglages>): void {
  reglages.setState(p)
  try {
    localStorage.setItem(CLE, ecrireReglages(reglages.getState()))
  } catch { /* stockage refusé */ }
}

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
  // Le panneau des réglages : l'heure et la saison choisies tout de suite, la météo relevée à nouveau.
  const desabonner = reglages.subscribe((r, a) => {
    if (r.heure !== a.heure || r.saison !== a.saison) vivant.setState({ ciel: cielDuMoment(), saison: saisonA(new Date(), recherche()) })
    if (r.meteo !== a.meteo) relever()
  })
  return () => {
    clearInterval(cycle)
    clearInterval(releve)
    abandon.abort()
    desabonner()
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

export interface Partie {
  /** La visite en pause (billet d'accueil, Échap, réglages ouverts) : le visiteur ne bouge pas. Vrai au départ. */
  paused: boolean
  tourActive: boolean
  /** L'arrêt courant de la visite guidée (rang dans VISITE de plan/tour.ts). */
  tourEtape: number
  /** Le projet demandé par l'adresse (`?p=`) et sa clé, null s'il n'est pas exposé. */
  rendezVous: { demande: string; cle: string | null } | null
  /** Le marcheur, publié seulement quand il bouge ou tourne (minimap). */
  visiteur: Walker | null
  /** La toile regardée (eclairage.ts), la borne des vitrines (vitrines.ts), Bavette (bavette.ts), l'ancre du journal (chantier). */
  toile: string | null
  borne: string | null
  bavette: boolean
  etape: string | null
  /** Une session VR est ouverte (vr.ts) : le casque tient la caméra, l'interface DOM se retire. */
  enVR: boolean
  /** Une séance de cinéma (seance.ts) : la vidéo sur la toile, la visite continue. */
  seance: boolean
  /** Assis dans un fauteuil du cinéma (visiteur.ts `asseoir`) : on regarde, on ne marche pas ; avancer relève. */
  assis: boolean
}
export const partie = createStore<Partie>(() => ({
  paused: true,
  tourActive: false,
  tourEtape: 0,
  rendezVous: null,
  visiteur: null,
  toile: null,
  borne: null,
  bavette: false,
  etape: null,
  enVR: false,
  seance: false,
  assis: false,
}))

/** N'écrit dans `store` que les champs qui changent (rien du tout si aucun) : sûr à chaque image. */
export function publier<S extends object>(store: { getState(): S; setState(p: Partial<S>): void }, p: Partial<S>): void {
  const s = store.getState()
  if ((Object.keys(p) as (keyof S)[]).some((k) => !Object.is(s[k], p[k]))) store.setState(p)
}

/** Le joystick et le glissé du doigt (ui/mobile.ts) : forward/strafe dans [−1, 1], look en pixels accumulés que le visiteur consomme. */
export const toucher = { forward: 0, strafe: 0, lookX: 0, lookY: 0 }

/**
 * La VR (vr.ts) : `avance`/`cote` dans [−1, 1] et `hate` pour la marche, `sansSol` quand l'espace
 * de référence n'est pas 'local-floor' (l'œil est alors posé à 1,62 m), `confort` la vignette 0-1.
 */
export const vrEntree = { avance: 0, cote: 0, hate: false, sansSol: false, confort: 0 }
