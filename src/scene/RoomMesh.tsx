/**
 * LOT 2/3 — Une salle.
 *
 * Ce composant NE DÉCIDE RIEN : `domain/layout.ts` a posé les murs,
 * `builders/wall.ts` les a transformés en triangles, `scene/lighting.ts` a
 * décidé de quoi ils ont l'air ; il ne reste qu'à les accrocher au graphe de
 * scène et à leur donner un collider.
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

import { buildWall } from '../builders/wall'
import type { Room } from '../domain/types'
import { createWallMaterial } from './lighting'
import {
  appliquerCartes,
  matiereDeMur,
  repetitionDeMatiere,
  useCartes,
} from './materials'

export interface RoomMeshProps {
  room: Room
  /** Élévation du plancher du niveau, en mètres. */
  elevation: number
}

/**
 * Échelle du béton, la seule matière commune à toutes les salles.
 *
 * `buildWall` extrude une `Shape` : three y applique son `WorldUVGenerator`, qui
 * recopie les coordonnées du plan du mur — en MÈTRES — dans l'UV. La répétition
 * ne dépend donc PAS des dimensions du mur, et c'est exactement ce qui fait
 * qu'un mur d'enceinte de 38 m et une cloison de 7 m montrent le même béton, à
 * la même échelle. Voir `materials.repetitionMonde`.
 */
const REPETITION_BETON = repetitionDeMatiere('beton')

export function RoomMesh({ room, elevation }: RoomMeshProps) {
  // `buildWall` est pur et déterministe : le mémoriser sur l'identité de la
  // salle suffit, et évite de reconstruire soixante murs à chaque rendu.
  const walls = useMemo(() => room.walls.map((wall) => buildWall(wall)), [room])

  // Deux matières par salle au plus (spec §9.4) : le béton banché du mur
  // d'enceinte, qui est de la structure et se montre, et le plâtre du thème pour
  // les cloisons. Les cartes sont MUTUALISÉES au niveau du module — vingt salles
  // du même thème partagent les mêmes images décodées et la même texture GPU.
  const matiereTheme = matiereDeMur('inner', room.theme)
  const cartesTheme = useCartes(matiereTheme, repetitionDeMatiere(matiereTheme))
  const cartesBeton = useCartes('beton', REPETITION_BETON)

  /**
   * UN MATÉRIAU PAR MUR, et non plus un par salle.
   *
   * Les flaques de lumière du §9.2 sont peintes à l'aplomb des accrochages : ce
   * sont donc des uniformes par mur, et deux murs de la même salle n'ont pas les
   * mêmes. Ce n'est PAS une régression de budget — il y avait déjà un mesh, donc
   * un draw call, par mur ; seul le nombre d'objets `Material` change. Le nombre
   * de PROGRAMMES, lui, reste à un grâce au `customProgramCacheKey` constant de
   * `createWallMaterial`, ce qui est la seule chose que le §9 compte.
   */
  const materials = useMemo(
    () =>
      room.walls.map((wall) => {
        const material = createWallMaterial({ theme: room.theme, wall, elevation })
        // La palette du thème reste le NIVEAU d'albédo — `appliquerCartes`
        // multiplie, il n'écrase pas. La carte n'apporte que le grain et le
        // relief, ce pour quoi on est venu la chercher.
        const matiere = matiereDeMur(wall.kind, room.theme)
        return appliquerCartes(
          material,
          matiere === 'beton' ? cartesBeton : cartesTheme,
          matiere,
        )
      }),
    [room, elevation, cartesBeton, cartesTheme],
  )

  // Les géométries et matériaux construits à la main ne sont PAS libérés par
  // R3F, qui ne dispose que ce qu'il a lui-même créé en JSX. Sans ceci, changer
  // de musée à chaud fuirait un tampon GPU par mur.
  useEffect(() => {
    return () => {
      for (const wall of walls) wall.geometry.dispose()
      for (const material of materials) material.dispose()
    }
  }, [walls, materials])

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
          material={materials[i]}
          /*
            SEULE L'ENVELOPPE PROJETTE L'OMBRE DU SOLEIL.

            La passe de shadow map était le poste dominant du budget : 82 draw
            calls sur 239, parce que les soixante-huit murs du bâtiment y
            passaient. Or le soleil est la seule source qui projette (§9.2), il
            vient de l'extérieur, et l'enveloppe l'arrête : une cloison
            intérieure ne peut ombrer que ce que le mur de façade a déjà mis
            dans l'ombre. Elle coûtait un draw call par image pour ne rien
            changer à un seul pixel.

            `receiveShadow` reste vrai partout : une cloison, elle, se trouve
            bel et bien dans l'ombre portée par la façade et par les dalles.
          */
          castShadow={room.walls[i].kind === 'outer'}
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
