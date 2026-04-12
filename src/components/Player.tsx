import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useKeyboardControls } from '@react-three/drei'
import {
  CapsuleCollider,
  RigidBody,
  useRapier,
  type RapierRigidBody,
} from '@react-three/rapier'
import { QueryFilterFlags, type KinematicCharacterController } from '@dimforge/rapier3d-compat'
import { computeMovement } from '../hooks/usePlayerMovement'
import { useGameStore } from '../stores/gameStore'

const PLAYER_SPEED = 4 // m/s
const PLAYER_HEIGHT = 1.7
const CAPSULE_RADIUS = 0.3
const CAPSULE_HALF_HEIGHT = 0.5
const GRAVITY = -9.81

export function Player({ spawn = [0, 1, 0] }: { spawn?: [number, number, number] }) {
  const rigidBodyRef = useRef<RapierRigidBody>(null)
  const { camera } = useThree()
  const [, getKeys] = useKeyboardControls()
  const paused = useGameStore((s) => s.paused)
  const tourActive = useGameStore((s) => s.tourActive)
  const { world } = useRapier()
  const characterControllerRef = useRef<KinematicCharacterController | null>(null)
  const verticalVelocity = useRef(0)

  // Create character controller once the physics world is available
  useEffect(() => {
    const cc = world.createCharacterController(0.05)
    cc.setMaxSlopeClimbAngle((45 * Math.PI) / 180)
    cc.setMinSlopeSlideAngle((30 * Math.PI) / 180)
    cc.enableAutostep(0.3, 0.1, true)
    cc.enableSnapToGround(0.3)
    cc.setApplyImpulsesToDynamicBodies(false)
    characterControllerRef.current = cc

    return () => {
      world.removeCharacterController(cc)
      characterControllerRef.current = null
    }
  }, [world])

  useFrame((_, delta) => {
    const rb = rigidBodyRef.current
    const cc = characterControllerRef.current
    if (!rb || !cc) return
    if (paused || tourActive) return

    const collider = rb.collider(0)
    if (!collider) return

    const keys = getKeys() as {
      forward: boolean
      backward: boolean
      left: boolean
      right: boolean
    }
    const horizontal = computeMovement(keys, camera, delta, PLAYER_SPEED)

    // Apply simple gravity for vertical movement
    verticalVelocity.current += GRAVITY * delta
    const desired = {
      x: horizontal.x,
      y: verticalVelocity.current * delta,
      z: horizontal.z,
    }

    // Exclude sensors (like doorway triggers) so they don't block movement.
    cc.computeColliderMovement(collider, desired, QueryFilterFlags.EXCLUDE_SENSORS)
    const corrected = cc.computedMovement()

    const current = rb.translation()
    const next = {
      x: current.x + corrected.x,
      y: current.y + corrected.y,
      z: current.z + corrected.z,
    }
    rb.setNextKinematicTranslation(next)

    // Reset vertical velocity when grounded
    if (cc.computedGrounded()) {
      verticalVelocity.current = 0
    }

    // Sync camera to player position (eye level = top of capsule)
    camera.position.set(next.x, next.y + PLAYER_HEIGHT - CAPSULE_HALF_HEIGHT, next.z)
  })

  return (
    <RigidBody
      ref={rigidBodyRef}
      type="kinematicPosition"
      position={spawn}
      colliders={false}
      enabledRotations={[false, false, false]}
    >
      <CapsuleCollider args={[CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]} />
    </RigidBody>
  )
}
