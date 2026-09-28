/**
 * Le tableau des départs de la nef : Orsay était une gare, ses trains sont ici
 * les dépôts, et chaque « départ » est un push récent. Pur : des données et une
 * horloge entrent, des lignes et des volets sortent.
 *
 * ── Les volets ──
 *
 * Un afficheur à palettes (split-flap) ne saute pas d'une lettre à l'autre : il
 * fait défiler son tambour, dans l'ordre de `TAMBOUR`, jusqu'à la bonne. Chaque
 * colonne part avec un léger retard sur la précédente : c'est la vague qui fait
 * le bruit et le charme de ces tableaux.
 */
import type { Artwork } from './types'

/** L'ordre du tambour d'une palette ; tout autre signe s'affiche en blanc. */
export const TAMBOUR = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-/:#+'
/** Une palette par 55 ms, et 18 ms de retard d'une colonne à la suivante. */
const PAS_MS = 55
const DECALAGE_MS = 18

export interface LigneDepart {
  depuis: string
  destination: string
  langage: string
  salle: string
}

/** Les colonnes du tableau, en nombre de palettes. */
export const COLONNES = { depuis: 7, destination: 24, langage: 11, salle: 20 } as const

/** « 5 MIN », « 2 H », « HIER », « 3 J », puis la date : ce qui tient sur sept palettes. */
export function depuis(date: Date, maintenant: Date): string {
  const min = Math.max(0, Math.floor((maintenant.getTime() - date.getTime()) / 60000))
  if (min < 60) return `${Math.max(1, min)} MIN`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} H`
  const j = Math.floor(h / 24)
  if (j === 1) return 'HIER'
  if (j < 7) return `${j} J`
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** Majuscules sans accents, signes hors tambour en blanc, calé sur `n` palettes. */
export function palettes(texte: string, n: number): string {
  const net = texte.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()
  return [...net].map((c) => (TAMBOUR.includes(c) ? c : ' ')).join('').slice(0, n).padEnd(n, ' ')
}

/**
 * Les derniers départs : les dépôts du plus récemment poussé au plus ancien,
 * avec la salle où les trouver (`salles` : clé du dépôt → nom de la salle).
 */
export function lignesDeDeparts(oeuvres: Iterable<Artwork>, salles: ReadonlyMap<string, string>, maintenant: Date, n: number): LigneDepart[] {
  return [...oeuvres]
    .filter((a) => salles.has(a.key))
    .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt) || a.key.localeCompare(b.key))
    .slice(0, n)
    .map((a) => ({ depuis: depuis(new Date(a.pushedAt), maintenant), destination: a.name, langage: a.language ?? '', salle: salles.get(a.key)! }))
}

/** Une ligne mise en palettes, colonnes séparées d'un blanc. */
export function ligneEnPalettes(l: LigneDepart): string {
  return [
    palettes(l.depuis, COLONNES.depuis),
    palettes(l.destination, COLONNES.destination),
    palettes(l.langage, COLONNES.langage),
    palettes(l.salle, COLONNES.salle),
  ].join(' ')
}

/**
 * Ce qu'affiche chaque palette `ms` millisecondes après le changement de `avant`
 * à `apres` (même longueur). Une palette avance d'un cran du tambour tous les
 * `PAS_MS`, à partir de son retard de colonne, et s'arrête sur sa cible.
 */
export function voletsA(avant: string, apres: string, ms: number): string {
  return [...apres]
    .map((cible, i) => {
      const depart = Math.max(0, TAMBOUR.indexOf(avant[i] ?? ' '))
      const arrivee = Math.max(0, TAMBOUR.indexOf(cible))
      const crans = (arrivee - depart + TAMBOUR.length) % TAMBOUR.length
      const faits = Math.max(0, Math.floor((ms - i * DECALAGE_MS) / PAS_MS))
      return TAMBOUR[(depart + Math.min(faits, crans)) % TAMBOUR.length]
    })
    .join('')
}

/** La durée d'un changement complet : le plus long tour de tambour de la dernière colonne. */
export function dureeVolets(longueur: number): number {
  return (longueur - 1) * DECALAGE_MS + TAMBOUR.length * PAS_MS
}

// ── Les nouvelles versions ──

/** Une version est « nouvelle » pendant une semaine après sa publication. */
const SEMAINE_MS = 7 * 24 * 3600 * 1000

/**
 * Les dépôts dont la dernière version a moins d'une semaine, de la plus récente
 * à la plus ancienne. `?annonce=1` en invente une sur le dernier dépôt poussé,
 * pour voir la cloche sonner sans attendre une vraie publication.
 */
export function versionsRecentes(oeuvres: Iterable<Artwork>, maintenant: Date, recherche = ''): Artwork[] {
  const toutes = [...oeuvres]
  const recentes = toutes
    .filter((a) => a.release && maintenant.getTime() - new Date(a.release.publishedAt).getTime() < SEMAINE_MS)
    .sort((a, b) => b.release!.publishedAt.localeCompare(a.release!.publishedAt) || a.key.localeCompare(b.key))
  if (recentes.length > 0 || new URLSearchParams(recherche).get('annonce') !== '1') return recentes
  const dernier = toutes.sort((a, b) => b.pushedAt.localeCompare(a.pushedAt))[0]
  if (dernier === undefined) return []
  return [{ ...dernier, release: { tag: 'v1.0.0', name: 'v1.0.0', publishedAt: maintenant.toISOString(), url: dernier.url } }]
}

/** « NOUVELLE VERSION · CARTOUCHE V1.9.0 » sur toute la largeur du tableau. */
export function ligneAnnonce(a: Artwork, largeur: number): string {
  return palettes(`NOUVELLE VERSION · ${a.name} ${a.release?.tag ?? ''}`, largeur)
}
