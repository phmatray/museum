/**
 * Les horaires du parc, sur le panneau de l'entrée : ouvert du lever au
 * coucher du soleil — le vrai, celui de `soleil.ts`, au lieu du musée.
 *
 * Pur : une date et des degrés entrent, des heures sortent.
 */
import { positionDuSoleil } from './soleil.ts'

/** Le bord du disque au ras de l'horizon, réfraction comprise : la convention des éphémérides. */
const HORIZON = -0.833
const HEURE = 3600000

/** Le lever et le coucher du soleil le jour (UTC) de `date`, ou `null` quand il ne se lève ou ne se couche pas. */
export function leverEtCoucher(date: Date, latitude: number, longitude: number): { lever: Date; coucher: Date } | null {
  // Le midi solaire de ce jour-là : midi UTC, décalé de la longitude.
  const jour = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12)
  const midi = jour - (longitude / 15) * HEURE
  const hauteur = (t: number) => positionDuSoleil(new Date(t), latitude, longitude).elevation - HORIZON
  if (hauteur(midi) < 0 || hauteur(midi - 12 * HEURE) > 0) return null
  // Le soleil monte de minuit à midi et descend ensuite : une bissection de chaque côté.
  const croisement = (a: number, b: number) => {
    for (let i = 0; i < 30; i++) {
      const m = (a + b) / 2
      if (hauteur(m) > 0 === hauteur(a) > 0) a = m
      else b = m
    }
    return new Date((a + b) / 2)
  }
  return { lever: croisement(midi - 12 * HEURE, midi), coucher: croisement(midi, midi + 12 * HEURE) }
}

/** « 7 h 42 », à la belge. */
export function heureFrancaise(d: Date, fuseau: string): string {
  const [h, m] = new Intl.DateTimeFormat('fr-BE', { timeZone: fuseau, hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
    .format(d)
    .split(/\D+/)
    .map(Number)
  return `${h} h ${String(m).padStart(2, '0')}`
}

/** Les lignes du panneau des horaires, pour le jour de `date`. */
export function lignesDesHoraires(date: Date, latitude: number, longitude: number, fuseau = 'Europe/Brussels'): string[] {
  const s = leverEtCoucher(date, latitude, longitude)
  const aujourdhui = s ? `Aujourd’hui : ${heureFrancaise(s.lever, fuseau)} – ${heureFrancaise(s.coucher, fuseau)}` : 'Aujourd’hui : jour et nuit'
  return ['Ouvert tous les jours', 'du lever au coucher du soleil', aujourdhui, 'Entrée libre']
}
