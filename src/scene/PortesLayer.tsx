/**
 * L'habillage des portes (`plan/portes.ts`, modèle `chambranle.glb`) :
 * chambranles, plinthes et entablements de pierre en lots d'instances, les
 * embrasures doublées de pierre de taille, et le nom de chaque salle en
 * lettres de bronze sur la frise, côté nef — qui s'allument doucement la nuit.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { themeName, useAccrochage } from '../hooks/useAccrochage'
import { MUSEE } from '../plan/musee'
import { portes, type NomPiece, type Piece } from '../plan/portes'
import { useGameStore } from '../stores/gameStore'
import { CARTEL_FONT } from './cartelStyle'
import { Boites } from './PlanBuilding'
import { creerPierre } from './pierre'

const PORTES = portes(MUSEE)
/** La largeur de baie du modèle (`W0` de `build-chambranle.py`). */
const W0 = 2

type Modele = Record<NomPiece, THREE.Mesh>

let modele: Promise<Modele | null> | null = null
function chargerModele(): Promise<Modele | null> {
  const base = import.meta.env.BASE_URL
  modele ??= (async () => {
    const gltf = new GLTFLoader()
    const draco = new DRACOLoader()
    draco.setDecoderPath(`${base}draco/`)
    gltf.setDRACOLoader(draco)
    try {
      const { scene } = await gltf.loadAsync(`${base}assets/architecture/chambranle.glb`)
      const piece = (nom: NomPiece) => scene.getObjectByName(nom) as THREE.Mesh
      return { Chambranle: piece('Chambranle'), Entablement: piece('Entablement'), Plinthe: piece('Plinthe') }
    } catch (erreur) {
      console.error('chambranles indisponibles', erreur)
      return null
    } finally {
      draco.dispose()
    }
  })()
  return modele
}

/**
 * Élargit une pièce modelée pour W0 : chaque moitié glisse vers son côté, si
 * bien que les onglets et le profil gardent leur forme — seules les traverses
 * s'allongent.
 */
function elargir(g: THREE.BufferGeometry, largeur: number): THREE.BufferGeometry {
  const e = g.clone()
  const p = e.attributes.position
  const d = (largeur - W0) / 2
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + Math.sign(p.getX(i)) * d)
  e.computeBoundingSphere()
  return e
}

export function PortesLayer() {
  const [pieces, setPieces] = useState<Modele | null>(null)
  useEffect(() => {
    let vivant = true
    void chargerModele().then((p) => vivant && setPieces(p))
    return () => {
      vivant = false
    }
  }, [])
  const taille = useMemo(() => creerPierre(), [])
  useEffect(() => () => {
    taille.map?.dispose()
    taille.dispose()
  }, [taille])
  // Un lot par pièce et par largeur de baie : trois largeurs au plus.
  const lots = useMemo(() => {
    const par = new Map<string, Piece[]>()
    for (const p of PORTES.pieces) {
      const cle = p.nom === 'Plinthe' ? p.nom : `${p.nom}:${p.largeur}`
      par.set(cle, [...(par.get(cle) ?? []), p])
    }
    return [...par.entries()]
  }, [])
  return (
    <group name="portes">
      <Boites boites={PORTES.embrasures} material={taille} />
      {pieces && lots.map(([cle, ps]) => <Lot key={cle} pieces={ps} mesh={pieces[ps[0].nom]} />)}
      <Suspense fallback={null}>
        <Enseignes />
      </Suspense>
    </group>
  )
}

function Lot({ pieces: ps, mesh: modele }: { pieces: Piece[]; mesh: THREE.Mesh }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const { nom, largeur } = ps[0]
  const geometry = useMemo(() => (nom === 'Plinthe' ? modele.geometry : elargir(modele.geometry, largeur)), [modele, nom, largeur])
  useEffect(() => () => {
    if (geometry !== modele.geometry) geometry.dispose()
  }, [geometry, modele])
  useEffect(() => {
    const mesh = ref.current
    if (mesh === null) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const un = new THREE.Vector3(1, 1, 1)
    ps.forEach((p, i) => mesh.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.lacet), un)))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [ps])
  // Le matériau en prop, jamais dans `args` : un `args` qui change reconstruit le maillage (#35).
  return <instancedMesh key={ps.length} ref={ref} args={[geometry, undefined, ps.length]} material={modele.material} />
}

/** « BLAZOR · 9 PROJETS » : le thème de la salle et le nombre de ses œuvres, en bronze sur la frise. */
function Enseignes() {
  const accrochage = useAccrochage()
  // La nuit, le bronze s'éclaire d'une lueur chaude, comme l'enseigne de la façade.
  const nuit = 1 - useGameStore((s) => s.ciel.jour)
  const bronze = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7a5a2e', metalness: 0.7, roughness: 0.38, emissive: '#ffc878', emissiveIntensity: 0 }), [])
  useEffect(() => () => bronze.dispose(), [bronze])
  /* eslint-disable react-hooks/immutability -- l'éclat du bronze suit le ciel */
  useEffect(() => {
    bronze.emissiveIntensity = 0.55 * nuit
  }, [bronze, nuit])
  /* eslint-enable react-hooks/immutability */
  if (accrochage === null) return null
  return (
    <>
      {PORTES.enseignes.map((e) => {
        const salle = accrochage.rooms.find((r) => r.id === e.salle && r.level === e.level)
        const n = salle?.placements.length ?? 0
        const texte = `${themeName(accrochage, e.salle, e.level, e.salle).toUpperCase()} · ${n} PROJET${n > 1 ? 'S' : ''}`
        // Le texte tient sur la frise : la taille suit sa longueur (~0,72 em par signe, espacement compris).
        const taille = Math.min(0.15, (e.longueur - 0.3) / (texte.length * 0.72))
        return (
          <Text
            key={`${e.level}:${e.salle}`}
            font={CARTEL_FONT}
            position={[e.x, e.y, e.z]}
            rotation={[0, e.lacet, 0]}
            fontSize={taille}
            letterSpacing={0.12}
            material={bronze}
            anchorX="center"
            anchorY="middle"
          >
            {texte}
          </Text>
        )
      })}
    </>
  )
}
