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

import { buildRamp } from '../builders/ramp'
import type { Ramp } from '../domain/types'
import { REGLAGE_MATIERE, repetitionMetrique, useMatiere } from './materials'

export interface RampMeshProps {
  ramp: Ramp
}

export function RampMesh({ ramp }: RampMeshProps) {
  const build = useMemo(() => buildRamp(ramp), [ramp])

  // ── Matières (§9.4) ────────────────────────────────────────────────────
  //
  // Ce composant fabriquait ses deux `MeshStandardMaterial` en dur — un béton
  // « #a49c8e » et un métal « #6d7176 » à `metalness` 0,6 — et n'était branché
  // sur rien. Le lot des matières a corrigé le métal du bâtiment dans
  // `REGLAGE_MATIERE`, sans effet ici : personne ne possédait ce fichier.
  //
  // La conséquence se mesurait : la face interne du garde-corps de la rampe
  // sortait à une luminance de 10 sur 255 et occupait un tiers de la vue
  // plongeante depuis l'atrium. C'était la dernière masse noire du musée, et sa
  // cause n'était pas l'éclairage. Un métal à `metalness` 0,6 n'a presque pas de
  // diffus par définition ; son spéculaire ne réfléchit que `scene.environment`,
  // volontairement discret (intensité 0,45). Sur une face VERTICALE tournée vers
  // le vide de l'hélice, cela ne laisse rien.
  //
  // Le `rebond` ne pouvait pas la sauver : il ne peint que les faces tournées
  // vers le BAS. Il reste utile sous le tablier, qui est exactement ce qu'on
  // regarde depuis le niveau de la réserve.
  const repetition = useMemo(
    () => repetitionMetrique(REGLAGE_MATIERE.beton.motif),
    [],
  )
  const repetitionMetal = useMemo(
    () => repetitionMetrique(REGLAGE_MATIERE.metal.motif),
    [],
  )
  const deckMaterial = useMatiere('beton', repetition, { rebond: 0.34 })
  const railingMaterial = useMatiere('metal', repetitionMetal)

  // `buildRamp` ne lève jamais : une rampe aberrante sort avec une géométrie
  // vide et un message. Sans cette remontée, l'anomalie n'existerait nulle part
  // — le bâtiment se contenterait de perdre un escalier en silence.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    for (const warning of build.warnings) console.warn(`[museum] ${warning}`)
  }, [build])

  // Les matériaux ne sont plus libérés ici : `useMatiere` les possède et les
  // dispose au démontage. Les géométries, elles, sont créées à la main.
  useEffect(() => {
    return () => {
      build.geometry.dispose()
      build.railingGeometry.dispose()
    }
  }, [build])

  return (
    <RigidBody type="fixed" colliders={false} name={`ramp:${ramp.id}`}>
      <mesh geometry={build.geometry} material={deckMaterial} castShadow receiveShadow />
      <mesh geometry={build.railingGeometry} material={railingMaterial} castShadow receiveShadow />

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
