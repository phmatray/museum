import { useRef } from 'react'
import { CuboidCollider } from '@react-three/rapier'
import type { DoorwayConfig } from '../types/museum'

interface DoorwayProps {
  config: DoorwayConfig
  roomPosition: { x: number; y: number; z: number }
  onEnter: (targetRoomId: string) => void
}

export function Doorway({ config, roomPosition, onEnter }: DoorwayProps) {
  const hasTriggered = useRef(false)

  const worldX = roomPosition.x + config.position.x
  const worldY = roomPosition.y + config.position.y + config.height / 2
  const worldZ = roomPosition.z + config.position.z

  return (
    <group position={[worldX, worldY, worldZ]}>
      {/* Trigger sensor — detects when the player walks through the doorway */}
      <CuboidCollider
        sensor
        position={[0, 0, 0]}
        args={[config.width / 2, config.height / 2, 0.5]}
        onIntersectionEnter={() => {
          if (!hasTriggered.current) {
            hasTriggered.current = true
            onEnter(config.connectsTo)
            setTimeout(() => {
              hasTriggered.current = false
            }, 2000)
          }
        }}
      />
    </group>
  )
}
