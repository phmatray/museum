/**
 * Le calcul de pose des toiles du plan (matrices canvas/cadre), extrait de
 * `PlanToiles` : `react-refresh/only-export-components` interdit d'exporter
 * autre chose qu'un composant depuis un `.tsx`, et cette math est pure —
 * testée directement dans `__tests__/PlanToiles.test.ts`, sans montage React.
 */
import * as THREE from 'three'

import type { Hanging } from '../builders/artwork'
import { FRAME_BORDER, FRAME_DEPTH } from '../builders/artwork'
import { DEFAULT_ASPECT } from '../domain/hanging'
import type { Accrochage } from '../plan/hang'
import { MAX_NEAR_TEXTURES, NEAR_LOD_DISTANCE } from '../io/arrayTexture'

/** Toutes les toiles, avant de savoir dans quelle couche d'atlas elles vivent. */
export type Pose = Omit<Hanging, 'atlas' | 'layer'>

/** Convertit les placements d'un accrochage (positions monde, normale de mur) en matrices. */
export function computePoses(salles: Accrochage['rooms']): Pose[] {
  const up = new THREE.Vector3(0, 1, 0)
  return salles.flatMap((salle) =>
    salle.placements.map((p): Pose => {
      const n = new THREE.Vector3(p.normal[0], 0, p.normal[1])
      const base = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(up, n), up, n)
      const face = new THREE.Vector3(p.x, p.y, p.z)
      const height = p.width / DEFAULT_ASPECT
      const at = (offset: number) => face.clone().addScaledVector(n, offset)
      const canvas = base.clone().setPosition(at(FRAME_DEPTH + 0.004)).scale(new THREE.Vector3(p.width, height, 1))
      const frame = base.clone().setPosition(at(FRAME_DEPTH / 2))
        .scale(new THREE.Vector3(p.width + 2 * FRAME_BORDER, height + 2 * FRAME_BORDER, FRAME_DEPTH))
      return { id: `${salle.id}#${p.key}`, key: p.key, canvas, frame, centre: at(0) }
    }))
}

/**
 * Les toiles qui méritent leur vignette 1024 × 512 (`media/near/`) : à moins de
 * `NEAR_LOD_DISTANCE` du regard, sur le niveau où il se tient — une toile de
 * l'étage est à moins de dix mètres mais derrière un plancher —, les plus
 * proches d'abord, `MAX_NEAR_TEXTURES` au plus. Au-delà, la couche 256 × 128 de
 * l'atlas suffit ; de près, elle rendait le texte des toiles illisible.
 */
export function posesProches<P extends Pick<Pose, 'id' | 'centre'>>(poses: readonly P[], oeil: THREE.Vector3): P[] {
  const rayon = NEAR_LOD_DISTANCE * NEAR_LOD_DISTANCE
  return poses
    .filter((p) => Math.abs(p.centre.y - oeil.y) < MEME_NIVEAU)
    .map((p) => ({ p, d2: p.centre.distanceToSquared(oeil) }))
    .filter(({ d2 }) => d2 <= rayon)
    .sort((a, b) => a.d2 - b.d2 || (a.p.id < b.p.id ? -1 : 1))
    .slice(0, MAX_NEAR_TEXTURES)
    .map(({ p }) => p)
}

/** L'axe des toiles est à 1,55 m, l'œil vers 1,6 m ; un étage plus haut, 4,80 m. */
const MEME_NIVEAU = 2.4
