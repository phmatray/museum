/**
 * Le pavillon du BELVÉDÈRE, la palissade du roji et sa porte
 * (`assets/architecture/belvedere.glb`, `tools/blender/build-belvedere.py`),
 * modelés dans le repère du plan : posés tels quels. La terrasse de pierre est
 * dans le lot de pierre du parc (`ParkLayer`, `plan/belvedere.ts`).
 *
 * La lanterne de papier du pavillon s'allume au crépuscule : de l'autre bout
 * de l'étang, la nuit, c'est elle qu'on voit, et elle appelle.
 */
import { useEffect, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { useGameStore } from '../stores/gameStore'
import { intemperer } from './intemperies'
import { chargerGlb } from './propAssets'

/** L'éclat de la lanterne, la nuit ; éteinte en plein jour. */
const ECLAT = 3.2

export function BelvedereLayer() {
  const [modele, setModele] = useState<{ scene: THREE.Object3D; lueur: THREE.MeshStandardMaterial | null } | null>(null)
  useEffect(() => {
    let vivant = true
    chargerGlb(`${import.meta.env.BASE_URL}assets/architecture/belvedere.glb`)
      .then(({ scene }) => {
        let lueur: THREE.MeshStandardMaterial | null = null
        scene.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return
          const m = o.material as THREE.MeshStandardMaterial
          if (m.name === 'Belvedere_Lueur') lueur = m
          // Mouillés sous l'averse, blancs sous la neige, comme le pont du jardin.
          else intemperer(m)
        })
        if (vivant) setModele({ scene, lueur })
      })
      .catch((erreur: unknown) => console.error('belvédère indisponible', erreur))
    return () => {
      vivant = false
    }
  }, [])
  useFrame(() => {
    if (!modele?.lueur) return
    const jour = useGameStore.getState().ciel.jour
    /* eslint-disable react-hooks/immutability */
    modele.lueur.emissiveIntensity = ECLAT * (1 - THREE.MathUtils.smoothstep(jour, 0.15, 0.6))
    /* eslint-enable */
  })
  return modele && <primitive object={modele.scene} />
}
