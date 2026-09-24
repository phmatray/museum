/**
 * Tests du calcul de pose des toiles du plan (matrices canvas/cadre, orientation
 * selon la normale du mur). Seam pur — `computePoses` ne lit que `salles` — donc
 * testé directement, sans montage React ni contexte WebGL, au même niveau que
 * lighting.test.ts / materials.test.ts pour src/scene/.
 *
 * Une régression dans cette math (argument de `crossVectors` inversé, mauvais
 * décalage `FRAME_DEPTH`) ferait pivoter ou décaler silencieusement toutes les
 * toiles du plan — c'est le trou que #16 avait laissé (« vérifié à l'œil »).
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { FRAME_BORDER, FRAME_DEPTH } from '../../builders/artwork'
import { DEFAULT_ASPECT } from '../../domain/hanging'
import type { Accrochage } from '../../plan/hang'
import { computePoses } from '../planToilesGeometry'

type Room = Accrochage['rooms'][number]
type Placement = Room['placements'][number]

function room(placements: Placement[]): Room {
  return { id: 'r-o1', level: 0, name: 'Salle test', placements }
}

function placement(over: Partial<Placement> = {}): Placement {
  return { key: 'owner/name', x: 2, y: 1.2, z: 3, normal: [1, 0], width: 1.6, ...over }
}

describe('computePoses', () => {
  it('returns [] when no room has placements', () => {
    expect(computePoses([])).toEqual([])
    expect(computePoses([room([])])).toEqual([])
  })

  it('offsets the canvas along the wall normal, past the frame depth', () => {
    const p = placement()
    const [pose] = computePoses([room([p])])

    const position = new THREE.Vector3()
    pose.canvas.decompose(position, new THREE.Quaternion(), new THREE.Vector3())

    const offset = FRAME_DEPTH + 0.004
    expect(position.x).toBeCloseTo(p.x + p.normal[0] * offset)
    expect(position.y).toBeCloseTo(p.y)
    expect(position.z).toBeCloseTo(p.z + p.normal[1] * offset)
  })

  it('scales the canvas from the placement width and DEFAULT_ASPECT', () => {
    const p = placement({ width: 2 })
    const [pose] = computePoses([room([p])])

    const scale = new THREE.Vector3()
    pose.canvas.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale)

    expect(scale.x).toBeCloseTo(p.width)
    expect(scale.y).toBeCloseTo(p.width / DEFAULT_ASPECT)
  })

  it('rotates a wall facing [0, 1] differently from one facing [1, 0]', () => {
    const [poseX] = computePoses([room([placement({ normal: [1, 0] })])])
    const [poseZ] = computePoses([room([placement({ normal: [0, 1] })])])

    const quatX = new THREE.Quaternion()
    const quatZ = new THREE.Quaternion()
    poseX.canvas.decompose(new THREE.Vector3(), quatX, new THREE.Vector3())
    poseZ.canvas.decompose(new THREE.Vector3(), quatZ, new THREE.Vector3())

    expect(quatX.equals(quatZ)).toBe(false)
  })

  it('offsets the frame by half the frame depth, widened by FRAME_BORDER', () => {
    const p = placement()
    const [pose] = computePoses([room([p])])

    const position = new THREE.Vector3()
    const scale = new THREE.Vector3()
    pose.frame.decompose(position, new THREE.Quaternion(), scale)

    expect(position.x).toBeCloseTo(p.x + p.normal[0] * (FRAME_DEPTH / 2))
    expect(scale.x).toBeCloseTo(p.width + 2 * FRAME_BORDER)
    expect(scale.z).toBeCloseTo(FRAME_DEPTH)
  })
})
