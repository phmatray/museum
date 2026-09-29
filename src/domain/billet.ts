/**
 * Ce qu'imprime le billet d'entrée de l'accueil : Orsay était une gare, on
 * entre avec un billet composté. Pur : l'accrochage, l'heure et le numéro de
 * visite entrent, les lignes du billet sortent.
 */
import type { Accrochage } from '../plan/hang'

export interface Billet {
  /** « 116 œuvres · 12 salles » ; null tant que l'accrochage n'est pas lu. */
  collection: string | null
  /** « mardi 29 septembre 2026 » */
  jour: string
  /** « 21 h 04 » : aussi l'encre du composteur. */
  heure: string
  /** « 000159 » ; des tirets tant que le compteur n'a pas répondu. */
  numero: string
}

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`

export function billet(accrochage: Accrochage | null, enVitrine: number, quand: Date, visite: number | null): Billet {
  const salles = accrochage?.rooms.filter((r) => r.placements.length > 0) ?? []
  const oeuvres = salles.reduce((n, r) => n + r.placements.length, enVitrine)
  return {
    collection: accrochage ? `${pluriel(oeuvres, 'œuvre')} · ${pluriel(salles.length, 'salle')}` : null,
    jour: quand.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    heure: `${quand.getHours()} h ${String(quand.getMinutes()).padStart(2, '0')}`,
    numero: visite === null ? '––––––' : String(visite % 1e6).padStart(6, '0'),
  }
}
