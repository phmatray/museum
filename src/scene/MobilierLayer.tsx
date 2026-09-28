/**
 * Le mobilier (`plan/mobilier.ts`, modèle `mobilier.glb`) : banquettes,
 * bancs de la nef, banque d'accueil, bancs Batlló et bancs du jardin.
 *
 * Une pièce est faite de plusieurs maillages — un par matière : chêne,
 * velours, laiton… Chacun devient un lot d'instances, une par meuble posé :
 * une vingtaine d'appels de dessin pour tout le mobilier du musée. Le modèle
 * se charge une fois, sans suspendre : les murs n'attendent pas les bancs.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { MOBILIER, type Meuble, type PieceMobilier } from '../plan/mobilier'

const PIECES: PieceMobilier[] = ['Banquette', 'BancNef', 'Accueil', 'BancBatllo', 'BancPierre', 'BancJardin']

/** Un maillage d'une pièce, et sa place dans la pièce. */
interface Maillage {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  local: THREE.Matrix4
}

let modele: Promise<Map<PieceMobilier, Maillage[]> | null> | null = null
function chargerModele(): Promise<Map<PieceMobilier, Maillage[]> | null> {
  const base = import.meta.env.BASE_URL
  modele ??= (async () => {
    const gltf = new GLTFLoader()
    const draco = new DRACOLoader()
    draco.setDecoderPath(`${base}draco/`)
    gltf.setDRACOLoader(draco)
    try {
      const { scene } = await gltf.loadAsync(`${base}assets/architecture/mobilier.glb`)
      scene.updateMatrixWorld(true)
      const pieces = new Map<PieceMobilier, Maillage[]>()
      for (const nom of PIECES) {
        const racine = scene.getObjectByName(nom)
        if (!racine) continue
        const inverse = racine.matrixWorld.clone().invert()
        const maillages: Maillage[] = []
        racine.traverse((o) => {
          const m = o as THREE.Mesh
          if (m.isMesh) maillages.push({ geometry: m.geometry, material: m.material as THREE.Material, local: inverse.clone().multiply(m.matrixWorld) })
        })
        pieces.set(nom, maillages)
      }
      return pieces
    } catch (erreur) {
      console.error('mobilier indisponible', erreur)
      return null
    } finally {
      draco.dispose()
    }
  })()
  return modele
}

export function MobilierLayer() {
  const [pieces, setPieces] = useState<Map<PieceMobilier, Maillage[]> | null>(null)
  useEffect(() => {
    let vivant = true
    void chargerModele().then((p) => vivant && setPieces(p))
    return () => {
      vivant = false
    }
  }, [])
  if (pieces === null) return null
  return (
    <group name="mobilier">
      {PIECES.flatMap((nom) => {
        const meubles = MOBILIER.filter((m) => m.piece === nom)
        return (pieces.get(nom) ?? []).map((maillage, i) => <Lot key={`${nom}-${i}`} meubles={meubles} maillage={maillage} />)
      })}
    </group>
  )
}

function Lot({ meubles, maillage }: { meubles: Meuble[]; maillage: Maillage }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const matrices = useMemo(() => {
    const q = new THREE.Quaternion()
    const y = new THREE.Vector3(0, 1, 0)
    const un = new THREE.Vector3(1, 1, 1)
    return meubles.map((m) => new THREE.Matrix4().compose(new THREE.Vector3(m.x, m.y, m.z), q.setFromAxisAngle(y, m.lacet), un).multiply(maillage.local))
  }, [meubles, maillage])
  useEffect(() => {
    const mesh = ref.current
    if (mesh === null) return
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [matrices])
  // Le matériau en prop, jamais dans `args` : un `args` qui change reconstruit le maillage (#35).
  return <instancedMesh key={matrices.length} ref={ref} args={[maillage.geometry, undefined, matrices.length]} material={maillage.material} />
}
