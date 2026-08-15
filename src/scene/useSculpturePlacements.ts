/**
 * LOT SCULPTURES — FIX FINAL (jointure I2).
 *
 * `SculptureLayer` et `PropsLayer` appelaient chacun `placeSculptures(museum)`
 * séparément. Le problème n'était pas le coût — la fonction est pure et bon
 * marché, l'appeler deux fois ne coûte rien de mesurable — c'était la
 * DIVERGENCE : rien n'empêchait un futur changement de filtrer, trier ou muter
 * la liste dans un seul des deux calques, et la garantie « ce que l'un réserve
 * est ce que l'autre dessine » se serait rompue en silence, sans test pour
 * l'attraper.
 *
 * Ce hook est donc la source UNIQUE des placements de pièces en volume, mémorisé
 * une fois par musée, consommé par les deux calques. Un fichier `.ts` et non
 * `.tsx` : eslint (`react-refresh/only-export-components`) interdit d'exporter
 * autre chose qu'un composant depuis un `.tsx`, et ce module n'exporte qu'un
 * hook — même parti que `useMatiere` dans `materials.ts`.
 */
import { useMemo } from 'react'

import { placeSculptures } from '../domain/sculptures'
import type { SculpturePlacement } from '../domain/sculptures'
import type { Museum } from '../domain/types'

/** Les placements de pièces en volume du musée, mémorisés par référence de `museum`. */
export function useSculpturePlacements(museum: Museum): SculpturePlacement[] {
  return useMemo(() => placeSculptures(museum), [museum])
}
