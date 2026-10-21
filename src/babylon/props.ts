/**
 * Les plantes (PropsLayer + les Kentia et Lyrata de MobilierLayer) : un lyrata
 * ou un olivier dans chaque angle des salles exposées (`plan/props.ts`), plus
 * les deux kentias du hall et les deux lyratas de la salle d'honneur.
 *
 * Seul propriétaire de `plantes.glb` (`instancier` ne pose un conteneur qu'une
 * fois). La cuve est partagée par le lyrata et l'olivier (même mesh glTF) :
 * Babylon fait de `Olivier-cuve` une instance de `Lyrata-cuve`, qu'`instancier`
 * jette ; toutes les cuves vont donc sur `Lyrata-cuve`, par son nom exact.
 * Pas de lumière cuite : l'ambiant reste l'hémisphérique pleine, comme three.
 */
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'

import type { Accrochage } from '../plan/hang.ts'
import { MUSEE } from '../plan/musee.ts'
import { propPlacements } from '../plan/props.ts'
import { glbOuRien } from './glb.ts'
import { instancier, matrices, posesDuMobilier, type Pose } from './lots.ts'

/** Les poses de toutes les plantes, cuves comprises (sous `Lyrata-cuve`). */
export function posesDesProps(accrochage: Accrochage | null): Pose[] {
  const plantes: Pose[] = [
    ...propPlacements(MUSEE, accrochage?.rooms ?? []).map((p) => ({
      piece: p.id === 'lyrata' ? 'Lyrata' : 'Olivier', x: p.x, y: p.y, z: p.z, lacet: p.rotation, echelle: p.scale,
    })),
    ...posesDuMobilier().filter((p) => p.piece === 'Kentia' || p.piece === 'Lyrata'),
  ]
  // La kentia a sa propre vasque (Kentia-vasque, sous sa pièce).
  return [...plantes, ...plantes.filter((p) => p.piece !== 'Kentia').map((p) => ({ ...p, piece: 'Lyrata-cuve' }))]
}

// ponytail : pas de culling par salle (une boîte englobante pour les deux niveaux) ; scinder par niveau si le budget serre.
export async function monterProps(scene: Scene, accrochage: Accrochage | null): Promise<Mesh[]> {
  const c = await glbOuRien(scene, 'assets/architecture/plantes.glb')
  if (!c) return []
  if (!c.meshes.some((m) => m.name === 'Lyrata-cuve' && m.getClassName() === 'Mesh')) console.warn('plantes.glb : « Lyrata-cuve » n’est pas le maillage source de la cuve')
  return instancier(c, matrices(posesDesProps(accrochage)))
}
