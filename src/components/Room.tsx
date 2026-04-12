import { CuboidCollider } from '@react-three/rapier'
import type { RoomConfig, DoorwayConfig } from '../types/museum'
import { Doorway } from './Doorway'

interface RoomProps {
  config: RoomConfig
  onDoorwayEnter: (targetRoomId: string) => void
}

const WALL_THICKNESS = 0.2
const EPS = 0.01

type WallSide = 'north' | 'south' | 'east' | 'west'

function getDoorwayWall(d: DoorwayConfig, width: number, depth: number): WallSide | null {
  if (Math.abs(d.position.x - width / 2) < EPS) return 'east'
  if (Math.abs(d.position.x + width / 2) < EPS) return 'west'
  if (Math.abs(d.position.z - depth / 2) < EPS) return 'south'
  if (Math.abs(d.position.z + depth / 2) < EPS) return 'north'
  return null
}

interface WallSegmentProps {
  center: [number, number, number]
  size: [number, number, number]
  color: string
}

function WallSegment({ center, size, color }: WallSegmentProps) {
  return (
    <>
      <mesh position={center}>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} />
      </mesh>
      <CuboidCollider position={center} args={[size[0] / 2, size[1] / 2, size[2] / 2]} />
    </>
  )
}

/**
 * Build segments for a wall. For walls with doorways, creates left/right/lintel
 * segments that leave an opening at the doorway.
 *
 * @param axis 'x' = wall runs along X (north/south walls), 'z' = runs along Z (east/west)
 * @param wallCoord the constant coordinate of the wall (e.g. z = -depth/2 for north)
 * @param wallLength total length of the wall along its axis
 * @param height room height
 * @param doorways doorways on this wall (in local room coordinates)
 */
function buildWallSegments(
  axis: 'x' | 'z',
  wallCoord: number,
  wallLength: number,
  height: number,
  doorways: DoorwayConfig[]
): WallSegmentProps[] {
  const color = '' // filled in by caller
  void color

  const halfL = wallLength / 2
  // Sort doorways by position along the wall axis
  const openings = doorways
    .map((d) => ({
      center: axis === 'x' ? d.position.x : d.position.z,
      width: d.width,
      height: d.height,
    }))
    .sort((a, b) => a.center - b.center)

  const segments: Array<{
    center: [number, number, number]
    size: [number, number, number]
  }> = []

  // Helper to create a segment that spans axis from `from` to `to`, full height
  const pushFullHeight = (from: number, to: number) => {
    if (to - from <= EPS) return
    const segCenter = (from + to) / 2
    const segLen = to - from
    const pos: [number, number, number] =
      axis === 'x'
        ? [segCenter, height / 2, wallCoord]
        : [wallCoord, height / 2, segCenter]
    const size: [number, number, number] =
      axis === 'x'
        ? [segLen, height, WALL_THICKNESS]
        : [WALL_THICKNESS, height, segLen]
    segments.push({ center: pos, size })
  }

  // Helper to create a lintel above a doorway
  const pushLintel = (from: number, to: number, doorHeight: number) => {
    if (to - from <= EPS) return
    if (height - doorHeight <= EPS) return
    const segCenter = (from + to) / 2
    const segLen = to - from
    const lintelHeight = height - doorHeight
    const pos: [number, number, number] =
      axis === 'x'
        ? [segCenter, doorHeight + lintelHeight / 2, wallCoord]
        : [wallCoord, doorHeight + lintelHeight / 2, segCenter]
    const size: [number, number, number] =
      axis === 'x'
        ? [segLen, lintelHeight, WALL_THICKNESS]
        : [WALL_THICKNESS, lintelHeight, segLen]
    segments.push({ center: pos, size })
  }

  if (openings.length === 0) {
    pushFullHeight(-halfL, halfL)
  } else {
    let cursor = -halfL
    for (const op of openings) {
      const openStart = op.center - op.width / 2
      const openEnd = op.center + op.width / 2
      pushFullHeight(cursor, openStart)
      pushLintel(openStart, openEnd, op.height)
      cursor = openEnd
    }
    pushFullHeight(cursor, halfL)
  }

  return segments.map((s) => ({ ...s, color: '' }))
}

export function Room({ config, onDoorwayEnter }: RoomProps) {
  const { dimensions, position, wallColor, floorColor, ceilingColor, ambientLightIntensity } = config
  const { width, height, depth } = dimensions

  // Group doorways by which wall they belong to
  const doorwaysByWall: Record<WallSide, DoorwayConfig[]> = {
    north: [],
    south: [],
    east: [],
    west: [],
  }
  for (const d of config.doorways) {
    const side = getDoorwayWall(d, width, depth)
    if (side) doorwaysByWall[side].push(d)
  }

  // Inset walls slightly toward the room center so adjacent rooms' walls don't
  // overlap and z-fight at the shared boundary.
  const inset = WALL_THICKNESS / 2
  // North (-Z) and South (+Z) walls run along X, length = width
  const northSegments = buildWallSegments('x', -depth / 2 + inset, width, height, doorwaysByWall.north)
  const southSegments = buildWallSegments('x', depth / 2 - inset, width, height, doorwaysByWall.south)
  // West (-X) and East (+X) walls run along Z, length = depth
  const westSegments = buildWallSegments('z', -width / 2 + inset, depth, height, doorwaysByWall.west)
  const eastSegments = buildWallSegments('z', width / 2 - inset, depth, height, doorwaysByWall.east)

  const allSegments = [...northSegments, ...southSegments, ...westSegments, ...eastSegments]

  return (
    <group position={[position.x, position.y, position.z]}>
      <pointLight
        position={[0, height - 0.5, 0]}
        intensity={ambientLightIntensity * 10}
        distance={Math.max(width, depth) * 2}
        decay={1}
      />

      {/* Floor */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={floorColor} />
      </mesh>
      <CuboidCollider position={[0, -WALL_THICKNESS / 2, 0]} args={[width / 2, WALL_THICKNESS / 2, depth / 2]} />

      {/* Ceiling */}
      <mesh position={[0, height, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={ceilingColor} />
      </mesh>

      {/* Walls with doorway gaps */}
      {allSegments.map((seg, i) => (
        <WallSegment key={i} center={seg.center} size={seg.size} color={wallColor} />
      ))}

      {/* Doorway triggers — wallAxis tells the sensor how to orient. */}
      {config.doorways.map((doorway) => {
        const side = getDoorwayWall(doorway, width, depth)
        // north/south walls run along X; east/west walls run along Z
        const wallAxis: 'x' | 'z' = side === 'north' || side === 'south' ? 'x' : 'z'
        return (
          <Doorway
            key={doorway.id}
            config={doorway}
            wallAxis={wallAxis}
            onEnter={onDoorwayEnter}
          />
        )
      })}
    </group>
  )
}
