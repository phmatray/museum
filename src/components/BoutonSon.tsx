/**
 * Le bouton du son, en haut à droite : la minimap tient le bas à droite, les
 * cartes le bas à gauche, la visite guidée le haut à gauche. Pendant la visite,
 * « Exit Tour » prend le coin : le bouton descend d'un cran.
 *
 * Au-dessus de l'écran d'accueil, pour qu'on puisse choisir avant d'entrer ;
 * une fois la souris capturée, la touche M le remplace.
 */
import { useEffect } from 'react'

import { basculerSon, eveillerSon, useSon } from '../audio/etat'
import { useGameStore } from '../stores/gameStore'

export function BoutonSon() {
  const actif = useSon((s) => s.actif)
  const tourActive = useGameStore((s) => s.tourActive)

  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (e.code === 'KeyM' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) basculerSon()
    }
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  }, [])

  // Retenu allumé d'une visite précédente : le premier geste de celle-ci l'éveille.
  useEffect(() => {
    if (!actif) return
    const geste = () => eveillerSon()
    window.addEventListener('pointerdown', geste, { once: true })
    window.addEventListener('keydown', geste, { once: true })
    return () => {
      window.removeEventListener('pointerdown', geste)
      window.removeEventListener('keydown', geste)
    }
  }, [actif])

  return (
    <button
      type="button"
      aria-pressed={actif}
      aria-label="Son"
      title={actif ? 'Couper le son (M)' : 'Activer le son (M)'}
      onClick={(e) => {
        e.stopPropagation()
        basculerSon()
      }}
      style={{
        position: 'fixed', top: tourActive ? '4rem' : '1rem', right: '1rem', zIndex: 1001,
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px 8px 10px',
        background: actif ? 'rgba(18,16,14,0.86)' : 'rgba(0,0,0,0.5)',
        border: `1px solid ${actif ? 'rgba(255,214,150,0.55)' : 'rgba(255,255,255,0.25)'}`, borderRadius: 999,
        color: actif ? '#f3efe6' : '#c9c2b4', font: '13px system-ui, sans-serif', cursor: 'pointer',
        backdropFilter: 'blur(6px)',
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" fillOpacity={actif ? 0.9 : 0.35} />
        {actif ? (
          <>
            <path d="M15.5 9a4 4 0 0 1 0 6" stroke="#e0b060" />
            <path d="M18 6.5a7.5 7.5 0 0 1 0 11" stroke="#e0b060" />
          </>
        ) : (
          <path d="M16 9.5l5 5M21 9.5l-5 5" />
        )}
      </svg>
      <span>Son</span>
      <kbd style={{ border: '1px solid rgba(255,255,255,0.35)', borderBottomWidth: 2, borderRadius: 4, padding: '0 5px', font: '600 11px system-ui', opacity: 0.8 }}>M</kbd>
    </button>
  )
}
