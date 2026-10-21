
/**
 * Le navmesh des PNJ et leur foule, par la navigation officielle de Babylon (« Navigation
 * V2 » : `RecastNavigationJSPluginV2` de `@babylonjs/addons`, sur recast-navigation-js en WASM).
 *
 * Le sol vient du plan (`plan/navigation.ts`), jamais des maillages rendus. Sa cuisson
 * (`navmesh.ts`) se fait dans un worker pendant le chargement ; le greffon relit ses octets
 * (`buildFromNavmeshData`). Recast est injecté (`instance`) plutôt que chargé d'unpkg :
 * la visite marche hors ligne.
 */
import { CreateNavigationPluginAsync } from '@babylonjs/addons/navigation/factory/factory.single-thread'
import type { RecastJSCrowd } from '@babylonjs/addons/navigation/plugin/RecastJSCrowd'
import type { RecastNavigationJSPluginV2 } from '@babylonjs/addons/navigation/plugin/RecastNavigationJSPlugin'
import type { IAgentParametersV2 } from '@babylonjs/addons/navigation/types'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'

import { MUSEE } from '../plan/musee.ts'
import { coteDuSol, entraves, soupeDeNavigation } from '../plan/navigation.ts'
import type { Parc } from '../plan/park.ts'
import { propPlacements } from '../plan/props.ts'
import { VITESSE_PNJ, type Pilote, type Pnj, type Point3 } from '../plan/pnj.ts'
import type { Plan } from '../plan/types.ts'
import { chargerRecast, cuireNavmesh, RAYON_AGENT, TAILLE_AGENT as TAILLE } from './navmesh.ts'

/** Le greffon de navigation de Babylon, sur le navmesh donné (ses octets). */
export async function navmesh(octets: Uint8Array): Promise<RecastNavigationJSPluginV2> {
  const plugin = await CreateNavigationPluginAsync({ instance: await chargerRecast() })
  plugin.buildFromNavmeshData(octets)
  return plugin
}

/** Les octets du navmesh du musée (`salles` : les thèmes de l'accrochage, qui placent les plantes d'angle) : cuits dans un worker, ou ici faute de worker. */
export function cuireEnArrierePlan(parc: Parc, salles: { id: string; name: string }[]): Promise<Uint8Array> {
  if (typeof Worker === 'undefined') return cuireNavmesh(soupeDeNavigation(MUSEE, entraves(MUSEE, parc, propPlacements(MUSEE, salles))))
  return new Promise((ok, ko) => {
    const w = new Worker(new URL('./navmesh.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<Uint8Array | { erreur: string }>) => {
      w.terminate()
      if (e.data instanceof Uint8Array) ok(e.data)
      else ko(new Error(e.data.erreur))
    }
    w.onerror = (e) => {
      w.terminate()
      ko(new Error(e.message))
    }
    w.postMessage(salles)
  })
}

/** Ce que la foule rend : le pilote des PNJ, et de quoi suivre le visiteur. */
export interface Foule {
  pilote: Pilote
  crowd: RecastJSCrowd
  /** Recopie dans chaque PNJ la position de son agent (et son cap, s'il marche) ; place l'agent du visiteur. */  relever(visiteur: { x: number; y: number; z: number } | null): void
}

/** Jusqu'où chercher le sol autour d'un point visé (m) : une place devant une toile tombe parfois sur un banc. */
const PORTEE = { x: 1.5, y: 1, z: 1.5 }
/** Au-dessous de cette vitesse (m/s), un PNJ garde son cap. */
const IMMOBILE = 0.15
/** Anticipe les virages, évite les autres, s'en écarte, raccourcit à vue et par la topologie (`DT_CROWD_*`). */
const PILOTAGE = 1 | 2 | 4 | 8 | 16

/**
 * La foule des PNJ sur le navmesh de `plugin`, un agent par PNJ, plus un pour le visiteur :
 * immobile et sans pilotage, téléporté à chaque image sous ses pieds, les PNJ l'évitent
 * comme un des leurs. Recast fait avancer la foule avant les animations de chaque image
 * (`RecastJSCrowd`) ; `relever` en lit le résultat.
 */
export function fouleDesPnj(scene: Scene, plugin: RecastNavigationJSPluginV2, plan: Plan, pnj: readonly Pnj[]): Foule {
  const crowd = plugin.createCrowd(pnj.length + 1, RAYON_AGENT, scene) as RecastJSCrowd
  const query = plugin.navMeshQuery
  const surLeSol = (x: number, y: number, z: number): Point3 | null => {
    const r = query.findClosestPoint({ x, y, z }, { halfExtents: PORTEE })
    return r.success && r.polyRef ? [r.point.x, r.point.y, r.point.z] : null
  }
  const parametres = (vitesse: number, pilotage: number): IAgentParametersV2 => ({
    radius: RAYON_AGENT, height: TAILLE, maxAcceleration: 4, maxSpeed: vitesse, collisionQueryRange: RAYON_AGENT * 8,
    pathOptimizationRange: RAYON_AGENT * 30, separationWeight: 1, reachRadius: RAYON_AGENT,
    updateFlags: pilotage, obstacleAvoidanceType: 3, queryFilterType: 0, userData: 0,
  })
  const agents = new Map<Pnj, number>()
  for (const p of pnj) {
    const [x, y, z] = surLeSol(p.w.x, p.w.y, p.w.z) ?? [p.w.x, p.w.y, p.w.z]
    agents.set(p, crowd.addAgent({ x, y, z }, parametres(VITESSE_PNJ, PILOTAGE), new TransformNode(`pnj:agent:${p.n}`, scene)))
  }
  const lui = crowd.addAgent({ x: 0, y: 0, z: 0 }, parametres(0, 0), new TransformNode('pnj:agent:visiteur', scene))
  const pos = new Vector3()
  const vit = new Vector3()

  return {
    crowd,
    pilote: {
      aller(p, x, y, z) {
        const but = surLeSol(x, y, z)
        if (but) crowd.agentGoto(agents.get(p)!, { x: but[0], y: but[1], z: but[2] })
        return but
      },
      arreter(p) {
        crowd.recastCrowd.getAgent(agents.get(p)!)?.resetMoveTarget()
      },
    },
    relever(visiteur) {
      for (const [p, i] of agents) {
        crowd.getAgentPositionToRef(i, pos)
        crowd.getAgentVelocityToRef(i, vit)
        p.w.x = pos.x
        p.w.z = pos.z
        p.w.y = coteDuSol(plan, pos.x, pos.z, pos.y)
        // Le cap 0 regarde −z : avancer, c'est (−sin, −cos).
        if (p.activite === 'marche' && Math.hypot(vit.x, vit.z) > IMMOBILE) p.w.yaw = Math.atan2(-vit.x, -vit.z)
      }
      if (visiteur) crowd.agentTeleport(lui, visiteur)
    },
  }
}
