/**
 * Le ciel du fond de scène : une photo équirectangulaire de Poly Haven
 * (`CIEL` dans `tools/fetch-assets.ts`), vue par la verrière et depuis le parc.
 *
 * L'aplat `CIEL` est le fond tant que l'image n'est pas là, et pour toujours
 * si elle manque (#46 : jamais de fond noir).
 *
 * Les deux sont posés ICI, à la main, et pas l'aplat par un
 * `<color attach="background">` : en production, R3F rattachait cet élément
 * après le chargement de l'image et le ciel repassait à l'aplat. En
 * développement, le double effet de StrictMode masquait le problème.
 */
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { CIEL } from './lighting'

const FICHIER = 'assets/ciel/kloofendal_48d_partly_cloudy_puresky.jpg'

export function Ciel() {
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    /* eslint-disable react-hooks/immutability -- le fond est un état de la scène three, pas de React */
    let texture: THREE.Texture | null = null
    let vivant = true
    scene.background = new THREE.Color(CIEL)
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
    /* eslint-enable react-hooks/immutability */
  }, [scene])
  return null
}
