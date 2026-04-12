import { useRef } from 'react'
import { CuboidCollider } from '@react-three/rapier'
import type { DoorwayConfig } from '../types/museum'

interface DoorwayProps {
  config: DoorwayConfig
  /**
   * Axis the parent wall runs along.
   * - 'x': north/south wall — door width extends along X, player crosses in Z
   * - 'z': east/west wall — door width extends along Z, player crosses in X
   */
  wallAxis: 'x' | 'z'
  onEnter: (targetRoomId: string) => void
}

const SENSOR_THICKNESS = 0.6

export function Doorway({ config, wallAxis, onEnter }: DoorwayProps) {
  const hasTriggered = useRef(false)

  // Doorway is rendered inside the Room's group, so its position is local to
  // the room (config.position is already in room-local coordinates). Y is
  // raised by half the door height so the sensor center is at the middle of
  // the opening.
  const x = config.position.x
  const y = config.position.y + config.height / 2
  const z = config.position.z

  // Orient the sensor to span the wall opening.
  // - wallAxis 'x': wall runs along X, door width is along X, sensor is thin in Z
  // - wallAxis 'z': wall runs along Z, door width is along Z, sensor is thin in X
  const sensorArgs: [number, number, number] =
    wallAxis === 'x'
      ? [config.width / 2, config.height / 2, SENSOR_THICKNESS / 2]
      : [SENSOR_THICKNESS / 2, config.height / 2, config.width / 2]

  return (
    <group position={[x, y, z]}>
      <CuboidCollider
        sensor
        position={[0, 0, 0]}
        args={sensorArgs}
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
