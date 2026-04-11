import { useRef } from 'react'
import { CuboidCollider } from '@react-three/rapier'
import { DoorwayConfig } from '../types/museum'

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
      {/* Visual doorway frame */}
      <mesh>
        <boxGeometry args={[config.width + 0.4, config.height + 0.2, 0.3]} />
        <meshStandardMaterial color="#4a3728" />
      </mesh>
      {/* Opening (slightly darker) */}
      <mesh position={[0, 0, 0.01]}>
        <planeGeometry args={[config.width, config.height]} />
        <meshStandardMaterial color="#111111" transparent opacity={0.3} />
      </mesh>

      {/* Trigger sensor */}
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
