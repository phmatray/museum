/**
 * LOT SCULPTURES — le socle d'une pièce en volume (spec 2026-08-15 §7).
 *
 * Un prisme droit, centré sur son origine en plan, base en y = 0 : le point
 * d'ancrage que `domain/sculptures.ts` calcule est donc directement le centre du
 * socle posé sur la dalle, et la scène n'a rien à corriger.
 *
 * ── Pourquoi une BoxGeometry et pas une ExtrudeGeometry ──
 *
 * `buildSlab` extrude parce qu'une dalle est un rectangle TROUÉ, ce qu'une boîte
 * ne sait pas être. Un socle n'a pas de trou. La boîte évite donc d'un seul coup
 * les deux pièges du §8 — pas de biseau à désactiver, et `BoxGeometry` est déjà
 * indexée. Ce fichier les teste quand même : le jour où quelqu'un donnera un
 * chanfrein au socle, il basculera sur `ExtrudeGeometry` et les tests seront là.
 *
 * Aucun aléa, aucune horloge.
 */
import * as THREE from 'three'

import type { TrimeshCollider } from './slab'
import { toTrimesh } from './slab'

export interface PlinthResult {
  geometry: THREE.BufferGeometry
  collider: TrimeshCollider
}

/**
 * Construit un socle de `width` × `depth` × `height`, centré en plan sur
 * l'origine, sa base en y = 0.
 *
 * La soudure du collider vient de `slab.ts` et n'est pas refaite ici : c'est la
 * même règle, et deux copies divergeraient à la première correction appliquée
 * d'un seul côté. Elle ramène les 24 sommets de `BoxGeometry` — trois par coin,
 * un par face, pour que les normales des arêtes vives restent distinctes — aux
 * 8 coins réels.
 */
export function buildPlinth(width: number, depth: number, height: number): PlinthResult {
  if (width <= 0 || depth <= 0 || height <= 0) {
    throw new RangeError(`buildPlinth: cote non positive (${width}×${depth}×${height})`)
  }

  const geometry = new THREE.BoxGeometry(width, height, depth)
  // `BoxGeometry` est centrée sur son origine dans les trois axes : on la remonte
  // d'une demi-hauteur pour que sa base repose sur le plan de la dalle.
  geometry.translate(0, height / 2, 0)

  return { geometry, collider: toTrimesh(geometry) }
}
