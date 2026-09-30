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
import { fusionnerParMatiere, unePasse, unifierParCouleur } from './fusion'
import { eclairerMatiere, eclairerModele } from './lumiere'
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
      .then(({ scene }) => {
        if (!vivant) return
        // Les cives du vitrail en une matière, AVANT la lumière cuite : un clone n'en garderait pas la greffe.
        unifierParCouleur(scene, 'Honneur_Cive')
        eclairerModele(scene, 'salle-honneur') // la lumière cuite de la salle (`lumiere.ts`)
        // Un appel par matière ; le parquet reçoit plus bas la matière du musée, par son nom.
        fusionnerParMatiere(scene, (o) => o.name === 'Parquet')
        unePasse(scene)
        setSalle(scene)
      })
      .catch((erreur: unknown) => console.error('salle d’honneur indisponible', erreur))
      .finally(() => draco.dispose())
    return () => {
      vivant = false
    }
  }, [])

  // Le parquet du musée, UV en mètres / 3 posées lame par lame par Blender.
  const parquet = useMatiere('parquet', [1, 1])
  const nuit = 1 - useGameStore((s) => s.ciel.jour)
  /* eslint-disable react-hooks/immutability -- matières du GLB, réglées en place */
  useEffect(() => {
    if (salle === null) return
    // Un chêne naturel, pas un orange : la carte (un noyer, 0,236 / 0,122 / 0,051
    // en linéaire) multipliée par les teintes chaudes des lames et l'ancien
    // miel #f0c890 sortait à 17 : 6 : 1 — sous la lampe ambrée, de la brique. On
    // vise l'albédo que la lumière cuite suppose déjà (`ALBEDO["parquet"]` de
    // `bake-lumiere.py`, 0,32 / 0,19 / 0,10), un peu plus bas : (0,27, 0,16,
    // 0,085) une fois divisé par la carte et la teinte moyenne des lames (sans
    // carte, le temps qu'elle arrive : l'albédo lui-même).
    if (parquet.map) parquet.color.setRGB(1.2, 1.5, 2.25)
    else parquet.color.setRGB(0.28, 0.18, 0.115)
    parquet.vertexColors = true
    eclairerMatiere(parquet)
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
