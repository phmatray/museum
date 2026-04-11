import { describe, it, expect } from 'vitest'
import { computeMovement } from '../usePlayerMovement'
import * as THREE from 'three'

describe('computeMovement', () => {
  it('returns zero vector when no keys pressed', () => {
    const keys = { forward: false, backward: false, left: false, right: false }
    const camera = new THREE.PerspectiveCamera()
    camera.rotation.set(0, 0, 0)

    const result = computeMovement(keys, camera, 1 / 60, 4)
    expect(result.x).toBeCloseTo(0)
    expect(result.z).toBeCloseTo(0)
  })

  it('moves forward along negative Z in camera space', () => {
    const keys = { forward: true, backward: false, left: false, right: false }
    const camera = new THREE.PerspectiveCamera()
    camera.rotation.set(0, 0, 0) // looking down -Z

    const result = computeMovement(keys, camera, 1 / 60, 4)
    expect(result.z).toBeLessThan(0)
    expect(result.x).toBeCloseTo(0)
  })

  it('moves left along negative X in camera space', () => {
    const keys = { forward: false, backward: false, left: true, right: false }
    const camera = new THREE.PerspectiveCamera()
    camera.rotation.set(0, 0, 0)

    const result = computeMovement(keys, camera, 1 / 60, 4)
    expect(result.x).toBeLessThan(0)
    expect(result.z).toBeCloseTo(0)
  })

  it('respects speed parameter', () => {
    const keys = { forward: true, backward: false, left: false, right: false }
    const camera = new THREE.PerspectiveCamera()
    camera.rotation.set(0, 0, 0)

    const slow = computeMovement(keys, camera, 1 / 60, 2)
    const fast = computeMovement(keys, camera, 1 / 60, 8)
    expect(Math.abs(fast.z)).toBeGreaterThan(Math.abs(slow.z))
  })

  it('normalizes diagonal movement', () => {
    const keys = { forward: true, backward: false, left: true, right: false }
    const camera = new THREE.PerspectiveCamera()
    camera.rotation.set(0, 0, 0)

    const result = computeMovement(keys, camera, 1 / 60, 4)
    const length = Math.sqrt(result.x ** 2 + result.z ** 2)
    const expectedMax = 4 * (1 / 60)
    expect(length).toBeLessThanOrEqual(expectedMax + 0.001)
  })
})
