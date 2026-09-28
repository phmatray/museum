/**
 * La nef du hall, à la manière d'Orsay : voûte à caissons, verrière, horloge et
 * lanternes (`assets/architecture/nef.glb`, `tools/blender/build-nef.py`).
 *
 * Le fichier est modélisé dans le repère du plan : il se pose tel quel, sans
 * transformation. Chargé sans suspendre : le bâtiment d'abord, la voûte ensuite.
 *
 * L'horloge donne l'heure du visiteur : ses deux aiguilles sont des nœuds à
 * part, pointés sur midi, qu'on tourne à chaque image autour de leur axe.
 */
import { useEffect, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { useGameStore } from '../stores/gameStore'
import { anglesHorloge } from './horloge'
import { ruisseler } from './intemperies'

export function NefLayer() {
  const [nef, setNef] = useState<THREE.Object3D | null>(null)
  useFrame(() => {
    if (nef === null) return
    const { heures, minutes } = anglesHorloge(new Date())
    // Le cadran regarde +z : vu du hall, le sens horaire est une rotation négative autour de z.
    const [h, m] = [nef.getObjectByName('Nef_Aiguille_Heures'), nef.getObjectByName('Nef_Aiguille_Minutes')]
    if (h) h.rotation.z = -heures
    if (m) m.rotation.z = -minutes
  })
  useEffect(() => {
    let vivant = true
    const base = import.meta.env.BASE_URL
    const gltf = new GLTFLoader()
    const draco = new DRACOLoader()
    draco.setDecoderPath(`${base}draco/`)
    gltf.setDRACOLoader(draco)
    gltf
      .loadAsync(`${base}assets/architecture/nef.glb`)
      .then(({ scene }) => {
        // Le verre ne masque rien derrière lui : sans ça, la verrière cachait
        // l'horloge et les pannes selon l'ordre de tri.
        scene.traverse((o) => {
          if (o instanceof THREE.Mesh && (o.material as THREE.Material).transparent) (o.material as THREE.Material).depthWrite = false
          // Et la pluie y ruisselle, sur la verrière comme sur le pignon.
          if (o instanceof THREE.Mesh && (o.material as THREE.Material).name === 'Nef_Verre') ruisseler(o.material as THREE.Material)
        })
        if (vivant) setNef(scene)
      })
      // Le musée reste visitable à ciel ouvert.
      .catch((erreur: unknown) => console.error('nef indisponible', erreur))
      .finally(() => draco.dispose())
    return () => {
      vivant = false
    }
  }, [])
  // La nuit, la verrière cesse de luire (on voit les étoiles au travers) et les
  // lanternes brûlent plus fort. Les matières gardent leur nom de Blender.
  const jour = useGameStore((s) => s.ciel.jour)
  useEffect(() => {
    if (nef === null) return
    nef.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const m = o.material as THREE.MeshStandardMaterial
      if (m.name === 'Nef_Verre') {
        m.emissiveIntensity = 0.08 + 0.47 * jour
        m.opacity = 0.3 + 0.25 * jour
      } else if (m.name === 'Nef_Opale') m.emissiveIntensity = 3 + 3 * (1 - jour)
    })
  }, [nef, jour])
  return nef === null ? null : <primitive object={nef} />
}
