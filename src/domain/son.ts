/**
 * L'AMBIANCE SONORE du musée, la partie qui se calcule : quand tombe un pas,
 * sur quoi il tombe, quand sonne l'horloge, et comment se mêlent le dedans et
 * le dehors. Le graphe Web Audio (`audio/`) ne fait qu'exécuter ces décisions.
 *
 * Rien ici ne touche à l'API audio : des nombres et des chaînes, testables sans
 * navigateur (jsdom n'a pas d'`AudioContext`).
 */
import { JARDIN, TABLIER } from '../plan/jardin.ts'
import type { Parc } from '../plan/park.ts'
import { surUneAllee } from '../plan/park.ts'
import { PARC } from '../plan/rules.ts'
import { distanceParvis } from '../plan/relief.ts'

// ── Les lieux et les sols ─────────────────────────────────────────────────

/** Trois acoustiques : la nef de pierre, les galeries parquetées, le plein air. */
export type Lieu = 'nef' | 'galerie' | 'dehors'

/** Ce que touche le talon, et donc le timbre du pas. */
export type Matiere = 'pierre' | 'parquet' | 'bois' | 'gravier' | 'herbe'

/**
 * Le lieu d'une surface de `walk.ts`. La nef, c'est le hall et tout ce qui
 * donne dessus : balcons, palier et volées de l'escalier — le même volume, la
 * même réverbération de trois secondes et demie.
 */
export function lieuDe(surface: string): Lieu {
  if (surface === PARC) return 'dehors'
  if (surface === '0:hall' || surface.startsWith('1:balcon') || surface.startsWith('palier:') || surface.startsWith('volee:')) return 'nef'
  return 'galerie'
}

/** Rayon d'une pierre de gué (`JARDIN.pas`), en mètres. */
const RAYON_GUE = 0.45

const dansRect = (r: { x: number; z: number; width: number; depth: number }, x: number, z: number) =>
  x >= r.x && x <= r.x + r.width && z >= r.z && z <= r.z + r.depth

/**
 * Le sol sous le pied. Dedans : le terrazzo de la nef, le parquet ailleurs (salle
 * d'honneur comprise). Dehors : le tablier du pont sonne creux, le parvis et
 * les pierres de gué sonnent pierre, les allées crissent, le reste est gazon.
 */
export function matiereSous(w: { surface: string; x: number; z: number }, parc: Pick<Parc, 'allees' | 'parvis'>): Matiere {
  const lieu = lieuDe(w.surface)
  if (lieu === 'nef') return 'pierre'
  if (lieu === 'galerie') return 'parquet'
  if (dansRect(TABLIER, w.x, w.z)) return 'bois'
  if (distanceParvis(parc.parvis, w.x, w.z) <= 0) return 'pierre'
  if (JARDIN.pas.some(([px, pz]) => Math.hypot(w.x - px, w.z - pz) < RAYON_GUE)) return 'pierre'
  if (surUneAllee(parc.allees, w.x, w.z)) return 'gravier'
  return 'herbe'
}

// ── La cadence des pas ────────────────────────────────────────────────────

/** Un pas toutes les 0,55 s à la marche (3,5 m/s, `VITESSE_MARCHE`). */
export const CADENCE_MARCHE = 0.55
const VITESSE_REFERENCE = 3.5
/** En dessous, on piétine ou l'on s'est arrêté : pas de pas. */
export const VITESSE_MIN = 0.4

/**
 * L'intervalle entre deux pas à cette vitesse, ou `null` à l'arrêt. La foulée
 * s'allonge ET la cadence monte quand on presse le pas : d'où l'exposant 0,6,
 * entre la cadence constante (0) et la foulée constante (1). À 6 m/s (la hâte),
 * 0,40 s ; à 1,8 m/s (la visite guidée), 0,75 s.
 */
export function intervallePas(vitesse: number): number | null {
  if (vitesse < VITESSE_MIN) return null
  return Math.min(0.75, Math.max(0.34, CADENCE_MARCHE * (VITESSE_REFERENCE / vitesse) ** 0.6))
}

/**
 * Avance la phase de la foulée de `dt` secondes ; `pas` quand un talon touche.
 * À l'arrêt, la phase se recale à 0,7 : le premier pas d'une reprise tombe vite,
 * comme on lève le pied aussitôt qu'on repart, sans tomber sur la touche.
 */
export function avancerPas(phase: number, vitesse: number, dt: number): { phase: number; pas: boolean } {
  const intervalle = intervallePas(vitesse)
  if (intervalle === null) return { phase: 0.7, pas: false }
  const p = phase + dt / intervalle
  return p >= 1 ? { phase: p % 1, pas: true } : { phase: p, pas: false }
}

// ── Le mélange ────────────────────────────────────────────────────────────

export interface Mixage {
  /** Ce qui parvient des sources de la nef (horloge, tableau, cloches), murs compris. */
  sourcesNef: number
  /** Envoi des pas vers la grande réverbération de la nef. */
  reverbNef: number
  /** Envoi des pas vers la petite réverbération des galeries. */
  reverbGalerie: number
  /** Le jardin : oiseaux, grillons, eau, vent. */
  dehors: number
}

