/**
 * Le navmesh des PNJ, cuit hors du fil principal pendant le chargement : la soupe du plan
 * (le parc recalculé ici, les plantes d'angle selon les thèmes reçus) puis Recast. Rend les
 * octets du navmesh (transférés).
 */
import { MUSEE } from '../plan/musee.ts'
import { entraves, soupeDeNavigation } from '../plan/navigation.ts'
import { parkPlacements } from '../plan/park.ts'
import { propPlacements } from '../plan/props.ts'
import { cuireNavmesh } from './navmesh.ts'

self.onmessage = async (e: MessageEvent<{ id: string; name: string }[]>) => {
  try {
    const parc = parkPlacements(MUSEE)
    const octets = await cuireNavmesh(soupeDeNavigation(MUSEE, entraves(MUSEE, parc, propPlacements(MUSEE, e.data))))
    self.postMessage(octets, { transfer: [octets.buffer] })
  } catch (err) {
    self.postMessage({ erreur: String(err) })
  }
}
