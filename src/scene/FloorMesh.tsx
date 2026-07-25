/**
 * LOT 2 — Un niveau.
 *
 * UN GROUPE PAR ÉTAGE, et c'est le point : le culling du lot 3 (spec §9.3,
 * « un plateau hors champ se saute d'un bloc ») ne demandera qu'à basculer la
 * visibilité de ce groupe. Tout ce qui appartient au niveau y est, rien de ce
 * qui appartient à un autre niveau n'y entre.
 *
 * Le niveau porte quatre choses :
 *
 *  - **la dalle**, emprise moins trémies, dont la face supérieure est à
 *    `floor.elevation` : c'est le sol sur lequel on marche, et son collider est
 *    ce qui empêche de traverser le bâtiment ;
 *  - **le garde-corps** du périmètre des trémies, seul obstacle entre le joueur
 *    et le vide de l'atrium — il a donc un collider, pas seulement une
 *    silhouette ;
 *  - **les salles**, qui n'apportent que leurs murs (voir `RoomMesh` : le sol et
 *    le plafond d'une salle sont les dalles, pas des plans supplémentaires) ;
 *  - **la toiture**, au dernier niveau seulement — celui qui n'a pas de dalle
 *    au-dessus de lui. Elle est percée de la même trémie que la dalle, ce qui
 *    fait de l'atrium le puits de lumière zénithal du spec §9.2.
 *
 * Les colliders de la dalle et du garde-corps vivent dans le MÊME `RigidBody`
 * que leurs maillages, posé à l'élévation du niveau : impossible de déplacer
 * l'un sans l'autre.
 */
import { useEffect, useMemo } from 'react'
import { RigidBody, TrimeshCollider } from '@react-three/rapier'
import * as THREE from 'three'

import { RAILING_HEIGHT, buildRailing, buildSlab } from '../builders/slab'
import type { Floor } from '../domain/types'
import { RoomMesh } from './RoomMesh'

export interface FloorMeshProps {
  floor: Floor
  /** Épaisseur de dalle, depuis `museum.config.building`. */
  slabThickness: number
  /**
   * Vrai quand aucune dalle ne couvre ce niveau. Ce n'est pas une décision de
   * ce composant : `MuseumScene` la lit dans la liste des niveaux.
   */
  isTopFloor: boolean
}

/** Épaisseur de la toiture. Plus fine qu'une dalle : elle ne porte personne. */
const ROOF_THICKNESS = 0.3

export function FloorMesh({ floor, slabThickness, isTopFloor }: FloorMeshProps) {
  const slab = useMemo(
    () => buildSlab(floor.footprint, floor.slabHoles, slabThickness),
    [floor.footprint, floor.slabHoles, slabThickness],
  )

  // Pas de trémie, pas de garde-corps : au niveau le plus bas la dalle est
  // pleine, et poser un garde-corps de zéro segment coûterait un draw call pour
  // un maillage vide.
  const railing = useMemo(
    () =>
      slab.railingSegments.length > 0
        ? buildRailing(slab.railingSegments, RAILING_HEIGHT)
        : null,
    [slab],
  )

  // La toiture reprend exactement la découpe de la dalle : l'atrium reste
  // ouvert sur le ciel, ce qui donne la verrière zénithale sans modéliser de
  // verrière.
  const roof = useMemo(
    () =>
      isTopFloor
        ? buildSlab(floor.footprint, floor.slabHoles, ROOF_THICKNESS).geometry
        : null,
    [isTopFloor, floor.footprint, floor.slabHoles],
  )

  const materials = useMemo(
    () => ({
      slab: new THREE.MeshStandardMaterial({ color: '#8f8b83', roughness: 0.95 }),
      railing: new THREE.MeshStandardMaterial({
        color: '#6d7176',
        roughness: 0.4,
        metalness: 0.6,
      }),
      roof: new THREE.MeshStandardMaterial({ color: '#c9c3b6', roughness: 0.9 }),
    }),
    [],
  )

  // Rien de ce qui est construit ici n'est libéré par R3F : il ne dispose que ce
  // qu'il a créé lui-même en JSX.
  useEffect(() => {
    return () => {
      slab.geometry.dispose()
      railing?.geometry.dispose()
      roof?.dispose()
      for (const material of Object.values(materials)) material.dispose()
    }
  }, [slab, railing, roof, materials])

  return (
    <group name={`floor:${floor.id}`}>
      <RigidBody
        type="fixed"
        colliders={false}
        position={[0, floor.elevation, 0]}
        name={`slab:${floor.id}`}
      >
        <mesh geometry={slab.geometry} material={materials.slab} receiveShadow castShadow />
        <TrimeshCollider args={[slab.collider.vertices, slab.collider.indices]} />

        {railing && (
          <>
            <mesh geometry={railing.geometry} material={materials.railing} castShadow receiveShadow />
            <TrimeshCollider args={[railing.collider.vertices, railing.collider.indices]} />
          </>
        )}
      </RigidBody>

      {roof && (
        // Pas de collider : la toiture est à 4,3 m au-dessus du plancher, hors
        // d'atteinte d'un personnage qui ne saute pas. Un trimesh de plus ne
        // servirait qu'à ralentir les requêtes de Rapier.
        <mesh
          geometry={roof}
          material={materials.roof}
          // `buildSlab` fait pendre l'épaisseur SOUS son origine : on remonte
          // donc d'une épaisseur pour que le dessous de la toiture affleure
          // exactement le plafond du niveau.
          position={[0, floor.elevation + floor.ceilingHeight + ROOF_THICKNESS, 0]}
          castShadow
          receiveShadow
        />
      )}

      {floor.rooms.map((room) => (
        <RoomMesh key={room.id} room={room} elevation={floor.elevation} />
      ))}
    </group>
  )
}
