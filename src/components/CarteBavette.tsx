/**
 * Le cartel de Bavette, quand on le regarde de près (`BavetteLayer`).
 *
 * La même carte que `CarteOeuvre`, en plus sobre : un nom, une ligne, l'auteur.
 * Elle cède la place à la carte d'une toile si l'on regarde les deux.
 */
import { CARTEL_BAVETTE } from '../plan/promenade'
import { useGameStore } from '../stores/gameStore'

export function CarteBavette() {
  const regarde = useGameStore((s) => s.bavetteRegarde)
  const toile = useGameStore((s) => s.toile)
  const paused = useGameStore((s) => s.paused)
  if (!regarde || toile !== null || paused) return null
  const c = CARTEL_BAVETTE
  return (
    <aside
      aria-live="polite"
      style={{
        position: 'fixed', left: 16, bottom: 16, width: 'min(320px, calc(100vw - 32px))', zIndex: 10,
        background: 'rgba(18,16,14,0.86)', border: '1px solid rgba(255,214,150,0.25)', borderRadius: 10,
        padding: '14px 16px', color: '#f3efe6', font: '14px/1.45 system-ui, sans-serif',
        backdropFilter: 'blur(6px)', animation: 'carte-bavette 400ms ease-out',
      }}
    >
      <style>{'@keyframes carte-bavette { from { opacity: 0; transform: translateY(8px) } } @media (prefers-reduced-motion: reduce) { aside { animation: none !important } }'}</style>
      <div style={{ fontSize: 20, fontWeight: 600, margin: '0 0 4px' }}>{c.title}</div>
      <p style={{ margin: '0 0 8px', color: '#d9d3c7', fontStyle: 'italic' }}>{c.ligne}</p>
      <div style={{ fontSize: 12, color: '#c9c2b4' }}>{c.author}, {c.year}</div>
    </aside>
  )
}
