/**
 * Le chargement de la tranche Babylon, sans DOM (l'écran : ui/ecranChargement.ts) :
 * `suivre` compte ce que main.ts attend, `marquerPret` ouvre la visite. Tant que
 * l'étape n'est pas `pret`, le visiteur ne marche pas (visiteur.ts) : bouger trop
 * tôt réveille les rafales de compilation et de recapture des sondes.
 * Comme src/stores/chargementStore.ts, sans React (`zustand/vanilla`).
 */
import { createStore } from 'zustand/vanilla'

import type { EtatChargement } from '../domain/chargement.ts'

export { avancer, detailDuChargement, type Etape, type EtatChargement } from '../domain/chargement.ts'

export const chargement = createStore<EtatChargement>(() => ({ faits: 0, total: 0, etape: 'chargement', attendus: [], octets: 0, shaders: 0, sondes: [0, 0] }))

/** `liste` sans la première occurrence de `nom`. */
const sans = (liste: string[], nom: string) => {
  const i = liste.indexOf(nom)
  return i < 0 ? liste : [...liste.slice(0, i), ...liste.slice(i + 1)]
}

/** Compte une promesse dans le chargement, sous son `nom` (affiché tant qu'elle n'est pas arrivée) ; la rend telle quelle (rejet compris). */
export function suivre<T>(p: Promise<T>, nom?: string): Promise<T> {
  chargement.setState((s) => ({ total: s.total + 1, attendus: nom ? [...s.attendus, nom] : s.attendus }))
  return p.finally(() => chargement.setState((s) => ({ faits: s.faits + 1, attendus: nom ? sans(s.attendus, nom) : s.attendus })))
}

/** Le musée est prêt, ou on a cessé de l'attendre. `window.__PRET__` pour les navigateurs pilotés. */
export function marquerPret(): void {
  if (chargement.getState().etape === 'pret') return
  chargement.setState({ etape: 'pret' })
  ;(window as { __PRET__?: boolean }).__PRET__ = true
}

export const pret = (): boolean => chargement.getState().etape === 'pret'
