import * as THREE from 'three'

export interface MovementKeys {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
}

const _direction = new THREE.Vector3()
const _frontVector = new THREE.Vector3()
const _sideVector = new THREE.Vector3()

export function computeMovement(
  keys: MovementKeys,
  camera: THREE.Camera,
  delta: number,
  speed: number
): THREE.Vector3 {
  _frontVector.set(0, 0, (keys.backward ? 1 : 0) - (keys.forward ? 1 : 0))
  _sideVector.set((keys.left ? -1 : 0) + (keys.right ? 1 : 0), 0, 0)

  _direction
    .subVectors(_frontVector, _sideVector.negate())
    .normalize()
    .multiplyScalar(speed * delta)
    .applyEuler(new THREE.Euler(0, camera.rotation.y, 0))

  return _direction.clone()
}
