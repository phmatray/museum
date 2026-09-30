/**
 * L'escalier impérial en marbre, à la manière de Garnier : marches crème à nez
 * arrondi, bulbes du départ, limons de griotte, palier poli à corniche
 * (`assets/architecture/escalier.glb`, `tools/blender/build-escalier.py`).
 *
 * Modélisé dans le repère du plan : il se pose tel quel. Chargé sans suspendre,
 * il ne remplace les marches en boîtes de `plan/mesh.ts` qu'une fois là
 * (`onPret`) : si le fichier manque, l'escalier d'avant reste en place. Les
 * garde-corps de verre ne sont pas dans le fichier, `mesh.ts` les garde.
 */
import { useEffect, useState } from 'react'
import type * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { brancherKTX2 } from '../io/textures'
import { fusionnerParMatiere } from './fusion'
import { eclairerModele } from './lumiere'

export function EscalierLayer({ onPret }: { onPret: () => void }) {
  const [escalier, setEscalier] = useState<THREE.Object3D | null>(null)
  useEffect(() => {
    let vivant = true
    const base = import.meta.env.BASE_URL
    const gltf = new GLTFLoader()
    const draco = new DRACOLoader()
    draco.setDecoderPath(`${base}draco/`)
    gltf.setDRACOLoader(draco)
    brancherKTX2(gltf)
      .then((g) => g.loadAsync(`${base}assets/architecture/escalier.glb`))
      .then(({ scene }) => {
        if (!vivant) return
        // La lumière du hall cuite sur le marbre (`lumiere.ts`) : il ne sort plus du mur.
        eclairerModele(scene, 'escalier')
        fusionnerParMatiere(scene)
        setEscalier(scene)
        onPret()
      })
      // Les marches en boîtes restent : l'escalier se monte toujours.
      .catch((erreur: unknown) => console.error('escalier indisponible', erreur))
      .finally(() => draco.dispose())
    return () => {
      vivant = false
    }
  }, [onPret])
  return escalier === null ? null : <primitive object={escalier} />
}
