/**
 * L'état partagé de la tranche Babylon, sans zustand (qui tirerait React) :
 *
 * - `etat.annonce` : la dernière annonce sonnée par la cloche, que le tableau
 *   des départs affiche. ponytail : un seul champ lu par sondage à chaque image ;
 *   un Observable quand une interface devra réagir aux changements.
 * - `VIVANTES` : les matières que main.ts ne fige pas (elles changent après le
 *   chargement). Une couche y ajoute le NOM d'une matière avant la fin de `couches`.
 * - `catalogue(base)` : data/catalogue.json chargé une fois pour toutes les couches.
 * - `mouvementReduit()` : le « calme » de reglagesStore, lu une fois.
 */
import { lireReglages, mouvementReduitPour } from '../domain/reglages.ts'
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

/** Mouvement réduit (réglage du musée, sinon la préférence du système). ponytail : lu au montage, pas suivi en direct. */
export function mouvementReduit(): boolean {
  try {
    return mouvementReduitPour(lireReglages(localStorage.getItem('museum:reglages')).mouvement, matchMedia('(prefers-reduced-motion: reduce)').matches)
  } catch {
    return false
  }
}
