/**
 * Le mobilier (`plan/mobilier.ts`, modèles `mobilier.glb`, `accessoires.glb`,
 * `lampadaire.glb` et `plantes.glb`) : banquettes, bancs, banque d'accueil ;
 * cordon, chaise, extincteurs, abri à vélos, caisses de Versailles, panneau et
 * fontaine ; les lampadaires du parc, les kentias de la nef et les figuiers lyres
 * de la salle d'honneur.
 *
 * Une pièce est faite de plusieurs maillages — un par matière : chêne,
 * velours, laiton… Chacun devient un lot d'instances, une par meuble posé :
 * une vingtaine d'appels de dessin pour tout le mobilier du musée. Le modèle
 * se charge une fois, sans suspendre : les murs n'attendent pas les bancs.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { MOBILIER, garniture, type Garniture, type PieceMobilier } from '../plan/mobilier'
import { LAMPES } from './lueurs'
import { chargerGlb } from './propAssets'

/** Les nœuds des fichiers : les pièces simples, et les modèles des ensembles (`garniture`). */
type Modele = Exclude<PieceMobilier, 'Cordon'> | Garniture['piece']
const FICHIERS: [string, Modele[]][] = [
  ['mobilier', ['Banquette', 'BancNef', 'Accueil', 'BancBatllo', 'BancPierre', 'BancJardin']],
  ['accessoires', ['ChaiseGardien', 'Presentoir', 'Extincteur', 'PanneauHoraires', 'Fontaine', 'Versailles', 'Potelet', 'AbriVelos']],
  ['lampadaire', ['Lampadaire']],
  // Le même fichier que les plantes des angles (`propAssets.ts`) : chargé une fois.
  ['plantes', ['Kentia', 'Lyrata']],
]
const PIECES = FICHIERS.flatMap(([, p]) => p)

interface Pose {
  x: number
  y: number
  z: number
  lacet: number
}

/** Où poser chaque modèle : un meuble à sa place (plus son accroche), un ensemble par ses garnitures. */
function poses(): Map<Modele, Pose[]> {
  const out = new Map<Modele, Pose[]>()
  const ajouter = (nom: Modele, p: Pose) => out.set(nom, [...(out.get(nom) ?? []), p])
  for (const m of MOBILIER) {
    if (m.piece === 'Cordon') for (const g of garniture(m)) ajouter(g.piece, { ...g, y: m.y })
    else ajouter(m.piece, { ...m, y: m.y + (m.accroche ?? 0) })
  }
  return out
}
const POSES = poses()

/** Un maillage d'une pièce, et sa place dans la pièce. */
interface Maillage {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  local: THREE.Matrix4
}

let modele: Promise<Map<Modele, Maillage[]> | null> | null = null
function chargerModele(): Promise<Map<Modele, Maillage[]> | null> {
  const base = import.meta.env.BASE_URL
  modele ??= (async () => {
    const pieces = new Map<Modele, Maillage[]>()
    // Un fichier qui manque n'emporte pas l'autre : les bancs sans les accessoires, plutôt que rien.
    await Promise.all(FICHIERS.map(async ([fichier, noms]) => {
      try {
        const { scene } = await chargerGlb(`${base}assets/architecture/${fichier}.glb`)
        scene.updateMatrixWorld(true)
        for (const nom of noms) {
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
      } catch (erreur) {
        console.error(`${fichier} indisponible`, erreur)
      }
    }))
    return pieces.size > 0 ? pieces : null
  })()
  return modele
}

export function MobilierLayer() {
  const [pieces, setPieces] = useState<Map<Modele, Maillage[]> | null>(null)
  // Le globe des lampadaires s'allume avec eux (`EclairageLayer`) : éteint, un verre dépoli blanc.
  const globe = useMemo(() => {
    const m = pieces?.get('Lampadaire')?.find((x) => x.material.name === 'Lampadaire_Globe')?.material
    return m instanceof THREE.MeshStandardMaterial ? m : null
  }, [pieces])
  useFrame(() => {
    /* eslint-disable react-hooks/immutability */
    if (globe) globe.emissiveIntensity = 1.5 * LAMPES.x
    /* eslint-enable */
  })
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
        const meubles = POSES.get(nom) ?? []
        return (pieces.get(nom) ?? []).map((maillage, i) => <Lot key={`${nom}-${i}`} meubles={meubles} maillage={maillage} />)
      })}
    </group>
  )
}

function Lot({ meubles, maillage }: { meubles: Pose[]; maillage: Maillage }) {
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
