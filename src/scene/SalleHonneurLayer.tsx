/**
 * La salle d'honneur habillée à la manière de la Casa Batlló, autour de la baie
 * de Gaudí (`assets/architecture/salle-honneur.glb`, `tools/blender/
 * build-salle-honneur.py`) : voûte de plâtre en tourbillon, lampe-soleil,
 * enduit crème aux angles arrondis, lambris et encadrements de chêne, pilastres
 * en os, parquet en point de Hongrie.
 *
 * Modélisée dans le repère du plan : posée telle quelle. Le parquet reçoit la
 * matière de parquet du musée (la teinte de chaque lame est dans ses sommets) ;
 * la lampe s'allume plus fort la nuit, et une lumière part d'elle.
 */
import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { useGameStore } from '../stores/gameStore'
import { useMatiere } from './materials'

/** La lampe, au centre de la voûte (`SOMMET` du script Blender). */
const LAMPE: [number, number, number] = [24, 9.95, 6]

export function SalleHonneurLayer() {
  const [salle, setSalle] = useState<THREE.Object3D | null>(null)
  useEffect(() => {
    let vivant = true
    const base = import.meta.env.BASE_URL
    const gltf = new GLTFLoader()
    const draco = new DRACOLoader()
    draco.setDecoderPath(`${base}draco/`)
    gltf.setDRACOLoader(draco)
    gltf
      .loadAsync(`${base}assets/architecture/salle-honneur.glb`)
      .then(({ scene }) => vivant && setSalle(scene))
      .catch((erreur: unknown) => console.error('salle d’honneur indisponible', erreur))
      .finally(() => draco.dispose())
    return () => {
      vivant = false
    }
  }, [])

  // Le parquet du musée, UV en mètres / 3 posées lame par lame par Blender.
  const parquet = useMatiere('parquet', [1, 1], { teinte: '#f0c890' })
  const nuit = 1 - useGameStore((s) => s.ciel.jour)
  /* eslint-disable react-hooks/immutability -- matières du GLB, réglées en place */
  useEffect(() => {
    if (salle === null) return
    parquet.vertexColors = true
    parquet.needsUpdate = true
    const lames = salle.getObjectByName('Parquet')
    if (lames instanceof THREE.Mesh) lames.material = parquet
  }, [salle, parquet])
  useEffect(() => {
    salle?.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const m = o.material as THREE.MeshStandardMaterial
      if (m.name === 'Honneur_Soleil') m.emissiveIntensity = 1.4 + 2.6 * nuit
      else if (m.name === 'Honneur_Ambre') m.emissiveIntensity = 0.8 + 1.6 * nuit
      else if (m.name === 'Honneur_Laiton') m.emissiveIntensity = 0.25 + 0.45 * nuit
      else if (m.name.startsWith('Honneur_Cive')) m.emissiveIntensity = 0.35 + 0.5 * nuit
    })
  }, [salle, nuit])
  /* eslint-enable react-hooks/immutability */

  return (
    <>
      {salle !== null && <primitive object={salle} />}
      {/* Le soleil de la voûte, toujours monté : une lumière ajoutée plus tard recompilerait toutes les matières. */}
      <pointLight position={LAMPE} color="#ffd6a0" intensity={6 + 10 * nuit} distance={16} decay={1.3} />
    </>
  )
}
