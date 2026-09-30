/**
 * La minimap (#31) : le plan d'architecte du niveau où se tient le visiteur,
 * sa salle surlignée et son cône de visée par-dessus.
 *
 * Le fond est `renderLevel`, le même dessin que `docs/plan`, calculé une fois
 * par niveau ; seule la couche du visiteur change quand il bouge. Tout ce qui
 * se décide (niveau, salle, repère) vient de `plan/minimap.ts`.
 *
 * Sur un téléphone, 220 px ne se lisent pas : un toucher ouvre le plan en
 * plein écran, qu'on agrandit à deux doigts (ou à la molette, aux boutons) et
 * qu'on fait glisser d'un doigt.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useAccrochage, themeName } from '../hooks/useAccrochage'
import { MUSEE } from '../plan/musee'
import { projectForMinimap, zoomer, type Cadrage } from '../plan/minimap'
import { S, renderDehors, renderLevel } from '../plan/svg'
import { useGameStore } from '../stores/gameStore'
import { useReglages } from '../stores/reglagesStore'

const LARGEUR = 220
/** Longueur et demi-ouverture du cône de visée, en mètres et en radians. */
const PORTEE = 3
const OUVERTURE = 0.5
const REPOS: Cadrage = { k: 1, x: 0, y: 0 }

