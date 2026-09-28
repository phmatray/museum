/**
 * La carte de l'œuvre regardée, en bas à gauche (la minimap tient la droite).
 *
 * Elle s'ouvre quand `EveilLayer` publie une toile : description, langages,
 * étoiles, dernier push, et la touche E pour ouvrir le dépôt sur GitHub. Hors
 * de la 3D : un texte de 14 px se lit, un texte posé sur un mur à trois mètres
 * beaucoup moins, et il n'y a pas la place entre deux toiles.
 */
import { useEffect } from 'react'

import { couleurDeLangage, partsDeLangages } from '../domain/langages'
import { useCatalogue } from '../hooks/useCatalogue'
import { ilYA } from '../plan/eveil'
import { useGameStore } from '../stores/gameStore'

export function CarteOeuvre() {
  const toile = useGameStore((s) => s.toile)
  const paused = useGameStore((s) => s.paused)
  const catalogue = useCatalogue()
  const oeuvre = toile === null ? undefined : catalogue?.get(toile)

  useEffect(() => {
    if (oeuvre === undefined || paused) return
    const touche = (e: KeyboardEvent) => {
      if (e.code === 'KeyE' && !e.repeat) window.open(oeuvre.url, '_blank', 'noopener')
    }
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  }, [oeuvre, paused])

  if (oeuvre === undefined || paused) return null
  const parts = partsDeLangages(oeuvre.languages)
  return (
    <aside
      key={oeuvre.key}
      aria-live="polite"
      style={{
        position: 'fixed', left: 16, bottom: 16, width: 'min(360px, calc(100vw - 32px))', zIndex: 10,
        background: 'rgba(18,16,14,0.86)', border: '1px solid rgba(255,214,150,0.25)', borderRadius: 10,
        padding: '14px 16px', color: '#f3efe6', font: '14px/1.45 system-ui, sans-serif',
        backdropFilter: 'blur(6px)', animation: 'carte-oeuvre 260ms ease-out',
      }}
    >
      <style>{'@keyframes carte-oeuvre { from { opacity: 0; transform: translateY(8px) } } @media (prefers-reduced-motion: reduce) { aside { animation: none !important } }'}</style>
      <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#e0b060' }}>{oeuvre.owner}</div>
      <div style={{ fontSize: 20, fontWeight: 600, margin: '2px 0 6px', overflowWrap: 'anywhere' }}>{oeuvre.name}</div>
      {oeuvre.description && (
        <p style={{ margin: '0 0 10px', color: '#d9d3c7', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{oeuvre.description}</p>
      )}
      {parts.length > 0 && (
        <>
          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
            {parts.map(({ langage, part }) => <span key={langage} title={langage} style={{ width: `${part * 100}%`, background: couleurDeLangage(langage) }} />)}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', fontSize: 12, color: '#c9c2b4', marginBottom: 8 }}>
            {parts.slice(0, 3).map(({ langage, part }) => (
              <span key={langage}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: couleurDeLangage(langage), marginRight: 5 }} />
                {langage} {Math.round(part * 100)} %
              </span>
            ))}
          </div>
        </>
      )}
      <div style={{ fontSize: 13, color: '#c9c2b4', fontVariantNumeric: 'tabular-nums' }}>
        ★ {oeuvre.stars.toLocaleString('fr-FR')} · ⑂ {oeuvre.forks.toLocaleString('fr-FR')} · poussé {ilYA(oeuvre.pushedAt, new Date())}
      </div>
      <div style={{ marginTop: 10, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
        <kbd style={{ border: '1px solid rgba(255,255,255,0.4)', borderBottomWidth: 2, borderRadius: 4, padding: '0 6px', font: '600 12px system-ui' }}>E</kbd>
        ouvrir sur GitHub
      </div>
    </aside>
  )
}
