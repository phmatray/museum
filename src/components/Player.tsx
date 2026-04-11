import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useKeyboardControls } from '@react-three/drei'
import { CapsuleCollider, RigidBody, RapierRigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { computeMovement } from '../hooks/usePlayerMovement'
import { useGameStore } from '../stores/gameStore'

const PLAYER_SPEED = 4 // m/s
const PLAYER_HEIGHT = 1.7
const CAPSULE_RADIUS = 0.3
const CAPSULE_HALF_HEIGHT = 0.5

export function Player({ spawn = [0, 1, 0] }: { spawn?: [number, number, number] }) {
  const rigidBodyRef = useRef<RapierRigidBody>(null)
  const { camera } = useThree()
  const [, getKeys] = useKeyboardControls()
  const paused = useGameStore((s) => s.paused)
  const tourActive = useGameStore((s) => s.tourActive)

  useFrame((_, delta) => {
    if (paused || tourActive || !rigidBodyRef.current) return

    const keys = getKeys() as { forward: boolean; backward: boolean; left: boolean; right: boolean }
    const movement = computeMovement(keys, camera, delta, PLAYER_SPEED)

    const currentPos = rigidBodyRef.current.translation()
    rigidBodyRef.current.setNextKinematicTranslation({
      x: currentPos.x + movement.x,
      y: currentPos.y,
      z: currentPos.z + movement.z,
    })

    // Sync camera to player position
    camera.position.set(
      currentPos.x + movement.x,
      currentPos.y + PLAYER_HEIGHT - CAPSULE_HALF_HEIGHT,
      currentPos.z + movement.z
    )
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
