/**
 * La cuisson du navmesh des PNJ : la soupe de triangles du plan (`plan/navigation.ts`)
 * voxelisée par Recast (recast-navigation-js, le générateur qu'appelle le greffon de
 * navigation de Babylon), rendue en octets que `RecastNavigationJSPluginV2.buildFromNavmeshData`
 * relit. Sans Babylon : ce module tourne aussi dans le worker (`navmesh.worker.ts`), qui
 * cuit pendant le chargement sans bloquer le fil principal.
 */
import type { Soupe } from '../plan/navigation.ts'
import { CELLULE } from '../plan/navigation.ts'

/** Le rayon d'un PNJ (m), sa taille, la marche qu'il franchit. */
export const RAYON_AGENT = 0.3
export const TAILLE_AGENT = 1.7
const MARCHE = 0.3
/** Les voxels : `CELLULE` au sol (le rayon en fait deux), 5 cm en hauteur (une contremarche de 16 cm en fait trois). */
const CH = 0.05

/** Le réglage de Recast, en voxels. */
export const REGLAGE = {
  cs: CELLULE,
  ch: CH,
  walkableSlopeAngle: 45,
  walkableHeight: Math.ceil(TAILLE_AGENT / CH),
  walkableClimb: Math.floor(MARCHE / CH),
  walkableRadius: Math.ceil(RAYON_AGENT / CELLULE),
  maxEdgeLen: 12 / CELLULE,
  // Un bord simplifié s'écarte d'au plus 0,9 voxel du contour érodé : il ne mange pas le rayon.
  maxSimplificationError: 0.9,
  minRegionArea: 8,
  mergeRegionArea: 20,
  maxVertsPerPoly: 6,
  detailSampleDist: 6,
  detailSampleMaxError: 0.1,
}

/** Recast, chargé et initialisé une fois (son WASM est embarqué en base64 : rien à servir). */
let recast: Promise<typeof import('@recast-navigation/core') & typeof import('@recast-navigation/generators')> | null = null
export function chargerRecast() {
  recast ??= (async () => {
    const [core, generators] = await Promise.all([import('@recast-navigation/core'), import('@recast-navigation/generators')])
    await core.init()
    return { ...core, ...generators }
  })()
  return recast
}

/** Cuit le navmesh (un seul tenant, sans tuiles : le musée et son parc tiennent en un) ; rend ses octets. */
export async function cuireNavmesh(soupe: Soupe): Promise<Uint8Array> {
  const r = await chargerRecast()
  // Nos triangles regardent déjà +y dans le repère main droite de Recast : pas d'inversion.
  const res = r.generateSoloNavMesh(soupe.positions, soupe.indices, REGLAGE)
  if (!res.success) throw new Error(`navmesh : ${res.error}`)
  const octets = r.exportNavMesh(res.navMesh)
  res.navMesh.destroy()
  return octets
}
