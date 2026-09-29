/**
 * Charge l'atlas de lumière précalculée (`scene/lumiere.ts`) et le règle sur
 * l'heure. Rien à dessiner : les matériaux des Boites le lisent déjà.
 */
import { useEffect } from 'react'
import * as THREE from 'three'

import { useGameStore } from '../stores/gameStore'
import { LUMIERE } from './lumiere'

/**
 * La nuit, la cuisson — faite sous un ciel de jour — garde son dessin (les
 * coins restent sombres, les lanterneaux éclairés de l'intérieur) mais pèse
 * moins : l'ambiance de nuit est déjà celle des lampes du musée.
 */
const NUIT = 0.75

export function LumiereLayer() {
  const jour = useGameStore((s) => s.ciel.jour)
  useEffect(() => {
    let vivant = true
    let atlas: THREE.Texture | null = null
    new THREE.TextureLoader()
      .loadAsync(`${import.meta.env.BASE_URL}assets/lumiere/atlas.webp`)
      .then((t) => {
        atlas = t
        if (!vivant) return t.dispose()
        t.colorSpace = THREE.SRGBColorSpace
        // Sans mipmaps : un niveau réduit mêlerait les faces voisines de l'atlas.
        t.generateMipmaps = false
        t.minFilter = THREE.LinearFilter
        LUMIERE.uLumiereAtlas.value = t
        LUMIERE.uLumiereForce.value = NUIT + (1 - NUIT) * useGameStore.getState().ciel.jour
      })
      // Sans atlas, l'ambiance d'avant : le musée reste visitable.
      .catch((erreur: unknown) => console.warn('lumière précalculée indisponible', erreur))
    return () => {
      vivant = false
      LUMIERE.uLumiereForce.value = 0
      LUMIERE.uLumiereAtlas.value = null
      atlas?.dispose()
    }
  }, [])
  useEffect(() => {
    if (LUMIERE.uLumiereAtlas.value) LUMIERE.uLumiereForce.value = NUIT + (1 - NUIT) * jour
  }, [jour])
  return null
}
