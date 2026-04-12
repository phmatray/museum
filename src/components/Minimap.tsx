import { useGameStore } from '../stores/gameStore'
import type { MuseumConfig } from '../types/museum'

interface MinimapProps {
  config: MuseumConfig
}

export function Minimap({ config }: MinimapProps) {
  const currentRoomId = useGameStore((s) => s.currentRoomId)

  const allX = config.rooms.flatMap((r) => [r.position.x - r.dimensions.width / 2, r.position.x + r.dimensions.width / 2])
  const allZ = config.rooms.flatMap((r) => [r.position.z - r.dimensions.depth / 2, r.position.z + r.dimensions.depth / 2])
  const minX = Math.min(...allX)
  const maxX = Math.max(...allX)
  const minZ = Math.min(...allZ)
  const maxZ = Math.max(...allZ)
  const rangeX = maxX - minX || 1
  const rangeZ = maxZ - minZ || 1
  const mapSize = 150
  const padding = 10

  function toMapCoords(x: number, z: number) {
    return {
      x: padding + ((x - minX) / rangeX) * (mapSize - 2 * padding),
      y: padding + ((z - minZ) / rangeZ) * (mapSize - 2 * padding),
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '1rem',
        right: '1rem',
        width: mapSize,
        height: mapSize,
        background: 'rgba(0,0,0,0.6)',
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.2)',
        zIndex: 200,
        overflow: 'hidden',
      }}
    >
      <svg width={mapSize} height={mapSize}>
        {config.rooms.map((room) => {
          const center = toMapCoords(room.position.x, room.position.z)
          const w = (room.dimensions.width / rangeX) * (mapSize - 2 * padding)
          const h = (room.dimensions.depth / rangeZ) * (mapSize - 2 * padding)
          const isCurrent = room.id === currentRoomId

          return (
            <rect
              key={room.id}
              x={center.x - w / 2}
              y={center.y - h / 2}
              width={w}
              height={h}
              fill={isCurrent ? 'rgba(74, 144, 217, 0.5)' : 'rgba(255,255,255,0.1)'}
              stroke={isCurrent ? '#4a90d9' : 'rgba(255,255,255,0.3)'}
              strokeWidth={isCurrent ? 2 : 1}
            />
          )
        })}
      </svg>
    </div>
  )
}
