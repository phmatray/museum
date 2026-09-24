/**
 * La minimap (#31) : le plan d'architecte du niveau où se tient le visiteur,
 * sa salle surlignée et son cône de visée par-dessus.
 *
 * Le fond est `renderLevel`, le même dessin que `docs/plan`, calculé une fois
 * par niveau ; seule la couche du visiteur change quand il bouge. Tout ce qui
 * se décide (niveau, salle, repère) vient de `plan/minimap.ts`.
 */
import { useMemo } from 'react'
import { MUSEE } from '../plan/musee'
import { projectForMinimap } from '../plan/minimap'
import { S, renderLevel } from '../plan/svg'
import { useGameStore } from '../stores/gameStore'

const LARGEUR = 220
/** Longueur et demi-ouverture du cône de visée, en mètres et en radians. */
const PORTEE = 3
const OUVERTURE = 0.5

export function Minimap() {
  const visiteur = useGameStore((s) => s.visiteur)
  const vue = visiteur && projectForMinimap(MUSEE, visiteur)
  const level = vue?.level ?? MUSEE.spawn.level
  const fond = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderLevel(MUSEE, level))}`, [level])
  if (!vue) return null

  const { player: p, room, viewBox } = vue
  const cone = [0, OUVERTURE, -OUVERTURE].map((d, i) => {
    if (i === 0) return `${p.x},${p.y}`
    const a = p.yaw + d
    return `${p.x - Math.sin(a) * PORTEE * S},${p.y - Math.cos(a) * PORTEE * S}`
  }).join(' ')
  const nom = room?.name ?? MUSEE.levels.find((l) => l.id === level)?.name

  return (
    <figure
      style={{
        position: 'fixed', bottom: '1rem', right: '1rem', margin: 0, width: LARGEUR, zIndex: 200,
        background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <div style={{ position: 'relative' }}>
        <img src={fond} alt="" style={{ display: 'block', width: '100%' }} />
        <svg viewBox={viewBox.join(' ')} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} role="img" aria-label={`Vous êtes ici : ${nom}`}>
          {room && <rect x={room.x * S} y={room.z * S} width={room.width * S} height={room.depth * S} fill="rgba(207,51,38,0.18)" stroke="#CF3326" strokeWidth={4} />}
          <polygon points={cone} fill="rgba(207,51,38,0.45)" />
          <circle cx={p.x} cy={p.y} r={10} fill="#CF3326" stroke="#fff" strokeWidth={3} />
        </svg>
      </div>
      <figcaption style={{ color: 'white', font: '12px system-ui, sans-serif', padding: '4px 8px' }}>{nom}</figcaption>
    </figure>
  )
}
