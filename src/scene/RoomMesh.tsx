/**
 * LOT 2 — Une salle.
 *
 * Ce composant NE DÉCIDE RIEN : `domain/layout.ts` a posé les murs,
 * `builders/wall.ts` les a transformés en triangles, il ne reste qu'à les
 * accrocher au graphe de scène et à leur donner un collider.
 *
 * ── Pourquoi une salle n'a ni sol ni plafond à elle ──
 *
 * Le sol d'une salle EST la dalle du niveau, dont la face supérieure est
 * exactement à `floor.elevation` ; son plafond EST la dalle du niveau
 * au-dessus, dont la face inférieure est exactement à
 * `elevation + ceilingHeight` (par construction : `elevation(n+1) =
 * elevation(n) + ceilingHeight + slabThickness`). Dessiner en plus un plan de
 * sol et un plan de plafond mettrait deux surfaces EXACTEMENT coplanaires sur
 * toute l'emprise du bâtiment — le z-fighting le plus visible qu'on puisse
 * fabriquer — et doublerait le nombre de draw calls pour n'ajouter aucune
 * matière. Le dernier niveau, qui n'a pas de dalle au-dessus, reçoit une
 * toiture ; c'est `FloorMesh` qui la pose, parce qu'elle couvre le niveau
 * entier et non une salle.
 *
 * ── Repère ──
 *
 * `buildWall` rend un mur en x/z monde avec `y = 0` au plancher DU NIVEAU. Le
 * `RigidBody` est donc posé à `[0, elevation, 0]` et porte à la fois les
 * maillages et les colliders : on ne peut pas déplacer ce qu'on voit sans
 * déplacer ce qu'on heurte.
 */
import { useEffect, useMemo } from 'react'
import { RigidBody, TrimeshCollider } from '@react-three/rapier'
import * as THREE from 'three'

import { buildWall } from '../builders/wall'
import type { Room, ThemeId } from '../domain/types'

export interface RoomMeshProps {
  room: Room
  /** Élévation du plancher du niveau, en mètres. */
  elevation: number
}

/**
 * Couleur des murs par thème.
 *
 * Les thèmes viennent de la curation (`RoomOverride.theme`) et sont pour
 * l'instant la seule variation visuelle entre deux salles : le lot 2 ne rend
 * aucune œuvre, sans cela toutes les salles seraient rigoureusement identiques
 * et on ne saurait pas où l'on est. Un matériau par salle, pas par mur — quatre
 * murs partagent le même, ce qui divise par quatre le nombre de matériaux.
 */
const THEME_WALL_COLOR: Record<ThemeId, string> = {
  classic: '#e6dfd2',
  modern: '#f1f1ef',
  // Les deux thèmes sombres restent bien plus clairs que ce que leur nom
  // suggère : sous deux lumières seulement, un mur à 20 % de gris tombe au noir
  // pur dès qu'il n'est pas dans le puits de lumière, et la salle devient une
  // grotte où l'on ne distingue plus les angles. Mesuré à l'écran.
  immersive: '#575e69',
  vault: '#635d54',
}

export function RoomMesh({ room, elevation }: RoomMeshProps) {
  // `buildWall` est pur et déterministe : le mémoriser sur l'identité de la
  // salle suffit, et évite de reconstruire soixante murs à chaque rendu.
  const walls = useMemo(() => room.walls.map((wall) => buildWall(wall)), [room])

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: THEME_WALL_COLOR[room.theme],
        roughness: 0.92,
        metalness: 0,
      }),
    [room.theme],
  )

  // Les géométries et matériaux construits à la main ne sont PAS libérés par
  // R3F, qui ne dispose que ce qu'il a lui-même créé en JSX. Sans ceci, changer
  // de musée à chaud fuirait un tampon GPU par mur.
  useEffect(() => {
    return () => {
      for (const wall of walls) wall.geometry.dispose()
      material.dispose()
    }
  }, [walls, material])

  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[0, elevation, 0]}
      name={`room:${room.id}`}
    >
      {walls.map((built, i) => (
        <mesh
          key={room.walls[i].id}
          name={room.walls[i].id}
          geometry={built.geometry}
          material={material}
          castShadow
          receiveShadow
        />
      ))}
      {walls.map((built, i) =>
        // Un mur dégénéré sort avec un collider vide ; le lui donner quand même
        // ferait construire un trimesh sans triangle, que Rapier refuse.
        built.collider.indices.length === 0 ? null : (
          <TrimeshCollider
            key={room.walls[i].id}
            args={[built.collider.vertices, built.collider.indices]}
          />
        ),
      )}
    </RigidBody>
  )
}
