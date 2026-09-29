/**
 * Des textes troika en un seul appel de dessin (`BatchedText`) : chaque `<Text>`
 * posé comme enfant DIRECT du lot (sa position est relative au lot, pas de
 * groupe intermédiaire) y est empaqueté — deux appels en tout avec les contours,
 * au lieu de deux par texte. Le lot est épinglé à sa salle (`userData.zone`) :
 * le tri des salles l'écarte d'un bloc ailleurs.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { BatchedText } from 'troika-three-text'

export function useLotDeTextes(zone: string): BatchedText {
  const lot = useMemo(() => {
    const l = new BatchedText()
    l.userData.zone = zone
    return l
  }, [zone])
  useEffect(() => () => lot.dispose(), [lot])
  return lot
}

/**
 * La couleur d'un texte du lot. `BatchedText` range la couleur de chaque membre
 * par `Color.getHex()` — en sRGB — puis la lit dans le shader comme une couleur
 * linéaire : sans correction, le crème pâlit et l'encre devient grise. On lui
 * donne donc la couleur linéarisée une fois de plus, que `getHex()` ramène à la
 * vraie couleur linéaire.
 */
export const teinteDeLot = (css: string) => new THREE.Color(css).convertSRGBToLinear()