/**
 * Les poids du mélange selon le lieu. Le moteur les rejoint en douceur (une
 * demi-seconde) : franchir le seuil du musée est un fondu, pas une coupure.
 * Depuis le hall, le jardin s'entend à peine par la porte ; depuis une galerie,
 * l'horloge n'est plus qu'un battement lointain.
 */
export function mixage(lieu: Lieu): Mixage {
  switch (lieu) {
    case 'nef': return { sourcesNef: 1, reverbNef: 0.4, reverbGalerie: 0, dehors: 0.06 }
    case 'galerie': return { sourcesNef: 0.22, reverbNef: 0, reverbGalerie: 0.3, dehors: 0 }
    case 'dehors': return { sourcesNef: 0.07, reverbNef: 0, reverbGalerie: 0, dehors: 1 }
  }
}

/**
 * La pluie qu'on entend : pleine et claire dehors ; dans la nef, le crépitement
 * sur la verrière, étouffé ; dans une galerie, un murmure sourd par les
 * lanterneaux et les murs. `coupure` est la fréquence du passe-bas (Hz).
 */
export function pluieEntendue(lieu: Lieu, pluie: number): { gain: number; coupure: number } {
  const [gain, coupure] = lieu === 'dehors' ? [1, 9000] : lieu === 'nef' ? [0.5, 2200] : [0.22, 700]
  return { gain: gain * Math.min(1, Math.max(0, pluie)), coupure }
}

// ── L'horloge et son carillon ─────────────────────────────────────────────

/**
 * L'heure à sonner, ou `null`. Seulement pendant les trente premières secondes
 * de l'heure pleine — arriver à 14 h 20 ne sonne pas 14 h — et une seule fois :
 * `dernier` est la `cle` du dernier carillon joué.
 */
export function carillonDu(date: Date, dernier: number | null): { cle: number; coups: number } | null {
  if (date.getMinutes() !== 0 || date.getSeconds() >= 30) return null
  const cle = Math.floor(date.getTime() / 60000)
  if (cle === dernier) return null
  return { cle, coups: date.getHours() % 12 || 12 }
}

/** Les quatre cloches des quarts de Westminster, en mi majeur (Hz) : sol♯, fa♯, mi, si. */
const [SOL, FA, MI, SI] = [415.3, 369.99, 329.63, 246.94]
/** Le bourdon qui frappe les heures : mi grave. */
export const BOURDON = 164.81

/** Les cinq « changes » de Westminster ; l'heure pleine joue les changes 2 à 5. */
export const WESTMINSTER = [
  [SOL, FA, MI, SI],
  [MI, SOL, FA, SI],
  [MI, FA, SOL, MI],
  [SOL, MI, FA, SI],
  [SI, FA, SOL, MI],
] as const

export interface Coup {
  /** Secondes depuis le début du carillon. */
  t: number
  frequence: number
  /** `true` pour le bourdon des heures, plus grave et plus long. */
  bourdon: boolean
}

const NOTE = 0.72
const FIN_DE_PHRASE = 0.9
const AVANT_LES_HEURES = 2.2
const ENTRE_LES_COUPS = 2.4

function phrases(indices: number[]): Coup[] {
  const coups: Coup[] = []
  let t = 0
  for (const i of indices) {
    for (const frequence of WESTMINSTER[i]) {
      coups.push({ t, frequence, bourdon: false })
      t += NOTE
    }
    t += FIN_DE_PHRASE
  }
  return coups
}

/** L'heure pleine : les quatre phrases de Westminster, un silence, puis `coups` coups de bourdon. */
export function partitionHeure(coups: number): Coup[] {
  const quarts = phrases([1, 2, 3, 4])
  const debut = (quarts.at(-1)?.t ?? 0) + NOTE + AVANT_LES_HEURES
  return [...quarts, ...Array.from({ length: coups }, (_, i) => ({ t: debut + i * ENTRE_LES_COUPS, frequence: BOURDON, bourdon: true }))]
}

/** Un nouveau projet au tableau : le premier quart seul, une annonce de gare. */
export function partitionAnnonce(): Coup[] {
  return phrases([0])
}

// ── Bavette ───────────────────────────────────────────────────────────────

/** Il ronronne pour qui s'approche à moins d'1,5 m ; pleinement sous 0,9 m. */
export function volumeRonron(distance: number): number {
  const u = Math.min(1, Math.max(0, (1.5 - distance) / 0.6))
  return u * u * (3 - 2 * u)
}

// ── Le hérisson ───────────────────────────────────────────────────────────

/** On l'entend froisser l'herbe à moins de 6 m. */
export const PORTEE_FROISSEMENT = 6

/**
 * Le froissement de l'herbe sous le hérisson : plein à moins d'un mètre, puis
 * en distance inverse, éteint en douceur à `PORTEE_FROISSEMENT` — c'est lui
 * qu'on suit pour le trouver.
 */
export function volumeFroissement(distance: number): number {
  const fin = Math.min(1, Math.max(0, (PORTEE_FROISSEMENT - distance) / 2))
  return fin * fin * (3 - 2 * fin) / Math.max(1, distance)
}
