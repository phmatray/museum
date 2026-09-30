/**
 * La baie de la salle d'honneur à la manière de la Casa Batlló : colonnes en
 * os, arcs souples, chêne ondulé et bandeau de cives (`assets/architecture/
 * batllo.glb`, `tools/blender/build-batllo.py`).
 *
 * Modélisée dans le repère du plan, comme la nef : posée telle quelle. Chargée
 * sans suspendre ; si elle manque, la baie reste simplement ouverte.
 */
import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { fusionnerParMatiere, unePasse, unifierParCouleur } from './fusion'

export function BatlloLayer() {
  const [baie, setBaie] = useState<THREE.Object3D | null>(null)
  useEffect(() => {
    let vivant = true
    const base = import.meta.env.BASE_URL
    const gltf = new GLTFLoader()
    const draco = new DRACOLoader()
    draco.setDecoderPath(`${base}draco/`)
    gltf.setDRACOLoader(draco)
    gltf
      .loadAsync(`${base}assets/architecture/batllo.glb`)
      .then(({ scene }) => {
        // Les vitres ne masquent rien : les cives se voient à travers le verre clair.
        scene.traverse((o) => {
          if (o instanceof THREE.Mesh && (o.material as THREE.Material).transparent) (o.material as THREE.Material).depthWrite = false
        })
        // Les cinq couleurs de cives en une matière, les dix-huit pièces de chêne
        // en un appel, les verres plans en une passe (`fusion.ts`).
        unifierParCouleur(scene, 'Batllo_Cive')
        fusionnerParMatiere(scene)
        unePasse(scene)
        if (vivant) setBaie(scene)
      })
      .catch((erreur: unknown) => console.error('baie Batlló indisponible', erreur))
      .finally(() => draco.dispose())
    return () => {
      vivant = false
    }
  }, [])
  return baie === null ? null : <primitive object={baie} />
}
