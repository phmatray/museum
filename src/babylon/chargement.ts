/**
 * Le chargement de la tranche Babylon, sans DOM (l'écran : ui/ecranChargement.ts) :
 * `suivre` compte ce que main.ts attend, `marquerPret` ouvre la visite. Tant que
 * l'étape n'est pas `pret`, le visiteur ne marche pas (visiteur.ts) : bouger trop
 * tôt réveille les rafales de compilation et de recapture des sondes.
 * Comme src/stores/chargementStore.ts, sans React (`zustand/vanilla`).
 */
import { createStore } from 'zustand/vanilla'

import type { Etape } from '../domain/chargement.ts'

export { avancer, type Etape } from '../domain/chargement.ts'

export const chargement = createStore<{ faits: number; total: number; etape: Etape }>(() => ({ faits: 0, total: 0, etape: 'chargement' }))

/** Compte une promesse dans le chargement ; la rend telle quelle (rejet compris). */
export function suivre<T>(p: Promise<T>): Promise<T> {
  chargement.setState((s) => ({ total: s.total + 1 }))
  return p.finally(() => chargement.setState((s) => ({ faits: s.faits + 1 })))
}

/** Le musée est prêt, ou on a cessé de l'attendre. `window.__PRET__` pour les navigateurs pilotés. */
export function marquerPret(): void {
  if (chargement.getState().etape === 'pret') return
  chargement.setState({ etape: 'pret' })
  ;(window as { __PRET__?: boolean }).__PRET__ = true
}

export const pret = (): boolean => chargement.getState().etape === 'pret'
