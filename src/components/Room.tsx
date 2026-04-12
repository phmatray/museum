import { CuboidCollider } from '@react-three/rapier'
import type { RoomConfig } from '../types/museum'
import { Doorway } from './Doorway'

interface RoomProps {
  config: RoomConfig
  onDoorwayEnter: (targetRoomId: string) => void
}

export function Room({ config, onDoorwayEnter }: RoomProps) {
  const { dimensions, position, wallColor, floorColor, ceilingColor, ambientLightIntensity } = config
  const { width, height, depth } = dimensions
  const px = position.x
  const py = position.y
  const pz = position.z
  const wallThickness = 0.2

  return (
    <group position={[px, py, pz]}>
      {/* Ambient light for this room */}
      <pointLight position={[0, height - 0.5, 0]} intensity={ambientLightIntensity} distance={Math.max(width, depth) * 1.5} />

      {/* Floor */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={floorColor} />
      </mesh>

      {/* Ceiling */}
      <mesh position={[0, height, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={ceilingColor} />
      </mesh>

      {/* Back wall (-Z) */}
      <mesh position={[0, height / 2, -depth / 2]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>
      <CuboidCollider position={[0, height / 2, -depth / 2]} args={[width / 2, height / 2, wallThickness / 2]} />

      {/* Front wall (+Z) */}
      <mesh position={[0, height / 2, depth / 2]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>
      <CuboidCollider position={[0, height / 2, depth / 2]} args={[width / 2, height / 2, wallThickness / 2]} />

      {/* Left wall (-X) */}
      <mesh position={[-width / 2, height / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[depth, height]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>
      <CuboidCollider position={[-width / 2, height / 2, 0]} args={[wallThickness / 2, height / 2, depth / 2]} />

      {/* Right wall (+X) */}
      <mesh position={[width / 2, height / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[depth, height]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>
      <CuboidCollider position={[width / 2, height / 2, 0]} args={[wallThickness / 2, height / 2, depth / 2]} />

      {/* Floor collider */}
      <CuboidCollider position={[0, -wallThickness / 2, 0]} args={[width / 2, wallThickness / 2, depth / 2]} />

      {config.doorways.map((doorway) => (
        <Doorway
          key={doorway.id}
          config={doorway}
          roomPosition={position}
          onEnter={onDoorwayEnter}
        />
      ))}
    </group>
  )
}
