/**
 * LOT 2 — Une rampe hélicoïdale et ses colliders.
 *
 * `builders/ramp.ts` rend tout en coordonnées MONDE, élévation comprise
 * (`rampSurfacePoint` part de `ramp.baseElevation`). Contrairement à la dalle et
 * aux murs, il n'y a donc AUCUN décalage à appliquer ici : une rampe n'appartient
 * pas à un niveau, elle vit dans le vide entre deux niveaux.
 *
 * La collision n'est pas un trimesh mais une décomposition en cuboïdes inclinés
 * (spec §7.5) : le `KinematicCharacterController` de Rapier grimpe proprement
 * une suite de convexes, alors qu'il accroche aux arêtes d'un maillage de
 * collision. Ce composant se contente donc de transcrire les boîtes calculées —
 * `rotation` est déjà un triplet d'Euler XYZ, la convention de three et celle de
 * la prop `rotation`.
 */
import { useEffect, useMemo } from 'react'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import * as THREE from 'three'

import { buildRamp } from '../builders/ramp'
import type { Ramp } from '../domain/types'

export interface RampMeshProps {
  ramp: Ramp
}

export function RampMesh({ ramp }: RampMeshProps) {
  const build = useMemo(() => buildRamp(ramp), [ramp])

  const materials = useMemo(
    () => ({
      deck: new THREE.MeshStandardMaterial({ color: '#a49c8e', roughness: 0.9 }),
      railing: new THREE.MeshStandardMaterial({
        color: '#6d7176',
        roughness: 0.4,
        metalness: 0.6,
      }),
    }),
    [],
  )

  // `buildRamp` ne lève jamais : une rampe aberrante sort avec une géométrie
  // vide et un message. Sans cette remontée, l'anomalie n'existerait nulle part
  // — le bâtiment se contenterait de perdre un escalier en silence.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    for (const warning of build.warnings) console.warn(`[museum] ${warning}`)
  }, [build])

  useEffect(() => {
    return () => {
      build.geometry.dispose()
      build.railingGeometry.dispose()
      for (const material of Object.values(materials)) material.dispose()
    }
  }, [build, materials])

  return (
    <RigidBody type="fixed" colliders={false} name={`ramp:${ramp.id}`}>
      <mesh geometry={build.geometry} material={materials.deck} castShadow receiveShadow />
      <mesh geometry={build.railingGeometry} material={materials.railing} castShadow receiveShadow />

      {build.colliders.map((box, i) => (
        <CuboidCollider
          key={`deck-${i}`}
          position={[box.position.x, box.position.y, box.position.z]}
          rotation={box.rotation}
          args={[box.halfExtents.x, box.halfExtents.y, box.halfExtents.z]}
        />
      ))}
      {build.railingColliders.map((box, i) => (
        <CuboidCollider
          key={`railing-${i}`}
          position={[box.position.x, box.position.y, box.position.z]}
          rotation={box.rotation}
          args={[box.halfExtents.x, box.halfExtents.y, box.halfExtents.z]}
        />
      ))}
    </RigidBody>
  )
}
