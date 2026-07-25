import { useGameStore } from '../stores/gameStore'
import { useVisitorStore } from '../hooks/useRoomTransition'
import { floorById } from '../io/loadMuseum'
import type { Museum, Rect } from '../domain/types'

interface MinimapProps {
  museum: Museum
  /**
   * Niveau de repli, affiché tant que le visiteur n'est nulle part — avant la
   * première image, ou hors du bâtiment. Le niveau AFFICHÉ, lui, est celui du
   * visiteur : il suit l'étage, y compris pendant une visite guidée.
   */
  floorId?: string
}

const MAP_SIZE = 150
const PADDING = 10

/** Rayon du point du visiteur, en pixels du plan. */
const MARKER_RADIUS = 3.5

/** Longueur du cône de visée, en pixels du plan. */
const MARKER_REACH = 11

/** Demi-ouverture du cône de visée, en radians. ~28°, soit un champ lisible. */
const MARKER_SPREAD = 0.5

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
 *
 * ── Le niveau affiché suit le visiteur ──
 *
 * Un plan figé sur le niveau de départ est pire qu'un plan absent : il montre
 * un étage juste, mais pas le sien, et rien ne le signale. `useVisitorStore` dit
 * où il est ; on retombe sur le niveau de repli seulement quand il n'est nulle
 * part (au-dessus de la toiture, ou avant la première image).
 *
 * ── Le repère du plan ──
 *
 * x monde → x du plan, z monde → y du plan. C'est une vue de DESSUS, pas une
 * projection de caméra : le Nord du bâtiment (z minimal) est donc en haut, ce
 * qui est la convention d'un plan de musée. Le cap du visiteur suit la même
 * règle : un regard vers −Z pointe vers le haut du plan.
 */
export function Minimap({ museum, floorId }: MinimapProps) {
  const currentRoomId = useGameStore((s) => s.currentRoomId)
  const position = useVisitorStore((s) => s.position)
  const yaw = useVisitorStore((s) => s.yaw)
  const visiteurFloorId = useVisitorStore((s) => s.floorId)

  const affiche = visiteurFloorId ?? floorId ?? museum.spawn.floorId
  const floor = floorById(museum, affiche) ?? floorById(museum, museum.spawn.floorId)
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

  /** Point du monde → point du plan. */
  function projeterPoint(x: number, z: number) {
    return {
      x: PADDING + (x - footprint.x) * echelle,
      y: PADDING + (z - footprint.z) * echelle,
    }
  }

  const emprise = projeter(footprint)
  const atrium = projeter(museum.atrium)

  // Le visiteur n'est dessiné que s'il est SUR CE NIVEAU : pendant qu'il monte
  // la rampe, le plan montre encore le niveau qu'il quitte, et l'y faire figurer
  // reviendrait à le placer au milieu de la trémie.
  const surCeNiveau = position !== null && visiteurFloorId === floor.id
  const visiteur = surCeNiveau ? projeterPoint(position.x, position.z) : null

  // Le cap : un regard de lacet 0 pointe vers −Z, c'est-à-dire vers le haut du
  // plan. D'où le vecteur (−sin, −cos) dans le repère (x, y) de l'écran.
  // Le cône part du visiteur (son sommet) et s'ouvre vers l'avant.
  const cone =
    visiteur === null
      ? null
      : [
          `${visiteur.x},${visiteur.y}`,
          ...[MARKER_SPREAD, -MARKER_SPREAD].map((d) => {
            const a = yaw + d
            return `${visiteur.x - Math.sin(a) * MARKER_REACH},${visiteur.y - Math.cos(a) * MARKER_REACH}`
          }),
        ].join(' ')

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

        {/* Le visiteur : un point, et le cône de ce qu'il regarde. */}
        {visiteur !== null && cone !== null && (
          <g>
            <polygon points={cone} fill="rgba(255, 214, 102, 0.35)" />
            <circle cx={visiteur.x} cy={visiteur.y} r={MARKER_RADIUS} fill="#ffd666" stroke="rgba(0,0,0,0.6)" />
          </g>
        )}
      </svg>

      {/* Le nom du niveau : sans lui, deux étages au plan identique sont indiscernables. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '2px 6px',
          background: 'rgba(0,0,0,0.55)',
          color: 'rgba(255,255,255,0.8)',
          font: '400 0.7rem/1.4 system-ui, sans-serif',
          letterSpacing: '0.03em',
          textAlign: 'center',
        }}
      >
        {floor.name}
      </div>
    </div>
  )
}
