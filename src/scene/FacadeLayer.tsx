/**
 * La façade à l'écran (`plan/facade.ts`) : brique, portique de pierre, le nom
 * du musée, deux bannières qui annoncent les pièces maîtresses de la salle
 * d'honneur, et quatre drapeaux aux couleurs de Microsoft : la collection est
 * d'abord du C#.
 */
import { Suspense, useEffect, useMemo } from 'react'
import { Text } from '@react-three/drei'
import * as THREE from 'three'

import config from '../../museum.config.json'
import { useAccrochage } from '../hooks/useAccrochage'
import { useGameStore } from '../stores/gameStore'
import { facade } from '../plan/facade'
import { MUSEE } from '../plan/musee'
import { CARTEL_FONT } from './cartelStyle'
import { useMatiere } from './materials'
import { Boites } from './PlanBuilding'
import { creerBrique, creerCannelure, creerGranit, creerPierre } from './pierre'

const FACADE = facade(MUSEE)
/** Les quatre carrés du logo Microsoft, dans l'ordre du logo. */
const DRAPEAUX = ['#f25022', '#7fba00', '#00a4ef', '#ffb900']
const MAT = 4
const DRAPEAU: [number, number] = [1.5, 1]

export function FacadeLayer() {
  const mats = useMemo(
    () => ({
      brique: creerBrique(),
      pierre: creerPierre(),
      cannelure: creerCannelure(),
      metal: creerGranit(),
      vitre: new THREE.MeshStandardMaterial({ color: '#1f2b31', metalness: 0.6, roughness: 0.12 }),
    }),
    [],
  )
  useEffect(() => () => Object.values(mats).forEach((m) => { m.map?.dispose(); m.dispose() }), [mats])
  const acier = useMatiere('metal')
  // La nuit, les lettres s'allument, comme une enseigne rétroéclairée.
  const nuit = 1 - useGameStore((s) => s.ciel.jour)

  return (
    <group name="facade">
      <Boites boites={FACADE.brique} material={mats.brique} />
      <Boites boites={FACADE.pierre} material={mats.pierre} />
      <Boites boites={FACADE.piliers} material={mats.cannelure} />
      <Boites boites={FACADE.vitres} material={mats.vitre} />
      <Boites boites={FACADE.menuiseries} material={mats.metal} />
      <Suspense fallback={null}>
        <Text
          font={CARTEL_FONT}
          position={[FACADE.enseigne.x, FACADE.enseigne.y, FACADE.enseigne.z]}
          fontSize={0.72}
          letterSpacing={0.14}
          color={nuit > 0.5 ? '#ffd98a' : '#3a2c1c'}
          anchorX="center"
          anchorY="middle"
        >
          {config.name.toUpperCase()}
        </Text>
        <Bannieres />
      </Suspense>
      {FACADE.mats.map((m, i) => (
        <Drapeau key={i} position={[m.x, m.y, m.z]} couleur={DRAPEAUX[i % DRAPEAUX.length]} acier={acier} />
      ))}
    </group>
  )
}

/** Les deux premières œuvres de la salle d'honneur : les dépôts les plus étoilés. */
function Bannieres() {
  const accrochage = useAccrochage()
  const cles = accrochage?.rooms.find((r) => r.id === 'honneur')?.placements.slice(0, 2).map((p) => p.key) ?? []
  return (
    <>
      {FACADE.bannieres.map((b, i) => {
        const cle = cles[i]
        if (!cle) return null
        const [proprietaire, nom] = cle.split('/')
        return (
          <group key={cle} position={[b.x, b.y, b.z]}>
            <mesh>
              <planeGeometry args={[b.w, b.h]} />
              <meshStandardMaterial color="#f4f1ea" roughness={0.9} side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[0, b.h / 2 + 0.03, 0.02]}>
              <boxGeometry args={[b.w + 0.2, 0.05, 0.05]} />
              <meshStandardMaterial color="#2b2a28" metalness={0.6} roughness={0.4} />
            </mesh>
            <Text font={CARTEL_FONT} position={[0, b.h / 2 - 0.35, 0.01]} fontSize={0.16} letterSpacing={0.1} color="#6a6158" anchorX="center" anchorY="top">
              SALLE D’HONNEUR
            </Text>
            {/* Le nom tient sur une ligne : la taille suit sa longueur (0,55 em par signe). */}
            <Text font={CARTEL_FONT} position={[0, 0.4, 0.01]} fontSize={Math.min(0.42, (b.w - 0.3) / (nom.length * 0.55))} color="#1c1a18" anchorX="center" anchorY="middle">
              {nom}
            </Text>
            <Text font={CARTEL_FONT} position={[0, -b.h / 2 + 0.45, 0.01]} fontSize={0.15} maxWidth={b.w - 0.3} textAlign="center" color="#946a22" anchorX="center" anchorY="bottom">
              {proprietaire}
            </Text>
          </group>
        )
      })}
    </>
  )
}

/** Un mât et son drapeau, ondulé une fois pour toutes : une toile au vent, pas une planche. */
function Drapeau({ position, couleur, acier }: { position: [number, number, number]; couleur: string; acier: THREE.Material }) {
  const toile = useMemo(() => {
    const g = new THREE.PlaneGeometry(DRAPEAU[0], DRAPEAU[1], 16, 4)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + DRAPEAU[0] / 2
      p.setZ(i, Math.sin(x * 3.2) * 0.08 * x)
    }
    g.computeVertexNormals()
    g.translate(DRAPEAU[0] / 2, 0, 0)
    return g
  }, [])
  useEffect(() => () => toile.dispose(), [toile])
  return (
    <group position={position}>
      <mesh position={[0, MAT / 2, 0]} material={acier}>
        <cylinderGeometry args={[0.035, 0.05, MAT, 8]} />
      </mesh>
      <mesh geometry={toile} position={[0.04, MAT - DRAPEAU[1] / 2 - 0.05, 0]} rotation={[0, Math.PI / 5, 0]}>
        <meshStandardMaterial color={couleur} roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}
