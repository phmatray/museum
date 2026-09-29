/**
 * Les réglages du visiteur, ce qui s'en décide sans navigateur : le schéma,
 * les valeurs par défaut, la lecture (tolérante) et l'écriture du localStorage.
 *
 * ── Le même chemin que l'adresse ──
 *
 * L'heure, le temps, la saison, la qualité et les ombres se forçaient déjà par
 * l'adresse (`?heure=`, `?meteo=`, `?saison=`, `?qualite=`, `?ombres=0`). Les
 * réglages ne forment pas un second mécanisme : `rechercheAvec` les traduit en
 * ces mêmes paramètres, que lisent les mêmes fonctions (`heureDemandee`,
 * `meteoDemandee`, `saisonA`, `qualiteDemandee`). Un paramètre présent dans
 * l'adresse l'emporte toujours : les captures restent reproductibles, quels que
 * soient les réglages retenus par le navigateur qui les prend.
 *
 * ── La migration ──
 *
 * Chaque champ est relu seul et remplacé par son défaut s'il manque ou ne
 * convient plus : un réglage ajouté plus tard, retiré, ou abîmé à la main ne
 * fait jamais perdre les autres.
 */

export const METEOS = ['clair', 'pluie', 'neige', 'brouillard', 'orage'] as const
export const SAISONS = ['printemps', 'ete', 'automne', 'hiver'] as const
export const QUALITES = ['auto', 'haute', 'basse'] as const
export const MOUVEMENTS = ['systeme', 'reduit', 'normal'] as const

export type MeteoForcee = (typeof METEOS)[number]
export type SaisonForcee = (typeof SAISONS)[number]
export type Qualite = (typeof QUALITES)[number]
/** `systeme` suit `prefers-reduced-motion` ; les deux autres le forcent. */
export type Mouvement = (typeof MOUVEMENTS)[number]

export interface Reglages {
  /** Le volume général, de 0 à 1 (le son lui-même s'allume au bouton ou à M). */
  volume: number
  qualite: Qualite
  ombres: boolean
  /** Multiplie la sensibilité de la souris (1 = celle d'origine). */
  sensibilite: number
  inverserY: boolean
  /** Le champ de vision vertical de la caméra, en degrés. */
  champ: number
  /** La minimap, en bas à droite. */
  plan: boolean
  mouvement: Mouvement
  /** L'heure forcée en minutes depuis minuit, ou `null` pour l'heure réelle. */
  heure: number | null
  meteo: MeteoForcee | null
  saison: SaisonForcee | null
}

export const VERSION = 1

export const BORNES = {
  volume: [0, 1],
  sensibilite: [0.25, 3],
  champ: [60, 90],
  heure: [0, 24 * 60 - 1],
} as const

export const DEFAUTS: Reglages = {
  volume: 0.8,
  qualite: 'auto',
  ombres: true,
  sensibilite: 1,
  inverserY: false,
  champ: 75,
  plan: true,
  mouvement: 'systeme',
  heure: null,
  meteo: null,
  saison: null,
}

const borne = (v: unknown, [min, max]: readonly [number, number], defaut: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : defaut
const parmi = <T extends string>(v: unknown, choix: readonly T[], defaut: T): T => (choix.includes(v as T) ? (v as T) : defaut)
const oui = (v: unknown, defaut: boolean) => (typeof v === 'boolean' ? v : defaut)

/** Relit ce que le navigateur a retenu ; n'importe quoi d'illisible rend les défauts. */
export function lireReglages(texte: string | null): Reglages {
  let brut: Record<string, unknown> = {}
  try {
    const j: unknown = JSON.parse(texte ?? '{}')
    if (j !== null && typeof j === 'object' && !Array.isArray(j)) brut = j as Record<string, unknown>
  } catch {
    // Abîmé : les défauts.
  }
  const d = DEFAUTS
  return {
    volume: borne(brut.volume, BORNES.volume, d.volume),
    qualite: parmi(brut.qualite, QUALITES, d.qualite),
    ombres: oui(brut.ombres, d.ombres),
    sensibilite: borne(brut.sensibilite, BORNES.sensibilite, d.sensibilite),
    inverserY: oui(brut.inverserY, d.inverserY),
    champ: borne(brut.champ, BORNES.champ, d.champ),
    plan: oui(brut.plan, d.plan),
    mouvement: parmi(brut.mouvement, MOUVEMENTS, d.mouvement),
    heure: brut.heure === null || brut.heure === undefined ? null : Math.round(borne(brut.heure, BORNES.heure, 12 * 60)),
    meteo: parmi<MeteoForcee | 'reelle'>(brut.meteo, METEOS, 'reelle') === 'reelle' ? null : (brut.meteo as MeteoForcee),
    saison: parmi<SaisonForcee | 'reelle'>(brut.saison, SAISONS, 'reelle') === 'reelle' ? null : (brut.saison as SaisonForcee),
  }
}

export function ecrireReglages(r: Reglages): string {
  return JSON.stringify({ v: VERSION, ...r })
}

/** `HH:MM` de minutes depuis minuit. */
export function heureTexte(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/**
 * L'adresse telle que la lisent les forçages : les réglages traduits en
 * paramètres, sans jamais écraser un paramètre que l'adresse porte déjà.
 */
export function rechercheAvec(recherche: string, r: Reglages): string {
  const p = new URLSearchParams(recherche)
  const poser = (cle: string, valeur: string | null) => {
    if (valeur !== null && !p.has(cle)) p.set(cle, valeur)
  }
  poser('heure', r.heure === null ? null : heureTexte(r.heure))
  poser('meteo', r.meteo)
  poser('saison', r.saison)
  poser('qualite', r.qualite === 'auto' ? null : r.qualite)
  poser('ombres', r.ombres ? null : '0')
  const s = p.toString()
  return s ? `?${s}` : ''
}

/** Le mouvement est-il à réduire, `systeme` s'en remettant au navigateur. */
export function mouvementReduitPour(m: Mouvement, prefereReduit: boolean): boolean {
  return m === 'reduit' || (m === 'systeme' && prefereReduit)
}