export function Minimap() {
  const accrochage = useAccrochage()
  const visiteur = useGameStore((s) => s.visiteur)
  const chat = useGameStore((s) => s.bavette)
  const [ouvert, setOuvert] = useState(false)
  const affiche = useReglages((s) => s.plan)
  const vue = visiteur && projectForMinimap(MUSEE, visiteur)
  const level = vue?.level ?? MUSEE.spawn.level
  // Dehors, le plan montre aussi le parc jusqu'à la baraque du chantier.
  const dehors = vue?.dehors ?? false
  const fond = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(dehors ? renderDehors(MUSEE, level) : renderLevel(MUSEE, level))}`, [level, dehors])
  if (!vue || !affiche) return null

  const { player: p, room, viewBox } = vue
  const cone = [0, OUVERTURE, -OUVERTURE].map((d, i) => {
    if (i === 0) return `${p.x},${p.y}`
    const a = p.yaw + d
    return `${p.x - Math.sin(a) * PORTEE * S},${p.y - Math.cos(a) * PORTEE * S}`
  }).join(' ')
  const repliNom = MUSEE.levels.find((l) => l.id === level)?.name ?? ''
  const nom = room ? themeName(accrochage, room.id, level, room.name) : repliNom

  const dessin = (
    <div style={{ position: 'relative' }}>
      <img src={fond} alt="" draggable={false} style={{ display: 'block', width: '100%' }} />
      <svg viewBox={viewBox.join(' ')} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} role="img" aria-label={`Vous êtes ici : ${nom}`}>
        {room && <rect x={room.x * S} y={room.z * S} width={room.width * S} height={room.depth * S} fill="rgba(207,51,38,0.18)" stroke="#CF3326" strokeWidth={4} />}
        {/* Bavette, un petit point clair, s'il se promène à cet étage. */}
        {chat && chat.level === level && <circle cx={chat.x * S} cy={chat.z * S} r={6} fill="#f3efe6" stroke="#3a2f25" strokeWidth={2}><title>Bavette</title></circle>}
        <polygon points={cone} fill="rgba(207,51,38,0.45)" />
        <circle cx={p.x} cy={p.y} r={10} fill="#CF3326" stroke="#fff" strokeWidth={3} />
      </svg>
    </div>
  )

  return (
    <>
      <figure
        onClick={() => setOuvert(true)}
        title="Agrandir le plan"
        style={{
          position: 'fixed', bottom: '1rem', right: '1rem', margin: 0, width: `min(${LARGEUR}px, 30vw)`, zIndex: 200,
          background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, overflow: 'hidden',
          cursor: 'zoom-in',
        }}
      >
        {dessin}
        <figcaption style={{ color: 'white', font: '12px system-ui, sans-serif', padding: '4px 8px' }}>{nom}</figcaption>
      </figure>
      {ouvert && <PlanOuvert nom={nom} fermer={() => setOuvert(false)}>{dessin}</PlanOuvert>}
    </>
  )
}

const BOUTON: CSSProperties = {
  width: 44, height: 44, borderRadius: 22, border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(0,0,0,0.6)',
  color: 'white', font: '22px system-ui, sans-serif', cursor: 'pointer',
}

/** Le plan en plein écran : deux doigts pour grossir, un pour glisser. */
function PlanOuvert({ nom, fermer, children }: { nom: string; fermer: () => void; children: ReactNode }) {
  const [c, setC] = useState<Cadrage>(REPOS)
  const cadre = useRef<HTMLDivElement>(null)
  const doigts = useRef(new Map<number, { x: number; y: number }>())

  useEffect(() => {
    const touche = (e: KeyboardEvent) => { if (e.key === 'Escape') fermer() }
    addEventListener('keydown', touche)
    return () => removeEventListener('keydown', touche)
  }, [fermer])

  const local = (x: number, y: number) => {
    const r = cadre.current!.getBoundingClientRect()
    return [x - r.left, y - r.top] as const
  }
  const centre = () => {
    const r = cadre.current!.getBoundingClientRect()
    return [r.width / 2, r.height / 2] as const
  }

  const bouger = (e: React.PointerEvent) => {
    const d = doigts.current
    const avant = d.get(e.pointerId)
    if (!avant) return
    const [a, b] = [...d.values()]
    const ecartAvant = d.size === 2 ? Math.hypot(a.x - b.x, a.y - b.y) : 0
    const milieuAvant = d.size === 2 ? [(a.x + b.x) / 2, (a.y + b.y) / 2] : [avant.x, avant.y]
    d.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const [a2, b2] = [...d.values()]
    if (d.size === 2) {
      const [mx, my] = local((a2.x + b2.x) / 2, (a2.y + b2.y) / 2)
      const [mx0, my0] = local(milieuAvant[0], milieuAvant[1])
      setC((c) => {
        const z = zoomer(c, Math.hypot(a2.x - b2.x, a2.y - b2.y) / (ecartAvant || 1), mx0, my0)
        return { ...z, x: z.x + mx - mx0, y: z.y + my - my0 }
      })
    } else {
      setC((c) => ({ ...c, x: c.x + e.clientX - avant.x, y: c.y + e.clientY - avant.y }))
    }
  }
  const lever = (e: React.PointerEvent) => { doigts.current.delete(e.pointerId) }

  return (
    <div
      role="dialog"
      aria-label={`Plan du musée : ${nom}`}
      style={{ position: 'fixed', inset: 0, zIndex: 1500, background: 'rgba(12,14,18,0.94)', display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 'max(12px, env(safe-area-inset-top)) 12px 8px', color: 'white', font: '15px system-ui, sans-serif' }}>
        <span style={{ flex: 1 }}>{nom}</span>
        <button type="button" aria-label="Réduire" style={BOUTON} onClick={() => setC((c) => zoomer(c, 1 / 1.5, ...centre()))}>−</button>
        <button type="button" aria-label="Agrandir" style={BOUTON} onClick={() => setC((c) => zoomer(c, 1.5, ...centre()))}>+</button>
        <button type="button" aria-label="Fermer le plan" style={BOUTON} onClick={fermer}>×</button>
      </div>
      <div
        ref={cadre}
        style={{ flex: 1, overflow: 'hidden', touchAction: 'none', cursor: 'grab', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); doigts.current.set(e.pointerId, { x: e.clientX, y: e.clientY }) }}
        onPointerMove={bouger}
        onPointerUp={lever}
        onPointerCancel={lever}
        onWheel={(e) => setC((c) => zoomer(c, Math.exp(-e.deltaY / 400), ...local(e.clientX, e.clientY)))}
        onDoubleClick={() => setC(REPOS)}
      >
        {/* L'origine du cadrage est le coin du cadre : on y ramène le plan centré. */}
        <div style={{ position: 'absolute', inset: 0, transform: `translate(${c.x}px, ${c.y}px) scale(${c.k})`, transformOrigin: '0 0', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ width: 'min(100%, 1100px)', padding: 12, boxSizing: 'border-box' }}>{children}</div>
        </div>
      </div>
    </div>
  )
}
