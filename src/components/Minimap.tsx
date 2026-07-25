import { useGameStore } from '../stores/gameStore'
import { floorById } from '../io/loadMuseum'
import type { Museum, Rect } from '../domain/types'

interface MinimapProps {
  museum: Museum
  /** Niveau affiché. Le lot 3 le fera suivre le joueur. */
  floorId: string
}

const MAP_SIZE = 150
const PADDING = 10

/**
 * Plan d'un niveau, vu de dessus.
 *
 * Adapté au bâtiment dérivé du lot 2 : l'ancien modèle (`RoomConfig`, une liste
 * plate de salles centrées sur un point) n'existe plus, une salle est désormais
 * un `Rect` en coin-minimal-plus-taille et appartient à un niveau. Le cadrage
 * est celui de l'EMPRISE DU NIVEAU et non de la boîte englobante des salles :
 * sur ce plan en anneau, cadrer sur les salles ferait sauter l'échelle d'un
 * niveau à l'autre selon les côtés occupés, alors que le bâtiment, lui, ne
 * bouge pas.
 */
export function Minimap({ museum, floorId }: MinimapProps) {
  const currentRoomId = useGameStore((s) => s.currentRoomId)
  const floor = floorById(museum, floorId)
  if (!floor) return null

  const { footprint } = floor
  const echelle = (MAP_SIZE - 2 * PADDING) / Math.max(footprint.width, footprint.depth)

  /** Rectangle du monde → rectangle du plan (x monde → x, z monde → y). */
  function projeter(rect: Rect) {
    return {
      x: PADDING + (rect.x - footprint.x) * echelle,
      y: PADDING + (rect.z - footprint.z) * echelle,
      width: rect.width * echelle,
      height: rect.depth * echelle,
    }
  }

  const emprise = projeter(footprint)
  const atrium = projeter(museum.atrium)

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '1rem',
        right: '1rem',
        width: MAP_SIZE,
        height: MAP_SIZE,
        background: 'rgba(0,0,0,0.6)',
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.2)',
        zIndex: 200,
        overflow: 'hidden',
      }}
    >
      <svg width={MAP_SIZE} height={MAP_SIZE} role="img" aria-label={`Plan du niveau ${floor.name}`}>
        {/* La dalle. */}
        <rect {...emprise} fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.25)" />

        {/* La trémie : le vide central, qu'on ne peut pas traverser à pied. */}
        <rect {...atrium} fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.2)" />

        {floor.rooms.map((room) => {
          const r = projeter(room.footprint)
          const courante = room.id === currentRoomId
          return (
            <rect
              key={room.id}
              {...r}
              fill={courante ? 'rgba(74, 144, 217, 0.5)' : 'rgba(255,255,255,0.12)'}
              stroke={courante ? '#4a90d9' : 'rgba(255,255,255,0.3)'}
              strokeWidth={courante ? 2 : 1}
            >
              <title>{room.name}</title>
            </rect>
          )
        })}
      </svg>
    </div>
  )
}
