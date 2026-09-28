/**
 * Le ciel du fond de scène : une photo équirectangulaire de Poly Haven
 * (`CIEL` dans `tools/fetch-assets.ts`), vue par la verrière et depuis le parc.
 *
 * L'aplat `CIEL` reste posé dessous : il est le fond tant que l'image n'est pas
 * là, et pour toujours si elle manque (#46 : jamais de fond noir).
 */
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { CIEL } from './lighting'

const FICHIER = 'assets/ciel/kloofendal_48d_partly_cloudy_puresky.jpg'

export function Ciel() {
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    let texture: THREE.Texture | null = null
    let vivant = true
    new THREE.TextureLoader()
      .loadAsync(`${import.meta.env.BASE_URL}${FICHIER}`)
      .then((t) => {
        if (!vivant) return t.dispose()
        t.mapping = THREE.EquirectangularReflectionMapping
        t.colorSpace = THREE.SRGBColorSpace
        texture = t
        scene.background = t
      })
      .catch((erreur: unknown) => console.warn('ciel indisponible, fond uni', erreur))
    return () => {
      vivant = false
      if (texture === null) return
      if (scene.background === texture) scene.background = new THREE.Color(CIEL)
      texture.dispose()
    }
  }, [scene])
  return <color attach="background" args={[CIEL]} />
}
