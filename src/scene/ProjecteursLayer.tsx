/**
 * Les projecteurs sur rail (`plan/projecteurs.ts`, modèle `projecteur.glb`) :
 * un par toile, en trois lots d'instances — monture, tête inclinée, lentille —
 * et les rails en boîtes. La lentille du projecteur de la toile regardée
 * s'allume en fondu : la lumière de `EveilLayer` part de là.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { useAccrochage } from '../hooks/useAccrochage'
import { MUSEE } from '../plan/musee'
import { projecteurs, rails, type Projecteur } from '../plan/projecteurs'
import { useGameStore } from '../stores/gameStore'
import { Boites } from './PlanBuilding'

type Pieces = Record<'Monture' | 'Tete' | 'Lentille', { geometry: THREE.BufferGeometry; material: THREE.Material; pivot: THREE.Vector3 }>

let modele: Promise<Pieces | null> | null = null
function chargerModele(): Promise<Pieces | null> {
  const base = import.meta.env.BASE_URL
  modele ??= (async () => {
    const gltf = new GLTFLoader()
    const draco = new DRACOLoader()
    draco.setDecoderPath(`${base}draco/`)
    gltf.setDRACOLoader(draco)
    try {
      const { scene } = await gltf.loadAsync(`${base}assets/architecture/projecteur.glb`)
      const piece = (nom: string) => {
        const m = scene.getObjectByName(nom) as THREE.Mesh
        return { geometry: m.geometry, material: m.material as THREE.Material, pivot: m.position.clone() }
      }
      return { Monture: piece('Monture'), Tete: piece('Tete'), Lentille: piece('Lentille') }
    } catch (erreur) {
      console.error('projecteurs indisponibles', erreur)
      return null
    } finally {
      draco.dispose()
    }
  })()
  return modele
}

/** La matrice d'une pièce : au point d'accroche, tournée vers le mur, la tête inclinée. */
function matrice(p: Projecteur, pivot: THREE.Vector3, incliner: boolean, m = new THREE.Matrix4()): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(incliner ? p.inclinaison : 0, p.lacet, 0, 'YXZ'))
  return m.compose(new THREE.Vector3(p.x, p.y + pivot.y, p.z), q, new THREE.Vector3(1, 1, 1))
}

export function ProjecteursLayer() {
  const accrochage = useAccrochage()
  const [pieces, setPieces] = useState<Pieces | null>(null)
  useEffect(() => {
    let vivant = true
    void chargerModele().then((p) => vivant && setPieces(p))
    return () => {
      vivant = false
    }
  }, [])
  const tous = useMemo(() => (accrochage ? projecteurs(MUSEE, accrochage) : []), [accrochage])
  const lesRails = useMemo(() => (accrochage ? rails(MUSEE, accrochage) : []), [accrochage])
  if (pieces === null || tous.length === 0) return null
  return (
    <group name="projecteurs">
      <Boites boites={lesRails} material={pieces.Monture.material} />
      <Lot projecteurs={tous} piece={pieces.Monture} incliner={false} />
      <Lot projecteurs={tous} piece={pieces.Tete} incliner />
      <Lot projecteurs={tous} piece={pieces.Lentille} incliner />
      <LentilleAllumee projecteurs={tous} piece={pieces.Lentille} />
    </group>
  )
}

function Lot({ projecteurs: ps, piece, incliner }: { projecteurs: Projecteur[]; piece: Pieces['Tete']; incliner: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useEffect(() => {
    const mesh = ref.current
    if (mesh === null) return
    const m = new THREE.Matrix4()
    ps.forEach((p, i) => mesh.setMatrixAt(i, matrice(p, piece.pivot, incliner, m)))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [ps, piece, incliner])
  // Le matériau en prop, jamais dans `args` : un `args` qui change reconstruit le maillage (#35).
  return <instancedMesh key={ps.length} ref={ref} args={[piece.geometry, undefined, ps.length]} material={piece.material} />
}

/** La lentille du projecteur de la toile regardée, qui s'allume et s'éteint en fondu. */
function LentilleAllumee({ projecteurs: ps, piece }: { projecteurs: Projecteur[]; piece: Pieces['Lentille'] }) {
  const toile = useGameStore((s) => s.toile)
  const actif = useMemo(() => ps.find((p) => p.key === toile) ?? null, [ps, toile])
  const ref = useRef<THREE.Mesh>(null)
  const materiau = useMemo(() => new THREE.MeshStandardMaterial({ color: '#fff1d6', emissive: '#ffe2b0', emissiveIntensity: 0, toneMapped: false }), [])
  useEffect(() => () => materiau.dispose(), [materiau])
  useEffect(() => {
    const mesh = ref.current
    if (mesh === null || actif === null) return
    // Un cheveu devant la lentille éteinte, pour ne pas se battre avec elle.
    matrice(actif, piece.pivot, true, mesh.matrix).multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.002))
    mesh.matrixWorldNeedsUpdate = true
  }, [actif, piece])
  /* eslint-disable react-hooks/immutability -- l'intensité du matériau, fondue en place */
  useFrame((_, dt) => {
    const vise = actif === null ? 0 : 4
    materiau.emissiveIntensity += (vise - materiau.emissiveIntensity) * (1 - Math.exp(-6 * dt))
  })
  /* eslint-enable react-hooks/immutability */
  return <mesh ref={ref} geometry={piece.geometry} material={materiau} matrixAutoUpdate={false} />
}
