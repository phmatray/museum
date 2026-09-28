/**
 * La nef du hall, à la manière d'Orsay : voûte à caissons, verrière, horloge et
 * lanternes (`assets/architecture/nef.glb`, `tools/blender/build-nef.py`).
 *
 * Le fichier est modélisé dans le repère du plan : il se pose tel quel, sans
 * transformation. Chargé sans suspendre : le bâtiment d'abord, la voûte ensuite.
 */
import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export function NefLayer() {
  const [nef, setNef] = useState<THREE.Object3D | null>(null)
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
  return nef === null ? null : <primitive object={nef} />
}
