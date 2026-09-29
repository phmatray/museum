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
import { MAX_NEAR_TEXTURES } from '../io/arrayTexture'

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
 * Les toiles qui méritent leur vignette 1024 × 512 (`media/near/`), sur le
 * niveau où se tient le regard — une toile de l'étage est à moins de dix mètres
 * mais derrière un plancher —, `MAX_NEAR_TEXTURES` au plus. Au-delà, la couche
 * 256 × 128 de l'atlas suffit ; de près, elle rendait le texte illisible.
 *
 * Avec hystérésis, sinon les toiles clignotent : une toile ENTRE sous
 * `ENTREE`, ne SORT qu'au-delà de `SORTIE`, et une toile déjà retenue ne cède sa
 * place, quand les six sont prises, qu'à une toile plus proche qu'elle de
 * `SORTIE - ENTREE`. Sans cela, un pas de part et d'autre des dix mètres, ou
 * deux toiles à égale distance, les faisaient basculer d'un LOD à l'autre à
 * chaque demi-mètre. Rendues triées par identifiant : l'ordre ne change pas
 * quand on bouge, seul l'ensemble compte.
 */
export function posesProches<P extends Pick<Pose, 'id' | 'centre'>>(poses: readonly P[], oeil: THREE.Vector3, avant: readonly P[] = []): P[] {
  const distance = new Map<string, number>()
  for (const p of poses) if (Math.abs(p.centre.y - oeil.y) < MEME_NIVEAU) distance.set(p.id, p.centre.distanceTo(oeil))
  const d = (p: P) => distance.get(p.id) ?? Infinity
  const gardees = avant.filter((p) => d(p) <= SORTIE)
  const candidats = poses
    .filter((p) => d(p) <= ENTREE && !gardees.some((g) => g.id === p.id))
    .sort((a, b) => d(a) - d(b) || (a.id < b.id ? -1 : 1))
  for (const c of candidats) {
    if (gardees.length < MAX_NEAR_TEXTURES) {
      gardees.push(c)
      continue
    }
    const loin = gardees.reduce((a, b) => (d(b) > d(a) ? b : a))
    if (d(loin) - d(c) <= SORTIE - ENTREE) break
    gardees[gardees.indexOf(loin)] = c
  }
  return gardees.sort((a, b) => (a.id < b.id ? -1 : 1))
}

/** Une toile passe à sa vignette sous huit mètres, et la garde jusqu'à onze. */
export const ENTREE = 8
export const SORTIE = 11

/** L'axe des toiles est à 1,55 m, l'œil vers 1,6 m ; un étage plus haut, 4,80 m. */
const MEME_NIVEAU = 2.4
