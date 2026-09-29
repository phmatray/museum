/**
 * Le chargement du musée : ce qui reste à venir avant de montrer l'accueil.
 *
 * Hors de three à dessein : l'écran de chargement vit dans le morceau
 * principal, qui s'affiche avant que la 3D ne soit évaluée. Deux sources
 * alimentent les compteurs :
 *  - tous les chargeurs three (GLTF, KTX2, textures, DRACO…) passent par
 *    `DefaultLoadingManager`, que `scene/chargement.ts` branche ici ;
 *  - les `fetch` maison (catalogue, accrochage, atlas des toiles…) et les
 *    polices de troika, qui n'y passent pas, s'annoncent par `suivre`.
 *
 * Tout arrivé ne suffit pas : `etape` passe ensuite par la `finition` (shaders
 * compilés, sondes de reflets prises) avant `pret`.
 */
import { create } from 'zustand'

export type Etape = 'chargement' | 'finition' | 'pret'

interface EtatChargement {
  faits: number
  total: number
  etape: Etape
  /** Les sondes de reflets ont été reprises une fois tout arrivé. */
  sondes: boolean
}

export const useChargement = create<EtatChargement>(() => ({ faits: 0, total: 0, etape: 'chargement', sondes: false }))

export function commencer(): void {
  useChargement.setState((s) => ({ total: s.total + 1 }))
}

export function finir(): void {
  useChargement.setState((s) => ({ faits: s.faits + 1 }))
}

/** Compte une promesse dans le chargement ; la rend telle quelle (rejet compris). */
export function suivre<T>(promesse: Promise<T>): Promise<T> {
  commencer()
  return promesse.finally(finir)
}

/** Le musée est prêt, ou on a cessé de l'attendre. `window.__PRET__` pour les navigateurs pilotés. */
export function marquerPret(): void {
  if (useChargement.getState().etape === 'pret') return
  useChargement.setState({ etape: 'pret' })
  ;(window as { __PRET__?: boolean }).__PRET__ = true
}

/**
 * La part affichée de la barre, de 0 à 1.
 *
 * Les éléments arrivés mènent à 90 %, la finition à 97 %, et seul `pret`
 * donne 100 %. Le total n'est connu qu'au fil de l'eau (les premières données
 * arrivent avant que la 3D n'ait lancé ses modèles) : on divise par le plus
 * grand du total courant et d'`attendu`, le total du dernier chargement complet.
 * Jamais en arrière : un total qui grossit fait baisser la cible, pas la barre.
 * `dt` en secondes ; `doux` faux (mouvement réduit) saute droit à la cible.
 */
export function avancer(affiche: number, faits: number, total: number, etape: Etape, dt: number, doux = true, attendu = 0): number {
  const sur = Math.max(total, attendu)
  const cible = etape === 'pret' ? 1 : etape === 'finition' ? 0.97 : sur === 0 ? 0 : (0.9 * faits) / sur
  if (cible <= affiche) return affiche
  return doux ? affiche + (cible - affiche) * (1 - Math.exp(-5 * dt)) : cible
}
