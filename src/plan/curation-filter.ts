/**
 * Filtre les dépôts exclus par `curation.json` avant qu'ils n'atteignent
 * `assignRooms`/`hangPlan` — un dépôt exclu ne doit jamais être accroché,
 * même sans image générée (cf. `tools/build-media.ts`, qui applique déjà ce
 * même filtre côté médias).
 *
 * Module séparé de `hang.ts` : `hang.ts` ne connaît pas encore le schéma
 * `Curation`, écrit à la main et validé ailleurs — pas de raison de le lui
 * faire importer pour une seule fonction pure.
 */
import type { Artwork, Curation } from '../domain/types.ts'

export function filtrerExclus(artworks: Artwork[], curation: Curation): Artwork[] {
  const excluded = new Set(curation.excluded)
  return artworks.filter((a) => !excluded.has(a.key))
}
